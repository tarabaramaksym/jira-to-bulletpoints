require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');
const crypto = require('crypto');
const AIService = require('./services/AIService');
const CSVProcessor = require('./services/CSVProcessor');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const TEMP_DIR = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { mode: 0o700 });
}

const aiService = process.env.OPENAI_API_KEY ? new AIService(process.env.OPENAI_API_KEY) : null;
const csvProcessor = new CSVProcessor(50); // Even smaller chunks for context window safety

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const MemoryStore = require('express-session').MemoryStore;
const sessionStore = new MemoryStore();

// Fallback storage for session data
const fallbackStorage = new Map();

// Processing state for WebSocket connections
const processingState = new Map(); // socketId -> { sessionId, isProcessing, canCancel }

// Clean up fallback storage and temp files when sessions are destroyed
sessionStore.on('destroy', (sessionId) => {
  console.log('Session destroy event for:', sessionId);
  const sessionData = fallbackStorage.get(sessionId);
  if (sessionData) {
    console.log('Session destroy - found data in fallback storage, scheduling delayed cleanup');
    
    // Schedule cleanup after 10 minutes to allow for download
    setTimeout(() => {
      console.log('Delayed cleanup for destroyed session:', sessionId);
      if (sessionData.csvData && sessionData.csvData.filePath) {
        cleanupTempFile(sessionData.csvData.filePath);
      }
      if (sessionData.finalData && sessionData.finalData.filePath) {
        cleanupTempFile(sessionData.finalData.filePath);
      }
      fallbackStorage.delete(sessionId);
    }, 10 * 60 * 1000); // 10 minutes delay
    
    console.log('Session destroy - keeping data available for 10 minutes for potential download');
  } else {
    console.log('Session destroy - no data in fallback storage to clean up');
  }
});

const sessionMiddleware = session({
  store: sessionStore,
  secret: 'jira-converter-secret-key',
  resave: true,  // Force session save even if not modified
  saveUninitialized: true,  // Create session for Socket.io
  rolling: true,  // Reset expiration on each request
  cookie: { 
    secure: false,
    maxAge: 1000 * 60 * 60 * 2,  // 2 hours
    httpOnly: false  // Allow client-side access for Socket.io
  }
});

app.use(sessionMiddleware);

// Share session middleware with Socket.io - wrap to convert connect session to socket.io session
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

