const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const AIService = require('./services/AIService');
const CSVProcessor = require('./services/CSVProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

const aiService = process.env.OPENAI_API_KEY ? new AIService(process.env.OPENAI_API_KEY) : null;
const csvProcessor = new CSVProcessor(500);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use(session({
  secret: 'jira-converter-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 1000 * 60 * 60 * 2
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

app.post('/upload', upload.single('csvFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const csvContent = req.file.buffer.toString('utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  
  const uniqueHeaders = [...new Set(headers)];
  
  req.session.csvData = {
    content: csvContent,
    filename: req.file.originalname,
    headers: uniqueHeaders,
    originalHeaders: headers,
    rowCount: lines.length - 1,
    uploadTime: new Date()
  };
  
  res.json({
    success: true,
    filename: req.file.originalname,
    headers: uniqueHeaders,
    originalHeaders: headers,
    rowCount: lines.length - 1
  });
});

app.post('/process', async (req, res) => {
  const { selectedFields, aiPrompt, systemPrompt } = req.body;
  
  if (!req.session.csvData) {
    return res.status(400).json({ error: 'No file data in session' });
  }
  
  try {
    let processedContent = req.session.csvData.content;
    
    if (aiService && selectedFields.length > 0) {
      const parsedData = csvProcessor.parseCsvData(req.session.csvData.content, selectedFields);
      const chunks = csvProcessor.createChunks(parsedData);
      const stats = csvProcessor.getProcessingStats(parsedData);
      
      console.log(`Processing ${stats.totalRecords} records in ${stats.chunkCount} chunks`);
      
      const processedChunks = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const formattedChunk = csvProcessor.formatChunkForAI(chunk);
        
        console.log(`Processing chunk ${i + 1}/${chunks.length}`);
        
        const chunkResult = await aiService.processChunk(formattedChunk, aiPrompt, systemPrompt);
        processedChunks.push(chunkResult);
      }
      
      const combinedBulletpoints = csvProcessor.combineChunksForDeduplication(processedChunks);
      
      console.log('Running final deduplication...');
      const finalResult = await aiService.deduplicateBulletpoints(combinedBulletpoints);
      
      processedContent = csvProcessor.formatFinalOutput([finalResult]);
    }
    
    req.session.processedData = {
      selectedFields,
      aiPrompt,
      systemPrompt,
      processTime: new Date(),
      processedContent
    };
    
    res.json({
      success: true,
      downloadUrl: '/download',
      processedFields: selectedFields,
      aiPrompt,
      systemPrompt,
      aiEnabled: !!aiService
    });
    
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ 
      error: 'Processing failed', 
      details: error.message,
      aiEnabled: !!aiService
    });
  }
});

app.get('/download', (req, res) => {
  if (!req.session.csvData || !req.session.processedData) {
    return res.status(404).json({ error: 'No processed data available' });
  }
  
  const csvData = req.session.csvData;
  const processedData = req.session.processedData;
  
  const processedContent = processedData.processedContent || csvData.content;
  
  const originalFilename = csvData.filename;
  const processedFilename = `processed-${originalFilename}`;
  
  res.setHeader('Content-disposition', `attachment; filename="${processedFilename}"`);
  res.setHeader('Content-type', 'text/csv');
  res.send(processedContent);
});

const cleanupSession = (req, res) => {
  if (req.session.csvData) {
    delete req.session.csvData;
  }
  if (req.session.processedData) {
    delete req.session.processedData;
  }
  
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