const SessionManager = require('../../services/SessionManager');

const handleProcessing = async (socket, data, processingService) => {
  const socketSession = socket.request.session;
  const sessionId = socketSession ? socketSession.id : null;
  
  if (!sessionId) {
    socket.emit('processing-error', { error: 'No session ID available' });
    return;
  }

  SessionManager.getSessionData(sessionId, async (err, sessionData) => {
    let actualSessionId = sessionId;
    
    if (err || !sessionData || !sessionData.csvData) {
      let fallbackData = SessionManager.findSessionWithData('csvData');
      
      if (!fallbackData) {
        socket.emit('processing-error', { error: 'No CSV data found. Please upload a file first.' });
        return;
      }
      
      sessionData = fallbackData.sessionData;
      actualSessionId = fallbackData.sessionId;
    }

    if (!sessionData.csvData || !sessionData.csvData.filePath) {
      socket.emit('processing-error', { error: 'No CSV data found in session. Please upload a file first.' });
      return;
    }

    await processingService.processData(socket, data, sessionData, actualSessionId);
  });
};

module.exports = {
  handleProcessing
}; 