const upload = multer({ 
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, TEMP_DIR);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = crypto.randomBytes(6).toString('hex');
      const timestamp = Date.now();
      const sessionId = req.sessionID || 'unknown';
      const filename = `${sessionId}_${timestamp}_${uniqueSuffix}.csv`;
      cb(null, filename);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// WebSocket event handlers
io.on('connection', (socket) => {
  const session = socket.request.session;
  const sessionId = session ? session.id : 'no-session';
  
  console.log(`WebSocket connected: ${socket.id} (session: ${sessionId})`);
  console.log('Session data available:', !!session);
  console.log('CSV data in session:', !!(session && session.csvData));
  console.log('Available fallback sessions:', [...fallbackStorage.keys()]);
  
  // Check if we have data in fallback storage for any session
  if (fallbackStorage.size > 0) {
    console.log('Fallback storage contents:');
    for (const [key, data] of fallbackStorage.entries()) {
      console.log(`  Session ${key}: csvData=${!!data.csvData}, processedData=${!!data.processedData}, finalData=${!!data.finalData}`);
    }
  }
  
  // Initialize processing state
  processingState.set(socket.id, {
    sessionId: sessionId,
    isProcessing: false,
    canCancel: false,
    currentOperation: null
  });
  
  // Handle processing request
  socket.on('start-processing', async (data) => {
    await handleProcessing(socket, data);
  });
  
  // Handle reprocessing request
  socket.on('start-reprocessing', async (data) => {
    await handleReprocessing(socket, data);
  });
  
  // Handle cancellation
  socket.on('cancel-processing', () => {
    handleCancellation(socket);
  });
  
  // Clean up on disconnect
  socket.on('disconnect', () => {
    console.log(`WebSocket disconnected: ${socket.id}`);
    const state = processingState.get(socket.id);
    if (state) {
      console.log(`WebSocket disconnect - session was: ${state.sessionId}`);
      console.log(`Fallback storage for session exists: ${fallbackStorage.has(state.sessionId)}`);
    }
    processingState.delete(socket.id);
  });
});

// Helper function to get session data
function getSessionData(sessionId, callback) {
  // Try fallback storage first (more reliable for WebSocket data)
  const fallbackData = fallbackStorage.get(sessionId);
  if (fallbackData) {
    console.log('Found session data in fallback storage:', sessionId);
    return callback(null, fallbackData);
  }
  
  // Try session store as backup
  sessionStore.get(sessionId, (err, sessionData) => {
    if (err) {
      console.error('Error loading session from store:', err);
      return callback(err, null);
    }
    
    if (sessionData) {
      console.log('Found session data in session store:', sessionId);
    } else {
      console.log('No session data found in either storage for:', sessionId);
    }
    
    callback(null, sessionData);
  });
}

// Helper function to save session data
function saveSessionData(sessionData, callback) {
  const sessionId = sessionData.id || sessionData.sessionID;
  console.log('Attempting to save session data. Session ID:', sessionId);
  console.log('SessionData keys:', Object.keys(sessionData));
  
  if (!sessionId) {
    console.error('No session ID found for saving. SessionData:', sessionData);
    return callback();
  }
  
  // Ensure session data has proper express-session structure
  const properSessionData = {
    ...sessionData,
    cookie: sessionData.cookie || {
      originalMaxAge: 2 * 60 * 60 * 1000, // 2 hours
      expires: new Date(Date.now() + 2 * 60 * 60 * 1000),
      secure: false,
      httpOnly: false,
      path: '/'
    }
  };
  
  // Only save to fallback storage (avoid session store issues for now)
  fallbackStorage.set(sessionId, properSessionData);
  console.log('Session data saved to fallback storage:', sessionId);
  callback();
}

// WebSocket handler functions
async function handleProcessing(socket, data) {
  const state = processingState.get(socket.id);
  if (!state || state.isProcessing) {
    socket.emit('processing-error', { error: 'Already processing or invalid session' });
    return;
  }

  const socketSession = socket.request.session;
  const sessionId = socketSession ? socketSession.id : null;
  
  console.log('Processing request - Session ID:', sessionId);
  
  if (!sessionId) {
    socket.emit('processing-error', { error: 'No session ID available' });
    return;
  }

  // Try to get session data from store directly, then fallback storage
  getSessionData(sessionId, async (err, sessionData) => {
    let actualSessionId = sessionId;
    
    if (err || !sessionData || !sessionData.csvData) {
      console.log('Session data not found for WebSocket session, searching fallback storage...');
      
      // Try fallback storage with current session ID
      let fallbackData = fallbackStorage.get(sessionId);
      
      if (!fallbackData || !fallbackData.csvData) {
        // Try all available sessions in fallback storage
        console.log('Available fallback sessions:', [...fallbackStorage.keys()]);
        for (const [key, data] of fallbackStorage.entries()) {
          if (data.csvData) {
            console.log('Found CSV data in fallback session:', key);
            fallbackData = data;
            actualSessionId = key; // Use the session ID that has the data
            break;
          }
        }
      }
      
      if (!fallbackData || !fallbackData.csvData) {
        socket.emit('processing-error', { error: 'No CSV data found. Please upload a file first.' });
        return;
      }
      
      sessionData = fallbackData;
    }

    console.log('Using session ID for processing:', actualSessionId);
    console.log('Loaded session data keys:', Object.keys(sessionData));
    console.log('Session has csvData:', !!sessionData.csvData);
    
    if (!sessionData.csvData || !sessionData.csvData.filePath) {
      socket.emit('processing-error', { error: 'No CSV data found in session. Please upload a file first.' });
      return;
    }

    // Continue with processing using sessionData and the actual session ID with data
    await processWithSessionData(socket, data, sessionData, actualSessionId);
  });
}

async function processWithSessionData(socket, data, sessionData, sessionId) {
  const state = processingState.get(socket.id);

  if (!fs.existsSync(sessionData.csvData.filePath)) {
    socket.emit('processing-error', { error: 'CSV file no longer exists' });
    return;
  }

  const { selectedFields, aiPrompt } = data;
  if (!selectedFields || selectedFields.length === 0) {
    socket.emit('processing-error', { error: 'No fields selected for processing' });
    return;
  }

  // Update processing state
  state.isProcessing = true;
  state.canCancel = true;
  state.currentOperation = 'processing';

  try {
    socket.emit('processing-started', { message: 'Starting processing...', totalChunks: 'calculating' });

    const csvContent = fs.readFileSync(sessionData.csvData.filePath, 'utf8');
    
    if (aiService) {
      const parsedData = await csvProcessor.parseCsvData(csvContent, selectedFields);
      const chunks = csvProcessor.createChunks(parsedData);
      const totalChunks = chunks.length;
      
      socket.emit('chunk-progress', { 
        current: 0, 
        total: totalChunks, 
        status: `Starting processing of ${totalChunks} chunks...` 
      });

      const processedChunks = [];
      
      for (let i = 0; i < chunks.length; i++) {
        // Check for cancellation
        if (!state.isProcessing) {
          socket.emit('processing-cancelled', { message: 'Processing cancelled by user' });
          return;
        }

        const chunk = chunks[i];
        socket.emit('chunk-progress', { 
          current: i + 1, 
          total: totalChunks, 
          status: `Processing chunk ${i + 1} of ${totalChunks}...` 
        });

        try {
          const formattedChunk = csvProcessor.formatChunkForAI(chunk);
          const chunkResult = await aiService.processChunk(formattedChunk, aiPrompt);
          processedChunks.push(chunkResult);
          
          socket.emit('chunk-completed', { 
            chunkIndex: i + 1, 
            progress: Math.round(((i + 1) / totalChunks) * 80), // 80% for chunk processing
            partialResults: chunkResult.split('\n').filter(line => line.trim()).slice(0, 3) // Preview
          });
        } catch (chunkError) {
          console.error(`Error processing chunk ${i + 1}:`, chunkError.message);
          socket.emit('processing-error', { 
            error: `Failed to process chunk ${i + 1}: ${chunkError.message}`,
            canRetry: true 
          });
          return;
        }
      }

      // Final deduplication
      socket.emit('chunk-progress', { 
        current: totalChunks, 
        total: totalChunks, 
        status: 'Performing final deduplication...' 
      });

      const combinedBulletpoints = csvProcessor.combineChunksForDeduplication(processedChunks);
      const finalResult = await aiService.deduplicateBulletpoints(combinedBulletpoints);
      
      const achievements = finalResult.split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^[\s\-\*•]+/, '').trim())
        .filter(line => line.length > 0);

      // Update session data
      sessionData.processedData = {
        selectedFields,
        aiPrompt,
        processTime: new Date(),
        achievements: achievements
      };

      // Ensure session ID is available
      if (!sessionData.id && !sessionData.sessionID) {
        sessionData.id = sessionId;
      }

      // Save back to session store
      saveSessionData(sessionData, () => {
        socket.emit('processing-completed', {
          achievements: achievements,
          totalAchievements: achievements.length,
          progress: 100
        });
      });

    } else {
      // Non-AI processing
      const achievements = ['Original CSV content (AI processing not available)'];
      sessionData.processedData = {
        selectedFields,
        aiPrompt,
        processTime: new Date(),
        achievements: achievements
      };

      // Ensure session ID is available
      if (!sessionData.id && !sessionData.sessionID) {
        sessionData.id = sessionId;
      }

      // Save back to session store
      saveSessionData(sessionData, () => {
        socket.emit('processing-completed', {
          achievements: achievements,
          totalAchievements: achievements.length,
          progress: 100
        });
      });
    }

  } catch (error) {
    console.error('Processing error:', error.message);
    socket.emit('processing-error', { 
      error: 'Processing failed: ' + error.message,
      canRetry: true 
    });
  } finally {
    // Reset processing state
    state.isProcessing = false;
    state.canCancel = false;
    state.currentOperation = null;
  }
}

