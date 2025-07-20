const fs = require('fs');
const CSVProcessor = require('../services/CSVProcessor');
const SessionManager = require('../services/SessionManager');
const FileManager = require('../services/FileManager');
const { CHUNK_SIZE } = require('../utils/constants');

const csvProcessor = new CSVProcessor(CHUNK_SIZE);

const uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    if (req.session.csvData && req.session.csvData.filePath) {
      FileManager.cleanupTempFile(req.session.csvData.filePath);
    }
    
    const csvContent = fs.readFileSync(req.file.path, 'utf8');
    const headers = await csvProcessor.getHeaders(csvContent);
    const uniqueHeaders = [...new Set(headers)];
    
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
    
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save session data' });
      }
      
      const sessionData = {
        id: req.sessionID,
        csvData: req.session.csvData,
        processedData: null,
        finalData: null
      };
      
      SessionManager.saveSessionData(sessionData, () => {
        res.json({
          success: true,
          filename: req.file.originalname,
          headers: uniqueHeaders,
          originalHeaders: headers,
          rowCount: rowCount
        });
      });
    });
  } catch (error) {
    if (req.file && req.file.path) {
      FileManager.cleanupTempFile(req.file.path);
    }
    res.status(400).json({ error: 'Invalid CSV format: ' + error.message });
  }
};

module.exports = {
  uploadFile
}; 