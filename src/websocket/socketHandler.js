const SessionManager = require('../services/SessionManager');
const processingEvents = require('./events/processingEvents');
const reprocessingEvents = require('./events/reprocessingEvents');

const handleConnection = (io, processingService) => {
  io.on('connection', (socket) => {
    const session = socket.request.session;
    const sessionId = session ? session.id : 'no-session';
    
    processingService.initializeState(socket.id, sessionId);
    
    socket.on('start-processing', async (data) => {
      await processingEvents.handleProcessing(socket, data, processingService);
    });
    
    socket.on('start-reprocessing', async (data) => {
      await reprocessingEvents.handleReprocessing(socket, data, processingService);
    });
    
    socket.on('cancel-processing', () => {
      const cancelled = processingService.cancelProcessing(socket.id);
      if (cancelled) {
        socket.emit('processing-cancelled', { message: 'Processing cancelled successfully' });
      } else {
        socket.emit('processing-error', { error: 'No cancellable operation in progress' });
      }
    });
    
    socket.on('disconnect', () => {
      processingService.cleanupState(socket.id);
    });
  });
};

module.exports = {
  handleConnection
}; 