async function handleReprocessing(socket, data) {
  const state = processingState.get(socket.id);
  if (!state || state.isProcessing) {
    socket.emit('processing-error', { error: 'Already processing or invalid session' });
    return;
  }

  const socketSession = socket.request.session;
  const sessionId = socketSession ? socketSession.id : null;
  
  if (!sessionId) {
    socket.emit('processing-error', { error: 'No session ID available' });
    return;
  }

  // Get session data from store, then fallback storage
  getSessionData(sessionId, async (err, sessionData) => {
    let actualSessionId = sessionId;
    
    if (err || !sessionData || !sessionData.processedData) {
      console.log('Processed data not found in session store, trying fallback...');
      
      // Try fallback storage
      let fallbackData = fallbackStorage.get(sessionId);
      
      if (!fallbackData || !fallbackData.processedData) {
        // Try all available sessions in fallback storage
        for (const [key, data] of fallbackStorage.entries()) {
          if (data.processedData) {
            console.log('Found processed data in fallback session:', key);
            fallbackData = data;
            actualSessionId = key; // Use the session ID that has the data
            break;
          }
        }
      }
      
      if (!fallbackData || !fallbackData.processedData) {
        socket.emit('processing-error', { error: 'No processed data available. Please process a file first.' });
        return;
      }
      
      sessionData = fallbackData;
    }

    console.log('Using session ID for reprocessing:', actualSessionId);
    await reprocessWithSessionData(socket, data, sessionData, actualSessionId);
  });
}

