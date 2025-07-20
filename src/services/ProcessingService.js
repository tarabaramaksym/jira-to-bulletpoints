const fs = require('fs');
const AIService = require('./AIService');
const CSVProcessor = require('./CSVProcessor');
const FileManager = require('./FileManager');
const SessionManager = require('./SessionManager');
const { CHUNK_SIZE } = require('../utils/constants');

class ProcessingService {
  constructor() {
    this.aiService = process.env.OPENAI_API_KEY ? new AIService(process.env.OPENAI_API_KEY) : null;
    this.csvProcessor = new CSVProcessor(CHUNK_SIZE);
    this.processingState = new Map();
  }

  async processData(socket, { selectedFields, aiPrompt }, sessionData, sessionId) {
    const state = this.processingState.get(socket.id);
    
    if (!fs.existsSync(sessionData.csvData.filePath)) {
      socket.emit('processing-error', { error: 'CSV file no longer exists' });
      return;
    }

    if (!selectedFields || selectedFields.length === 0) {
      socket.emit('processing-error', { error: 'No fields selected for processing' });
      return;
    }

    state.isProcessing = true;
    state.canCancel = true;
    state.currentOperation = 'processing';

    try {
      socket.emit('processing-started', { message: 'Starting processing...', totalChunks: 'calculating' });

      const csvContent = fs.readFileSync(sessionData.csvData.filePath, 'utf8');
      
      if (this.aiService) {
        const parsedData = await this.csvProcessor.parseCsvData(csvContent, selectedFields);
        const chunks = this.csvProcessor.createChunks(parsedData);
        const totalSteps = chunks.length + 1;
        
        socket.emit('chunk-progress', { 
          current: 0, 
          total: totalSteps, 
          status: `Starting processing of ${chunks.length} chunks + deduplication...` 
        });

        const processedChunks = [];
        
        for (let i = 0; i < chunks.length; i++) {
          if (!state.isProcessing) {
            socket.emit('processing-cancelled', { message: 'Processing cancelled by user' });
            return;
          }

          const chunk = chunks[i];
          const currentStep = i + 1;
          
          socket.emit('chunk-progress', { 
            current: currentStep, 
            total: totalSteps, 
            status: `Processing data chunk ${currentStep} of ${chunks.length}...` 
          });

          try {
            const formattedChunk = this.csvProcessor.formatChunkForAI(chunk);
            const chunkResult = await this.aiService.processChunk(formattedChunk, aiPrompt);
            processedChunks.push(chunkResult);
            
            socket.emit('chunk-completed', { 
              chunkIndex: currentStep, 
              progress: Math.round((currentStep / totalSteps) * 100),
              partialResults: chunkResult.split('\n').filter(line => line.trim()).slice(0, 3)
            });
          } catch (chunkError) {
            socket.emit('processing-error', { 
              error: `Failed to process chunk ${currentStep}: ${chunkError.message}`,
              canRetry: true 
            });
            return;
          }
        }

        socket.emit('chunk-progress', { 
          current: totalSteps, 
          total: totalSteps, 
          status: 'Performing final deduplication...' 
        });

        const combinedBulletpoints = this.csvProcessor.combineChunksForDeduplication(processedChunks);
        const finalResult = await this.aiService.deduplicateBulletpoints(combinedBulletpoints);
        
        socket.emit('chunk-completed', { 
          chunkIndex: totalSteps, 
          progress: 100,
          partialResults: ['Deduplication completed successfully']
        });
        
        const achievements = finalResult.split('\n')
          .filter(line => line.trim())
          .map(line => line.replace(/^[\s\-\*•]+/, '').trim())
          .filter(line => line.length > 0);

        sessionData.processedData = {
          selectedFields,
          aiPrompt,
          processTime: new Date(),
          achievements: achievements
        };

        if (!sessionData.id && !sessionData.sessionID) {
          sessionData.id = sessionId;
        }

        SessionManager.saveSessionData(sessionData, () => {
          socket.emit('processing-completed', {
            achievements: achievements,
            totalAchievements: achievements.length,
            progress: 100
          });
        });

      } else {
        const achievements = ['Original CSV content (AI processing not available)'];
        sessionData.processedData = {
          selectedFields,
          aiPrompt,
          processTime: new Date(),
          achievements: achievements
        };

        if (!sessionData.id && !sessionData.sessionID) {
          sessionData.id = sessionId;
        }

        SessionManager.saveSessionData(sessionData, () => {
          socket.emit('processing-completed', {
            achievements: achievements,
            totalAchievements: achievements.length,
            progress: 100
          });
        });
      }

    } catch (error) {
      socket.emit('processing-error', { 
        error: 'Processing failed: ' + error.message,
        canRetry: true 
      });
    } finally {
      state.isProcessing = false;
      state.canCancel = false;
      state.currentOperation = null;
    }
  }

