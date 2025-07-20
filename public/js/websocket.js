class WebSocketManager {
    constructor(app, ui) {
        this.app = app;
        this.ui = ui;
        this.socket = null;
        this.reconnecting = false;
        this.connect();
    }
    
    connect() {
        this.socket = io({
            transports: ['websocket', 'polling'],
            timeout: 60000,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            maxReconnectionAttempts: 5,
            withCredentials: true,
            forceNew: false
        });
        
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        this.socket.on('connect', () => {
            if (this.reconnecting) {
                this.ui.hideConnectionError();
                this.reconnecting = false;
            }
        });
        
        this.socket.on('disconnect', (reason) => {
            if (this.app.isProcessing) {
                this.ui.showError('Connection lost during processing. Attempting to reconnect...');
                this.reconnecting = true;
            }
        });
        
        this.socket.on('connect_error', (error) => {
            if (this.app.isProcessing) {
                this.ui.showError('Connection error during processing. Please check your internet connection.');
            }
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            this.ui.hideConnectionError();
            this.reconnecting = false;
        });
        
        this.socket.on('reconnect_failed', () => {
            if (this.app.isProcessing) {
                this.ui.showError('Could not reconnect to server. Please refresh the page and try again.');
                this.ui.hideLoader();
                this.app.isProcessing = false;
                this.app.canCancel = false;
            }
        });
        
        this.setupProcessingEvents();
    }
    
    setupProcessingEvents() {
        this.socket.on('processing-started', (data) => {
            this.ui.setFavicon('📝');
            this.ui.updateProgress(0, data.message);
        });
        
        this.socket.on('chunk-progress', (data) => {
            let progressText = data.status;
            if (data.current && data.total) {
                progressText += ` (${data.current}/${data.total})`;
            }
            this.ui.updateProgress(data.progress || 0, progressText);
        });
        
        this.socket.on('chunk-completed', (data) => {
            this.ui.updateProgress(data.progress, `Completed step ${data.chunkIndex}`);
            
            if (data.partialResults && data.partialResults.length > 0) {
                this.ui.showPartialResults(data.partialResults);
            }
        });
        
        this.socket.on('processing-completed', (data) => {
            this.ui.hideLoader();
            this.app.isProcessing = false;
            this.app.canCancel = false;
            
            this.ui.setFavicon('✅');
            
            if (data.downloadReady) {
                this.app.downloadUrl = '/download';
                this.app.goToPhase(4);
            } else {
                this.app.achievements = data.achievements;
                this.app.selectedAchievements = new Set(data.achievements);
                this.app.setupPhase3();
                this.app.goToPhase(3);
            }
        });
        
        this.socket.on('processing-error', (data) => {
            this.ui.hideLoader();
            this.app.isProcessing = false;
            this.app.canCancel = false;
            this.ui.showError(data.error);
        });
        
        this.socket.on('processing-cancelled', (data) => {
            this.ui.hideLoader();
            this.app.isProcessing = false;
            this.app.canCancel = false;
            alert('Processing cancelled successfully');
        });
    }
    
    startProcessing(requestData) {
        if (this.app.isProcessing) {
            alert('Processing already in progress.');
            return;
        }
        
        this.ui.showLoader('Starting processing...', true);
        this.app.isProcessing = true;
        this.app.canCancel = true;
        
        this.socket.emit('start-processing', requestData);
    }
    
    startReprocessing(requestData) {
        if (this.app.isProcessing) {
            alert('Processing already in progress.');
            return;
        }
        
        this.ui.showLoader('Starting reprocessing...', true);
        this.app.isProcessing = true;
        this.app.canCancel = true;
        
        this.socket.emit('start-reprocessing', requestData);
    }
    
    cancelProcessing() {
        if (this.app.canCancel) {
            this.socket.emit('cancel-processing');
            this.ui.hideLoader();
        }
    }
}

window.WebSocketManager = WebSocketManager; 