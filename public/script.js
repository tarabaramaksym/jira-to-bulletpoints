class JiraConverter {
    constructor() {
        this.currentPhase = 1;
        this.uploadedFile = null;
        this.csvHeaders = [];
        this.filename = '';
        this.selectedFields = new Set();
        this.achievements = [];
        this.selectedAchievements = new Set();
        this.downloadUrl = '';
        this.socket = null;
        this.isProcessing = false;
        this.canCancel = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.connectWebSocket();
        
        // Set initial favicon to note emoji
        this.setFavicon('📝');
    }
    
    initializeElements() {
        this.phases = {
            1: document.getElementById('phase1'),
            2: document.getElementById('phase2'),
            3: document.getElementById('phase3'),
            4: document.getElementById('phase4')
        };
        
        this.progressSteps = document.querySelectorAll('.progress-step');
        this.uploadBox = document.getElementById('uploadBox');
        this.csvFileInput = document.getElementById('csvFileInput');
        this.fieldsContainer = document.getElementById('fieldsContainer');
        this.aiPromptTextarea = document.getElementById('aiPrompt');
        this.backBtn = document.getElementById('backBtn');
        this.processBtn = document.getElementById('processBtn');
        this.achievementsContainer = document.getElementById('achievementsContainer');
        this.additionalPromptTextarea = document.getElementById('additionalPrompt');
        this.backToConfigBtn = document.getElementById('backToConfigBtn');
        this.reprocessBtn = document.getElementById('reprocessBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.startOverBtn = document.getElementById('startOverBtn');
        this.loader = document.getElementById('loader');
        this.loaderText = document.getElementById('loaderText');
    }
    
    connectWebSocket() {
        this.socket = io({
            transports: ['websocket', 'polling'],
            timeout: 60000,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            maxReconnectionAttempts: 5,
            withCredentials: true,  // Send cookies with the connection
            forceNew: false  // Reuse existing connection
        });
        
        this.socket.on('connect', () => {
            console.log('WebSocket connected');
            if (this.reconnecting) {
                this.hideConnectionError();
                this.reconnecting = false;
            }
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('WebSocket disconnected:', reason);
            if (this.isProcessing) {
                this.showError('Connection lost during processing. Attempting to reconnect...');
                this.reconnecting = true;
            }
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            if (this.isProcessing) {
                this.showError('Connection error during processing. Please check your internet connection.');
            }
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            console.log('WebSocket reconnected after', attemptNumber, 'attempts');
            this.hideConnectionError();
            this.reconnecting = false;
        });
        
        this.socket.on('reconnect_failed', () => {
            console.error('WebSocket reconnection failed');
            if (this.isProcessing) {
                this.showError('Could not reconnect to server. Please refresh the page and try again.');
                this.hideLoader();
                this.isProcessing = false;
                this.canCancel = false;
            }
        });
        
        this.socket.on('processing-started', (data) => {
            console.log('Processing started:', data);
            // Reset favicon to note emoji when processing starts
            this.setFavicon('📝');
            this.updateProgress(0, data.message);
        });
        
        this.socket.on('chunk-progress', (data) => {
            console.log('Chunk progress:', data);
            let progressText = data.status;
            if (data.current && data.total) {
                progressText += ` (${data.current}/${data.total})`;
            }
            this.updateProgress(data.progress || 0, progressText);
        });
        
        this.socket.on('chunk-completed', (data) => {
            console.log('Chunk completed:', data);
            this.updateProgress(data.progress, `Completed step ${data.chunkIndex}`);
            
            if (data.partialResults && data.partialResults.length > 0) {
                this.showPartialResults(data.partialResults);
            }
        });
        
        this.socket.on('processing-completed', (data) => {
            console.log('Processing completed:', data);
            this.hideLoader();
            this.isProcessing = false;
            this.canCancel = false;
            
            // Change favicon to checkmark when processing is done
            this.setFavicon('✅');
            
            if (data.downloadReady) {
                this.downloadUrl = '/download';
                this.goToPhase(4);
            } else {
                this.achievements = data.achievements;
                this.selectedAchievements = new Set(data.achievements);
                this.setupPhase3();
                this.goToPhase(3);
            }
        });
        
        this.socket.on('processing-error', (data) => {
            console.error('Processing error:', data);
            this.hideLoader();
            this.isProcessing = false;
            this.canCancel = false;
            this.showError(data.error);
        });
        
        this.socket.on('processing-cancelled', (data) => {
            console.log('Processing cancelled:', data);
            this.hideLoader();
            this.isProcessing = false;
            this.canCancel = false;
            alert('Processing cancelled successfully');
        });
    }
    
    setupEventListeners() {
        this.uploadBox.addEventListener('click', () => this.csvFileInput.click());
        this.csvFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        this.backBtn.addEventListener('click', () => this.goToPhase(1));
        this.processBtn.addEventListener('click', () => this.processFile());
        this.backToConfigBtn.addEventListener('click', () => this.goToPhase(2));
        this.reprocessBtn.addEventListener('click', () => this.reprocessAchievements());
        this.downloadBtn.addEventListener('click', () => this.downloadFile());
        this.startOverBtn.addEventListener('click', () => this.startOver());
        
        // Note: Removed beforeunload cleanup as it was interfering with downloads
        // The download endpoint handles its own cleanup after successful download
    }
    
    setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.uploadBox.addEventListener(eventName, this.preventDefaults, false);
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            this.uploadBox.addEventListener(eventName, () => this.uploadBox.classList.add('dragover'), false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            this.uploadBox.addEventListener(eventName, () => this.uploadBox.classList.remove('dragover'), false);
        });
        
        this.uploadBox.addEventListener('drop', (e) => this.handleDrop(e), false);
    }
    
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            this.handleFileSelect({ target: { files: files } });
        }
    }
    
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.csv')) {
            alert('Please select a CSV file.');
            return;
        }
        
        this.showLoader('Uploading file...');
        
        const formData = new FormData();
        formData.append('csvFile', file);
        
        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.filename = result.filename;
                this.csvHeaders = result.headers;
                this.selectedFields = new Set(result.headers);
                this.setupPhase2();
                this.goToPhase(2);
            } else {
                alert('Upload failed: ' + result.error);
            }
        } catch (error) {
            alert('Upload failed: ' + error.message);
        } finally {
            this.hideLoader();
        }
    }
    
    setupPhase2() {
        this.fieldsContainer.innerHTML = '';
        
        this.csvHeaders.forEach(header => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `field-${header}`;
            checkbox.checked = this.selectedFields.has(header);
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedFields.add(header);
                } else {
                    this.selectedFields.delete(header);
                }
            });
            
            const label = document.createElement('label');
            label.htmlFor = `field-${header}`;
            label.textContent = header;
            
            fieldDiv.appendChild(checkbox);
            fieldDiv.appendChild(label);
            this.fieldsContainer.appendChild(fieldDiv);
        });
    }
    
    setupPhase3() {
        this.achievementsContainer.innerHTML = '';
        
        this.achievements.forEach((achievement, index) => {
            const achievementDiv = document.createElement('div');
            achievementDiv.className = 'achievement-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `achievement-${index}`;
            checkbox.checked = this.selectedAchievements.has(achievement);
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedAchievements.add(achievement);
                } else {
                    this.selectedAchievements.delete(achievement);
                }
            });
            
            const label = document.createElement('label');
            label.htmlFor = `achievement-${index}`;
            label.textContent = achievement;
            
            achievementDiv.appendChild(checkbox);
            achievementDiv.appendChild(label);
            this.achievementsContainer.appendChild(achievementDiv);
        });
    }
    
    processFile() {
        if (this.selectedFields.size === 0) {
            alert('Please select at least one field to include in the output.');
            return;
        }
        
        if (this.isProcessing) {
            alert('Processing already in progress.');
            return;
        }
        
        this.showLoader('Starting processing...', true);
        this.isProcessing = true;
        this.canCancel = true;
        
        const requestData = {
            selectedFields: Array.from(this.selectedFields),
            aiPrompt: this.aiPromptTextarea.value.trim(),
        };
        
        this.socket.emit('start-processing', requestData);
    }
    
    reprocessAchievements() {
        if (this.selectedAchievements.size === 0) {
            alert('Please select at least one achievement to include.');
            return;
        }
        
        if (this.isProcessing) {
            alert('Processing already in progress.');
            return;
        }
        
        this.showLoader('Starting reprocessing...', true);
        this.isProcessing = true;
        this.canCancel = true;
        
        const requestData = {
            selectedAchievements: Array.from(this.selectedAchievements),
            additionalPrompt: this.additionalPromptTextarea.value.trim()
        };
        
        this.socket.emit('start-reprocessing', requestData);
    }
    
    cancelProcessing() {
        if (this.canCancel) {
            this.socket.emit('cancel-processing');
            this.hideLoader();
        }
    }
    
    async downloadFile() {
        if (this.downloadUrl) {
            // The download endpoint will handle its own cleanup after successful download
            window.location.href = this.downloadUrl;
        }
    }
    
    async startOver() {
        try {
            await fetch('/cleanup', { method: 'POST' });
        } catch (error) {
            console.warn('Cleanup failed:', error);
        }
        
        // Reset favicon back to note emoji when starting over
        this.setFavicon('📝');
        
        this.currentPhase = 1;
        this.uploadedFile = null;
        this.csvHeaders = [];
        this.filename = '';
        this.selectedFields = new Set();
        this.achievements = [];
        this.selectedAchievements = new Set();
        this.downloadUrl = '';
        this.isProcessing = false;
        this.canCancel = false;
        
        this.csvFileInput.value = '';
        this.aiPromptTextarea.value = '';
        this.additionalPromptTextarea.value = '';
        this.fieldsContainer.innerHTML = '';
        this.achievementsContainer.innerHTML = '';
        
        this.goToPhase(1);
    }
    
    goToPhase(phase) {
        Object.values(this.phases).forEach(p => p.classList.remove('active'));
        this.phases[phase].classList.add('active');
        this.currentPhase = phase;
        this.updateProgressBar(phase);
    }
    
    updateProgressBar(currentPhase) {
        this.progressSteps.forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.remove('active', 'completed');
            
            if (stepNumber < currentPhase) {
                step.classList.add('completed');
            } else if (stepNumber === currentPhase) {
                step.classList.add('active');
            }
        });
        
        const progressFills = document.querySelectorAll('.progress-fill');
        progressFills.forEach((fill, index) => {
            if (index < currentPhase - 1) {
                fill.style.width = '100%';
            } else {
                fill.style.width = '0%';
            }
        });
    }
    
    showLoader(text, showCancel = false) {
        this.loaderText.textContent = text;
        this.loader.classList.remove('hidden');
        
        let existingCancelBtn = this.loader.querySelector('.cancel-btn');
        if (existingCancelBtn) {
            existingCancelBtn.remove();
        }
        
        if (showCancel) {
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel Processing';
            cancelBtn.className = 'btn btn-secondary cancel-btn';
            cancelBtn.style.marginTop = '20px';
            cancelBtn.addEventListener('click', () => this.cancelProcessing());
            this.loader.appendChild(cancelBtn);
        }
    }
    
    hideLoader() {
        this.loader.classList.add('hidden');
        
        // Reset the fixed structure instead of removing elements
        const progressContainer = document.getElementById('progressContainer');
        if (progressContainer) {
            progressContainer.innerHTML = '';
        }
        
        const partialResultsDiv = document.getElementById('partialResults');
        const resultsContent = document.getElementById('resultsContent');
        if (partialResultsDiv && resultsContent) {
            partialResultsDiv.classList.remove('visible');
            resultsContent.innerHTML = '';
        }
        
        const cancelBtn = document.getElementById('cancelBtn');
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
    }
    
    updateProgress(progress, text) {
        this.loaderText.textContent = text;
        
        const progressContainer = document.getElementById('progressContainer');
        if (progressContainer) {
            progressContainer.innerHTML = `
                <div style="background: #e0e0e0; border-radius: 10px; overflow: hidden; margin-top: 10px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 20px; border-radius: 10px; transition: width 0.3s ease; width: ${progress || 0}%;"></div>
                </div>
                <div style="text-align: center; margin-top: 5px; font-size: 14px; color: #666;">
                    ${progress ? Math.round(progress) + '%' : ''}
                </div>
            `;
        }
    }
    
    showPartialResults(results) {
        const partialResultsDiv = document.getElementById('partialResults');
        const resultsContent = document.getElementById('resultsContent');
        
        if (partialResultsDiv && resultsContent) {
            // Show the partial results area
            partialResultsDiv.classList.add('visible');
            
            // Update the content
            resultsContent.innerHTML = results.map(result => 
                `<div>${result}</div>`
            ).join('');
        }
    }
    
    showError(message) {
        this.hideConnectionError(); // Clear any existing error
        
        let errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dc3545;
            color: white;
            padding: 15px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1001;
            max-width: 300px;
            font-size: 14px;
            line-height: 1.4;
        `;
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        // Auto-hide non-critical errors after 5 seconds
        if (!message.includes('refresh') && !message.includes('reconnect')) {
            setTimeout(() => {
                this.hideConnectionError();
            }, 5000);
        }
    }
    


    setFavicon(emoji) {
        // Remove existing favicon
        const existingFavicon = document.querySelector('link[rel="icon"]');
        if (existingFavicon) {
            existingFavicon.remove();
        }
        
        // Create new favicon with the specified emoji
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.href = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`;
        document.head.appendChild(favicon);
    }

    hideConnectionError() {
        const existingError = document.querySelector('.connection-error');
        if (existingError) {
            existingError.remove();
        }
    }
}

const converter = new JiraConverter(); 