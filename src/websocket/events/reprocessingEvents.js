const SessionManager = require('../../services/SessionManager');

const handleReprocessing = async (socket, data, processingService) => {
  const socketSession = socket.request.session;
  const sessionId = socketSession ? socketSession.id : null;
  
  if (!sessionId) {
    socket.emit('processing-error', { error: 'No session ID available' });
    return;
  }

  SessionManager.getSessionData(sessionId, async (err, sessionData) => {
    let actualSessionId = sessionId;
    
    if (err || !sessionData || !sessionData.processedData) {
      let fallbackData = SessionManager.findSessionWithData('processedData');
      
      if (!fallbackData) {
        socket.emit('processing-error', { error: 'No processed data available. Please process a file first.' });
        return;
      }
      
      sessionData = fallbackData.sessionData;
      actualSessionId = fallbackData.sessionId;
    }

    await processingService.reprocessData(socket, data, sessionData, actualSessionId);
  });
};

module.exports = {
  handleReprocessing
}; 