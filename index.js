require('dotenv').config();

const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');
const crypto = require('crypto');
const AIService = require('./services/AIService');
const CSVProcessor = require('./services/CSVProcessor');

const app = express();
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

// Clean up fallback storage and temp files when sessions are destroyed
sessionStore.on('destroy', (sessionId) => {
  const sessionData = fallbackStorage.get(sessionId);
  if (sessionData) {
    if (sessionData.csvData && sessionData.csvData.filePath) {
      cleanupTempFile(sessionData.csvData.filePath);
    }
    if (sessionData.finalData && sessionData.finalData.filePath) {
      cleanupTempFile(sessionData.finalData.filePath);
    }
  }
  fallbackStorage.delete(sessionId);
});

app.use(session({
  store: sessionStore,
  secret: 'jira-converter-secret-key',
  resave: true,  // Force session save even if not modified
  saveUninitialized: false,
  rolling: true,  // Reset expiration on each request
  cookie: { 
    secure: false,
    maxAge: 1000 * 60 * 60 * 2,  // 2 hours
    httpOnly: true
  }
}));

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
    
    res.json({
      success: true,
      filename: req.file.originalname,
      headers: uniqueHeaders,
      originalHeaders: headers,
      rowCount: rowCount
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
  // Try to reload session data
  req.session.reload((err) => {
    if (!req.session.csvData || !req.session.finalData) {
      // Try to recover from fallback storage
      const fallbackData = fallbackStorage.get(req.sessionID);
      if (fallbackData) {
        req.session.csvData = fallbackData.csvData;
        req.session.processedData = fallbackData.processedData;
        req.session.finalData = fallbackData.finalData;
        processDownload(req, res);
      } else {
        return res.status(404).json({ error: 'No processed data available' });
      }
    } else {
      processDownload(req, res);
    }
  });
});

function processDownload(req, res) {
  const csvData = req.session.csvData;
  const finalData = req.session.finalData;
  
  let processedContent;
  
  if (finalData.filePath && fs.existsSync(finalData.filePath)) {
    try {
      processedContent = fs.readFileSync(finalData.filePath, 'utf8');
    } catch (error) {
      console.error('Failed to read achievements file:', error.message);
      processedContent = finalData.achievements.join('\n\n');
    }
  } else {
    processedContent = finalData.achievements.join('\n\n');
  }
  
  const originalFilename = csvData.filename;
  const baseFilename = originalFilename.replace(/\.[^/.]+$/, ""); // Remove extension
  const processedFilename = `${baseFilename}-resume-achievements.txt`;
  
  res.setHeader('Content-disposition', `attachment; filename="${processedFilename}"`);
  res.setHeader('Content-type', 'text/plain');
  
  // Clean up temporary files after download
  if (csvData.filePath) {
    cleanupTempFile(csvData.filePath);
  }
  if (finalData.filePath) {
    cleanupTempFile(finalData.filePath);
  }
  
  // Clean up session data
  delete req.session.csvData;
  delete req.session.processedData;
  delete req.session.finalData;
  fallbackStorage.delete(req.sessionID);
  
  res.send(processedContent);
}

const cleanupSession = (req, res) => {
  // Clean up temporary files if they exist
  if (req.session.csvData && req.session.csvData.filePath) {
    cleanupTempFile(req.session.csvData.filePath);
  }
  if (req.session.finalData && req.session.finalData.filePath) {
    cleanupTempFile(req.session.finalData.filePath);
  }
  
  if (req.session.csvData) {
    delete req.session.csvData;
  }
  if (req.session.processedData) {
    delete req.session.processedData;
  }
  if (req.session.finalData) {
    delete req.session.finalData;
  }
  
  // Clean up fallback storage
  fallbackStorage.delete(req.sessionID);
  
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
	app.listen(PORT, () => {
	  console.log(`Server running on port ${PORT}`);
	  console.log(`AI Service: ${aiService ? 'Enabled' : 'Disabled (OPENAI_API_KEY not set)'}`);
	  console.log(`Temporary files directory: ${TEMP_DIR}`);
	  
	  setInterval(cleanupOldTempFiles, 60 * 60 * 1000); // Every hour
	});
}

startServer();