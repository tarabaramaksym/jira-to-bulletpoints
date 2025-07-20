const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { sessionMiddleware, sessionStore, fallbackStorage, wrap } = require('./middleware/sessionMiddleware');
const { handleConnection } = require('./websocket/socketHandler');
const ProcessingService = require('./services/ProcessingService');
const FileManager = require('./services/FileManager');
const { PORT, CLEANUP_INTERVAL } = require('./utils/constants');

const server = http.createServer(app);
const io = new Server(server);
const processingService = new ProcessingService();

io.use(wrap(sessionMiddleware));

handleConnection(io, processingService);

sessionStore.on('destroy', (sessionId) => {
  const sessionData = fallbackStorage.get(sessionId);
  if (sessionData) {
    setTimeout(() => {
      if (sessionData.csvData && sessionData.csvData.filePath) {
        FileManager.cleanupTempFile(sessionData.csvData.filePath);
      }
      if (sessionData.finalData && sessionData.finalData.filePath) {
        FileManager.cleanupTempFile(sessionData.finalData.filePath);
      }
      fallbackStorage.delete(sessionId);
    }, 10 * 60 * 1000);
  }
});

process.on('SIGINT', () => {
  FileManager.cleanupAllTempFiles();
  process.exit(0);
});

process.on('SIGTERM', () => {
  FileManager.cleanupAllTempFiles();
  process.exit(0);
});

const startServer = async () => {
  server.listen(PORT, () => {
    setInterval(FileManager.cleanupOldTempFiles, CLEANUP_INTERVAL);
  });
};

startServer(); 