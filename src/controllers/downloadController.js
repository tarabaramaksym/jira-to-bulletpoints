const fs = require('fs');
const SessionManager = require('../services/SessionManager');
const FileManager = require('../services/FileManager');

const downloadFile = (req, res) => {
  const sessionId = req.sessionID;
  
  SessionManager.getSessionData(sessionId, (err, sessionData) => {
    if (err || !sessionData || !sessionData.finalData) {
      let fallbackData = SessionManager.findSessionWithData('finalData');
      
      if (!fallbackData) {
        return res.status(404).json({ error: 'No processed data available' });
      }
      
      sessionData = fallbackData.sessionData;
    }
    
    processDownload(sessionData, res);
  });
};

const processDownload = (sessionData, res) => {
  const csvData = sessionData.csvData;
  const finalData = sessionData.finalData;
  
  if (!csvData || !finalData) {
    return res.status(404).json({ error: 'No processed data available' });
  }
  
  let processedContent;
  
  if (finalData.filePath && fs.existsSync(finalData.filePath)) {
    try {
      processedContent = fs.readFileSync(finalData.filePath, 'utf8');
    } catch (error) {
      processedContent = finalData.achievements.join('\n\n');
    }
  } else {
    processedContent = finalData.achievements.join('\n\n');
  }
  
  const originalFilename = csvData.filename;
  const baseFilename = originalFilename.replace(/\.[^/.]+$/, "");
  const processedFilename = `${baseFilename}-resume-achievements.txt`;
  
  res.setHeader('Content-disposition', `attachment; filename="${processedFilename}"`);
  res.setHeader('Content-type', 'text/plain');
  
  res.send(processedContent);
  
  setTimeout(() => {
    if (csvData.filePath) {
      FileManager.cleanupTempFile(csvData.filePath);
    }
    if (finalData.filePath) {
      FileManager.cleanupTempFile(finalData.filePath);
    }
    
    const sessionId = sessionData.id || sessionData.sessionID;
    if (sessionId) {
      SessionManager.cleanupSession(sessionId);
    }
  }, 5000);
};

module.exports = {
  downloadFile
}; 