async function reprocessWithSessionData(socket, data, sessionData, sessionId) {
  const state = processingState.get(socket.id);

  const { selectedAchievements, additionalPrompt } = data;
  if (!selectedAchievements || selectedAchievements.length === 0) {
    socket.emit('processing-error', { error: 'No achievements selected' });
    return;
  }

  // Update processing state
  state.isProcessing = true;
  state.canCancel = true;
  state.currentOperation = 'reprocessing';

  try {
    socket.emit('processing-started', { message: 'Starting reprocessing...' });

    let finalAchievements = selectedAchievements;

    if (additionalPrompt && additionalPrompt.trim() && aiService) {
      socket.emit('chunk-progress', { 
        current: 1, 
        total: 1, 
        status: 'Applying additional processing...' 
      });

      const achievementsText = selectedAchievements.join('\n');
      const reprocessedResult = await aiService.reprocessAchievements(achievementsText, additionalPrompt);
      
      finalAchievements = reprocessedResult.split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^[\s\-\*•]+/, '').trim())
        .filter(line => line.length > 0);
    }

    // Save achievements to temporary file
    const achievementsFilePath = saveAchievementsToFile(finalAchievements, sessionId);
    
    const finalDataObj = {
      achievements: finalAchievements,
      additionalPrompt: additionalPrompt || null,
      processTime: new Date(),
      filePath: achievementsFilePath
    };
    
    sessionData.finalData = finalDataObj;

    // Ensure session ID is available
    if (!sessionData.id && !sessionData.sessionID) {
      sessionData.id = sessionId;
    }

    // Store in fallback storage
    fallbackStorage.set(sessionData.id || sessionId, sessionData);

    // Save back to session store
    saveSessionData(sessionData, () => {
      socket.emit('processing-completed', {
        achievements: finalAchievements,
        totalAchievements: finalAchievements.length,
        downloadReady: true,
        progress: 100
      });
    });

  } catch (error) {
    console.error('Reprocessing error:', error.message);
    socket.emit('processing-error', { 
      error: 'Reprocessing failed: ' + error.message,
      canRetry: true 
    });
  } finally {
    // Reset processing state
    state.isProcessing = false;
    state.canCancel = false;
    state.currentOperation = null;
  }
}