  async reprocessData(socket, { selectedAchievements, additionalPrompt }, sessionData, sessionId) {
    const state = this.processingState.get(socket.id);

    if (!selectedAchievements || selectedAchievements.length === 0) {
      socket.emit('processing-error', { error: 'No achievements selected' });
      return;
    }

    state.isProcessing = true;
    state.canCancel = true;
    state.currentOperation = 'reprocessing';

    try {
      socket.emit('processing-started', { message: 'Starting reprocessing...' });

      let finalAchievements = selectedAchievements;

      const totalSteps = additionalPrompt && additionalPrompt.trim() && this.aiService ? 2 : 1;
      
      socket.emit('chunk-progress', { 
        current: 1, 
        total: totalSteps, 
        status: totalSteps === 2 ? 'Preparing selected achievements...' : 'Finalizing selected achievements...' 
      });

      if (additionalPrompt && additionalPrompt.trim() && this.aiService) {
        socket.emit('chunk-progress', { 
          current: 2, 
          total: totalSteps, 
          status: 'Applying additional processing...' 
        });

        const achievementsText = selectedAchievements.join('\n');
        const reprocessedResult = await this.aiService.reprocessAchievements(achievementsText, additionalPrompt);
        
        finalAchievements = reprocessedResult.split('\n')
          .filter(line => line.trim())
          .map(line => line.replace(/^[\s\-\*•]+/, '').trim())
          .filter(line => line.length > 0);
        
        socket.emit('chunk-completed', { 
          chunkIndex: totalSteps, 
          progress: 100,
          partialResults: ['Additional processing completed successfully']
        });
      } else {
        socket.emit('chunk-completed', { 
          chunkIndex: 1, 
          progress: 100,
          partialResults: ['Achievement selection completed']
        });
      }

      const achievementsFilePath = FileManager.saveAchievementsToFile(finalAchievements, sessionId);
      
      const finalDataObj = {
        achievements: finalAchievements,
        additionalPrompt: additionalPrompt || null,
        processTime: new Date(),
        filePath: achievementsFilePath
      };
      
      sessionData.finalData = finalDataObj;

      if (!sessionData.id && !sessionData.sessionID) {
        sessionData.id = sessionId;
      }

      SessionManager.saveSessionData(sessionData, () => {
        socket.emit('processing-completed', {
          achievements: finalAchievements,
          totalAchievements: finalAchievements.length,
          downloadReady: true,
          progress: 100
        });
      });

    } catch (error) {
      socket.emit('processing-error', { 
        error: 'Reprocessing failed: ' + error.message,
        canRetry: true 
      });
    } finally {
      state.isProcessing = false;
      state.canCancel = false;
      state.currentOperation = null;
    }
  }

  initializeState(socketId, sessionId) {
    this.processingState.set(socketId, {
      sessionId: sessionId,
      isProcessing: false,
      canCancel: false,
      currentOperation: null
    });
  }

  cancelProcessing(socketId) {
    const state = this.processingState.get(socketId);
    if (state && state.isProcessing && state.canCancel) {
      state.isProcessing = false;
      state.canCancel = false;
      return true;
    }
    return false;
  }

  cleanupState(socketId) {
    this.processingState.delete(socketId);
  }
}

module.exports = ProcessingService; 