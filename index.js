require('dotenv').config();

const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const AIService = require('./services/AIService');
const CSVProcessor = require('./services/CSVProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

const aiService = process.env.OPENAI_API_KEY ? new AIService(process.env.OPENAI_API_KEY) : null;
const csvProcessor = new CSVProcessor(50); // Even smaller chunks for context window safety

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const MemoryStore = require('express-session').MemoryStore;
const sessionStore = new MemoryStore();

// Fallback storage for session data
const fallbackStorage = new Map();

// Clean up fallback storage when sessions are destroyed
sessionStore.on('destroy', (sessionId) => {
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
  storage: multer.memoryStorage(),
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    const csvContent = req.file.buffer.toString('utf8');
    const headers = await csvProcessor.getHeaders(csvContent);
    const uniqueHeaders = [...new Set(headers)];
    
    // Count rows by splitting lines (approximation for display)
    const lines = csvContent.split('\n').filter(line => line.trim());
    const rowCount = Math.max(0, lines.length - 1);
    
    req.session.csvData = {
      content: csvContent,
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
    res.status(400).json({ error: 'Invalid CSV format: ' + error.message });
  }
});

app.post('/process', async (req, res) => {
  const { selectedFields, aiPrompt } = req.body;
  
  if (!req.session.csvData) {
    return res.status(400).json({ error: 'No file data in session' });
  }
  
  try {
    let processedContent = req.session.csvData.content;
    
    if (aiService && selectedFields.length > 0) {
      const parsedData = await csvProcessor.parseCsvData(req.session.csvData.content, selectedFields);
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
    
    // Store the final achievements for download
    const finalDataObj = {
      achievements: finalAchievements,
      additionalPrompt: additionalPrompt || null,
      processTime: new Date()
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
  
  // Format the achievements for download
  const processedContent = finalData.achievements.join('\n\n');
  
  const originalFilename = csvData.filename;
  const baseFilename = originalFilename.replace(/\.[^/.]+$/, ""); // Remove extension
  const processedFilename = `${baseFilename}-resume-achievements.txt`;
  
  res.setHeader('Content-disposition', `attachment; filename="${processedFilename}"`);
  res.setHeader('Content-type', 'text/plain');
  
  res.send(processedContent);
}

const cleanupSession = (req, res) => {
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

async function startServer() {
	app.listen(PORT, () => {
	  console.log(`Server running on port ${PORT}`);
	  console.log(`AI Service: ${aiService ? 'Enabled' : 'Disabled (OPENAI_API_KEY not set)'}`);
	});
}

startServer();