function handleCancellation(socket) {
  const state = processingState.get(socket.id);
  if (state && state.isProcessing && state.canCancel) {
    state.isProcessing = false;
    state.canCancel = false;
    socket.emit('processing-cancelled', { message: 'Processing cancelled successfully' });
    console.log(`Processing cancelled for socket: ${socket.id}`);
  } else {
    socket.emit('processing-error', { error: 'No cancellable operation in progress' });
  }
}

// Helper function to clean up temporary files
function cleanupTempFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Cleaned up temp file: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete temp file ${filePath}:`, error.message);
    }
  }
}

// Helper function to save achievements to a temporary file
function saveAchievementsToFile(achievements, sessionId) {
  try {
    if (!achievements || achievements.length === 0) {
      console.warn('No achievements to save to file');
      return null;
    }
    
    const uniqueSuffix = crypto.randomBytes(6).toString('hex');
    const timestamp = Date.now();
    const filename = `${sessionId}_${timestamp}_${uniqueSuffix}_achievements.txt`;
    const filePath = path.join(TEMP_DIR, filename);
    
    const content = achievements.join('\n\n');
    fs.writeFileSync(filePath, content, 'utf8');
    
    console.log(`Saved ${achievements.length} achievements to: ${filename}`);
    
    setTimeout(() => {
      cleanupTempFile(filePath);
    }, 60 * 60 * 1000);
    
    return filePath;
  } catch (error) {
    console.error('Failed to save achievements to file:', error.message);
    return null;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    if (req.session.csvData && req.session.csvData.filePath) {
      cleanupTempFile(req.session.csvData.filePath);
    }
    
    const csvContent = fs.readFileSync(req.file.path, 'utf8');
    const headers = await csvProcessor.getHeaders(csvContent);
    const uniqueHeaders = [...new Set(headers)];
    
    // Count rows by splitting lines (approximation for display)
    const lines = csvContent.split('\n').filter(line => line.trim());
    const rowCount = Math.max(0, lines.length - 1);
    
    req.session.csvData = {
      filePath: req.file.path,
      filename: req.file.originalname,
      headers: uniqueHeaders,
      originalHeaders: headers,
      rowCount: rowCount,
      uploadTime: new Date()
    };
    
    // Force session save
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Failed to save session data' });
      }
      
      console.log('CSV data saved to session:', req.sessionID);
      console.log('Session data keys:', Object.keys(req.session.csvData));
      
      // Also store in fallback storage with session ID
      const sessionData = {
        id: req.sessionID,
        csvData: req.session.csvData,
        processedData: null,
        finalData: null
      };
      fallbackStorage.set(req.sessionID, sessionData);
      console.log('CSV data also saved to fallback storage:', req.sessionID);
      
      res.json({
        success: true,
        filename: req.file.originalname,
        headers: uniqueHeaders,
        originalHeaders: headers,
        rowCount: rowCount
      });
    });
  } catch (error) {
    if (req.file && req.file.path) {
      cleanupTempFile(req.file.path);
    }
    res.status(400).json({ error: 'Invalid CSV format: ' + error.message });
  }
});

app.post('/process', async (req, res) => {
  const { selectedFields, aiPrompt } = req.body;
  
  if (!req.session.csvData || !req.session.csvData.filePath) {
    return res.status(400).json({ error: 'No file data in session' });
  }
  
  if (!fs.existsSync(req.session.csvData.filePath)) {
    return res.status(400).json({ error: 'Uploaded file no longer exists' });
  }
  
  try {
    const csvContent = fs.readFileSync(req.session.csvData.filePath, 'utf8');
    
    if (aiService && selectedFields.length > 0) {
      const parsedData = await csvProcessor.parseCsvData(csvContent, selectedFields);
      const chunks = csvProcessor.createChunks(parsedData);
      const processedChunks = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const formattedChunk = csvProcessor.formatChunkForAI(chunk);
        const chunkResult = await aiService.processChunk(formattedChunk, aiPrompt);
        processedChunks.push(chunkResult);
      }
      
      const combinedBulletpoints = csvProcessor.combineChunksForDeduplication(processedChunks);
      const finalResult = await aiService.deduplicateBulletpoints(combinedBulletpoints);
      
      // Parse the final result into individual achievements
      const achievements = finalResult.split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^[\s\-\*•]+/, '').trim())
        .filter(line => line.length > 0);
      
      req.session.processedData = {
        selectedFields,
        aiPrompt,
        processTime: new Date(),
        achievements: achievements
      };
      
    } else {
      // For non-AI processing, return the original content as a single achievement
      req.session.processedData = {
        selectedFields,
        aiPrompt,
        processTime: new Date(),
        achievements: ['Original CSV content (AI processing not available)']
      };
    }
    
    // Store in fallback storage as well
    const sessionData = {
      csvData: req.session.csvData,
      processedData: req.session.processedData,
      finalData: null
    };
    fallbackStorage.set(req.sessionID, sessionData);
    
    // Force session save and wait for completion
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ 
          error: 'Session save failed', 
          details: err.message 
        });
      } else {
        res.json({
          success: true,
          achievements: req.session.processedData.achievements,
          processedFields: selectedFields,
          aiPrompt,
          aiEnabled: !!aiService
        });
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Processing failed', 
      details: error.message,
      aiEnabled: !!aiService
    });
  }
});

app.post('/reprocess', async (req, res) => {
  const { selectedAchievements, additionalPrompt } = req.body;
  
  if (!req.session.processedData) {
    return res.status(400).json({ error: 'No processed data available' });
  }
  
  if (!selectedAchievements || selectedAchievements.length === 0) {
    return res.status(400).json({ error: 'No achievements selected' });
  }
  
  // Touch session to keep it alive
  req.session.touch();
  
  try {
    let finalAchievements = selectedAchievements;
    
    // If additional prompt is provided and AI is available, reprocess the selected achievements
    if (additionalPrompt && additionalPrompt.trim() && aiService) {
      const achievementsText = selectedAchievements.join('\n');
      const reprocessedResult = await aiService.reprocessAchievements(achievementsText, additionalPrompt);
      
      // Parse the reprocessed result
      finalAchievements = reprocessedResult.split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^[\s\-\*•]+/, '').trim())
        .filter(line => line.length > 0);
    }
    
    const achievementsFilePath = saveAchievementsToFile(finalAchievements, req.sessionID);
    
    // Store the final achievements for download
    const finalDataObj = {
      achievements: finalAchievements,
      additionalPrompt: additionalPrompt || null,
      processTime: new Date(),
      filePath: achievementsFilePath
    };
    
    req.session.finalData = finalDataObj;
    
    // Store in fallback storage as well
    const sessionData = {
      csvData: req.session.csvData,
      processedData: req.session.processedData,
      finalData: finalDataObj
    };
    fallbackStorage.set(req.sessionID, sessionData);
    
    // Force session save and wait for completion
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ 
          error: 'Session save failed', 
          details: err.message 
        });
      } else {
        res.json({
          success: true,
          achievements: finalAchievements,
          downloadUrl: '/download'
        });
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Reprocessing failed', 
      details: error.message 
    });
  }
});

app.get('/download', (req, res) => {
  const sessionId = req.sessionID;
  console.log('\n=== DOWNLOAD REQUEST START ===');
  console.log('Download request for session:', sessionId);
  console.log('Current time:', new Date().toISOString());
  console.log('All fallback sessions available:', [...fallbackStorage.keys()]);
  console.log('Fallback storage size:', fallbackStorage.size);
  
  // Debug: show all fallback storage contents
  if (fallbackStorage.size > 0) {
    console.log('=== FALLBACK STORAGE CONTENTS ===');
    for (const [key, data] of fallbackStorage.entries()) {
      console.log(`Session ${key}:`);
      console.log(`  - Keys: ${Object.keys(data)}`);
      console.log(`  - Has csvData: ${!!data.csvData}`);
      console.log(`  - Has processedData: ${!!data.processedData}`);
      console.log(`  - Has finalData: ${!!data.finalData}`);
      if (data.finalData) {
        console.log(`  - Final data achievements count: ${data.finalData.achievements?.length || 0}`);
        console.log(`  - Final data file path: ${data.finalData.filePath || 'none'}`);
      }
    }
    console.log('=== END FALLBACK STORAGE CONTENTS ===');
  }
  
  // Try to get session data using the same logic as WebSocket
  getSessionData(sessionId, (err, sessionData) => {
    if (err || !sessionData || !sessionData.finalData) {
      console.log('Download: Session store lookup failed, trying fallback storage...');
      
      // Try fallback storage with current session ID first
      let fallbackData = fallbackStorage.get(sessionId);
      console.log(`Download: Direct lookup for ${sessionId}:`, !!fallbackData);
      
      if (!fallbackData || !fallbackData.finalData) {
        // Try ALL available sessions in fallback storage
        console.log('Download: Searching all sessions for finalData...');
        for (const [key, data] of fallbackStorage.entries()) {
          console.log(`Download: Checking session ${key} - has finalData: ${!!data.finalData}`);
          if (data.finalData) {
            console.log('Download: Found finalData in session:', key);
            fallbackData = data;
            break;
          }
        }
      }
      
      if (!fallbackData || !fallbackData.finalData) {
        console.log('Download: No final data found anywhere');
        console.log('=== DOWNLOAD REQUEST FAILED ===\n');
        return res.status(404).json({ error: 'No processed data available' });
      }
      
      sessionData = fallbackData;
    }
    
    console.log('Download: Successfully found session data');
    console.log('Download: Session data keys:', Object.keys(sessionData));
    console.log('Download: Has finalData:', !!sessionData.finalData);
    console.log('Download: Has csvData:', !!sessionData.csvData);
    console.log('=== DOWNLOAD REQUEST SUCCESS ===\n');
    
    processDownload(sessionData, res);
  });
});

function processDownload(sessionData, res) {
  const csvData = sessionData.csvData;
  const finalData = sessionData.finalData;
  
  if (!csvData || !finalData) {
    console.error('Download: Missing csvData or finalData', { csvData: !!csvData, finalData: !!finalData });
    return res.status(404).json({ error: 'No processed data available' });
  }
  
  let processedContent;
  
  // Try to read from file first, fallback to session data
  if (finalData.filePath && fs.existsSync(finalData.filePath)) {
    try {
      processedContent = fs.readFileSync(finalData.filePath, 'utf8');
      console.log('Download: Read from file:', finalData.filePath);
    } catch (error) {
      console.error('Failed to read achievements file:', error.message);
      processedContent = finalData.achievements.join('\n\n');
    }
  } else {
    processedContent = finalData.achievements.join('\n\n');
    console.log('Download: Using achievements from session data');
  }
  
  const originalFilename = csvData.filename;
  const baseFilename = originalFilename.replace(/\.[^/.]+$/, ""); // Remove extension
  const processedFilename = `${baseFilename}-resume-achievements.txt`;
  
  console.log('Download: Sending file:', processedFilename, 'with', finalData.achievements.length, 'achievements');
  
  res.setHeader('Content-disposition', `attachment; filename="${processedFilename}"`);
  res.setHeader('Content-type', 'text/plain');
  
  console.log('Download: Sending file to browser...');
  
  // Send the file first
  res.send(processedContent);
  
  // Clean up temporary files and session data AFTER successful download
  // Wait longer to ensure download actually completes
  setTimeout(() => {
    console.log('Download: Starting post-download cleanup for session:', sessionData.id);
    
    if (csvData.filePath) {
      cleanupTempFile(csvData.filePath);
    }
    if (finalData.filePath) {
      cleanupTempFile(finalData.filePath);
    }
    
    // Clean up session data from both stores
    const sessionId = sessionData.id || sessionData.sessionID;
    if (sessionId) {
      sessionStore.destroy(sessionId, (err) => {
        if (err) {
          console.error('Error destroying session:', err);
        }
      });
      fallbackStorage.delete(sessionId);
      console.log('Download: Completed cleanup after successful download:', sessionId);
    }
  }, 5000); // Wait 5 seconds to ensure download completed
}

const cleanupSession = (req, res) => {
  const sessionId = req.sessionID;
  console.log('Manual cleanup requested for session:', sessionId);
  console.log('Fallback storage before cleanup:', [...fallbackStorage.keys()]);
  
  // Clean up temporary files if they exist
  if (req.session.csvData && req.session.csvData.filePath) {
    cleanupTempFile(req.session.csvData.filePath);
  }
  if (req.session.finalData && req.session.finalData.filePath) {
    cleanupTempFile(req.session.finalData.filePath);
  }
  
  // Clean up session data
  if (req.session.csvData) {
    delete req.session.csvData;
  }
  if (req.session.processedData) {
    delete req.session.processedData;
  }
  if (req.session.finalData) {
    delete req.session.finalData;
  }
  
  // Clean up fallback storage for this session
  const cleaned = fallbackStorage.delete(sessionId);
  console.log('Cleaned up fallback storage for session:', sessionId, 'existed:', cleaned);
  console.log('Fallback storage after cleanup:', [...fallbackStorage.keys()]);
  
  res.json({ success: true, message: 'Session cleaned up' });
};

app.post('/cleanup', cleanupSession);
app.get('/cleanup', cleanupSession);

app.get('/ai-status', async (req, res) => {
  if (!aiService) {
    return res.json({ 
      enabled: false, 
      message: 'AI service not available - OPENAI_API_KEY not set' 
    });
  }
  
  try {
    const isWorking = await aiService.testConnection();
    res.json({ 
      enabled: true, 
      working: isWorking,
      message: isWorking ? 'AI service is working' : 'AI service connection failed'
    });
  } catch (error) {
    res.json({ 
      enabled: true, 
      working: false, 
      message: 'AI service connection failed',
      error: error.message
    });
  }
});

// Periodic cleanup of old temporary files (every hour)
function cleanupOldTempFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;
    
    let csvFilesCleanedUp = 0;
    let achievementFilesCleanedUp = 0;
    
    files.forEach(file => {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        cleanupTempFile(filePath);
        
        if (file.includes('achievements')) {
          achievementFilesCleanedUp++;
        } else {
          csvFilesCleanedUp++;
        }
      }
    });
    
    if (csvFilesCleanedUp > 0 || achievementFilesCleanedUp > 0) {
      console.log(`Periodic cleanup: ${csvFilesCleanedUp} CSV files, ${achievementFilesCleanedUp} achievement files`);
    }
  } catch (error) {
    console.error('Error during periodic cleanup:', error.message);
  }
}

// Clean up all temp files on server shutdown
function cleanupAllTempFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    let csvFiles = 0;
    let achievementFiles = 0;
    
    files.forEach(file => {
      const filePath = path.join(TEMP_DIR, file);
      cleanupTempFile(filePath);
      
      if (file.includes('achievements')) {
        achievementFiles++;
      } else {
        csvFiles++;
      }
    });
    
    console.log(`Shutdown cleanup: ${csvFiles} CSV files, ${achievementFiles} achievement files`);
  } catch (error) {
    console.error('Error cleaning up temp files on shutdown:', error.message);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...');
  cleanupAllTempFiles();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nGracefully shutting down...');
  cleanupAllTempFiles();
  process.exit(0);
});

async function startServer() {
	server.listen(PORT, () => {
	  console.log(`Server running on port ${PORT}`);
	  console.log(`AI Service: ${aiService ? 'Enabled' : 'Disabled (OPENAI_API_KEY not set)'}`);
	  console.log(`WebSocket server: Enabled`);
	  console.log(`Temporary files directory: ${TEMP_DIR}`);
	  
	  setInterval(cleanupOldTempFiles, 60 * 60 * 1000); // Every hour
	});
}

startServer();