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
        this.isProcessing = false;
        this.canCancel = false;
        
        this.ui = new UIManager();
        this.websocket = new WebSocketManager(this, this.ui);
        
        this.setupEventListeners();
        this.ui.setFavicon('📝');
    }
    
    setupEventListeners() {
        this.ui.uploadBox.addEventListener('click', () => this.ui.csvFileInput.click());
        this.ui.csvFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.ui.uploadBox.addEventListener('drop', (e) => this.handleDrop(e), false);
        
        this.ui.backBtn.addEventListener('click', () => this.goToPhase(1));
        this.ui.processBtn.addEventListener('click', () => this.processFile());
        this.ui.backToConfigBtn.addEventListener('click', () => this.goToPhase(2));
        this.ui.reprocessBtn.addEventListener('click', () => this.reprocessAchievements());
        this.ui.downloadBtn.addEventListener('click', () => this.downloadFile());
        this.ui.startOverBtn.addEventListener('click', () => this.startOver());
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
        
        this.ui.showLoader('Uploading file...');
        
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
            this.ui.hideLoader();
        }
    }
    
    setupPhase2() {
        this.ui.setupPhase2(this.csvHeaders, this.selectedFields);
    }
    
    setupPhase3() {
        this.ui.setupPhase3(this.achievements, this.selectedAchievements);
    }
    
    processFile() {
        if (this.selectedFields.size === 0) {
            alert('Please select at least one field to include in the output.');
            return;
        }
        
        const requestData = {
            selectedFields: Array.from(this.selectedFields),
            aiPrompt: this.ui.aiPromptTextarea.value.trim(),
        };
        
        this.websocket.startProcessing(requestData);
    }
    
    reprocessAchievements() {
        if (this.selectedAchievements.size === 0) {
            alert('Please select at least one achievement to include.');
            return;
        }
        
        const requestData = {
            selectedAchievements: Array.from(this.selectedAchievements),
            additionalPrompt: this.ui.additionalPromptTextarea.value.trim()
        };
        
        this.websocket.startReprocessing(requestData);
    }
    
    cancelProcessing() {
        this.websocket.cancelProcessing();
    }
    
    async downloadFile() {
        if (this.downloadUrl) {
            window.location.href = this.downloadUrl;
        }
    }
    
    async startOver() {
        try {
            await fetch('/cleanup', { method: 'POST' });
        } catch (error) {
            // Silent fail for cleanup
        }
        
        this.ui.setFavicon('📝');
        
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
        
        this.ui.resetForm();
        this.goToPhase(1);
    }
    
    goToPhase(phase) {
        this.currentPhase = phase;
        this.ui.goToPhase(phase);
    }
}

window.JiraConverter = JiraConverter; 