const SessionManager = require('../services/SessionManager');
const FileManager = require('../services/FileManager');

const cleanupSession = (req, res) => {
  const sessionId = req.sessionID;
  
  if (req.session.csvData && req.session.csvData.filePath) {
    FileManager.cleanupTempFile(req.session.csvData.filePath);
  }
  if (req.session.finalData && req.session.finalData.filePath) {
    FileManager.cleanupTempFile(req.session.finalData.filePath);
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
  
  SessionManager.cleanupSession(sessionId);
  
  res.json({ success: true, message: 'Session cleaned up' });
};

module.exports = {
  cleanupSession
}; 