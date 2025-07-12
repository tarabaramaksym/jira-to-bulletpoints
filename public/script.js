class JiraConverter {
    constructor() {
        this.currentPhase = 1;
        this.uploadedFile = null;
        this.csvHeaders = [];
        this.filename = '';
        this.selectedFields = new Set();
        this.downloadUrl = '';
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupDragAndDrop();
    }
    
    initializeElements() {
        this.phases = {
            1: document.getElementById('phase1'),
            2: document.getElementById('phase2'),
            3: document.getElementById('phase3')
        };
        
        this.progressSteps = document.querySelectorAll('.progress-step');
        this.uploadBox = document.getElementById('uploadBox');
        this.csvFileInput = document.getElementById('csvFileInput');
        this.fieldsContainer = document.getElementById('fieldsContainer');
        this.aiPromptTextarea = document.getElementById('aiPrompt');
        this.systemPromptTextarea = document.getElementById('systemPrompt');
        this.systemPromptToggle = document.getElementById('systemPromptToggle');
        this.systemPromptContent = document.getElementById('systemPromptContent');
        this.backBtn = document.getElementById('backBtn');
        this.processBtn = document.getElementById('processBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.startOverBtn = document.getElementById('startOverBtn');
        this.loader = document.getElementById('loader');
        this.loaderText = document.getElementById('loaderText');
    }
    
    setupEventListeners() {
        this.uploadBox.addEventListener('click', () => this.csvFileInput.click());
        this.csvFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        this.systemPromptToggle.addEventListener('click', () => this.toggleSystemPrompt());
        this.backBtn.addEventListener('click', () => this.goToPhase(1));
        this.processBtn.addEventListener('click', () => this.processFile());
        this.downloadBtn.addEventListener('click', () => this.downloadFile());
        this.startOverBtn.addEventListener('click', () => this.startOver());
        
        window.addEventListener('beforeunload', () => {
            if (this.csvHeaders.length > 0) {
                navigator.sendBeacon('/cleanup', JSON.stringify({}));
            }
        });
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
        this.renderFieldsSelection();
        this.systemPromptTextarea.value = 'You are a helpful assistant that converts JIRA data into organized bulletpoints. Please maintain the structure and hierarchy of the information while making it more readable and actionable.';
    }
    
    renderFieldsSelection() {
        const headers = [...new Set(this.csvHeaders)];
        this.fieldsContainer.innerHTML = '';
        
        headers.forEach(header => {
            const fieldItem = document.createElement('div');
            fieldItem.className = 'field-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `field-${header}`;
            checkbox.checked = this.selectedFields.has(header);
            checkbox.addEventListener('change', () => this.toggleField(header));
            
            const label = document.createElement('label');
            label.htmlFor = `field-${header}`;
            label.textContent = header;
            label.style.cursor = 'pointer';
            label.style.flex = '1';
            
            fieldItem.appendChild(checkbox);
            fieldItem.appendChild(label);
            this.fieldsContainer.appendChild(fieldItem);
        });
    }
    
    toggleField(header) {
        if (this.selectedFields.has(header)) {
            this.selectedFields.delete(header);
        } else {
            this.selectedFields.add(header);
        }
    }
    
    toggleSystemPrompt() {
        const isActive = this.systemPromptContent.classList.contains('active');
        
        if (isActive) {
            this.systemPromptContent.classList.remove('active');
            this.systemPromptToggle.classList.remove('active');
        } else {
            this.systemPromptContent.classList.add('active');
            this.systemPromptToggle.classList.add('active');
        }
    }
    
    async processFile() {
        if (this.selectedFields.size === 0) {
            alert('Please select at least one field to include in the output.');
            return;
        }
        
        this.showLoader('Processing file...');
        
        const requestData = {
            selectedFields: Array.from(this.selectedFields),
            aiPrompt: this.aiPromptTextarea.value.trim(),
            systemPrompt: this.systemPromptTextarea.value.trim()
        };
        
        try {
            const response = await fetch('/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.downloadUrl = result.downloadUrl;
                this.goToPhase(3);
            } else {
                alert('Processing failed: ' + result.error);
            }
        } catch (error) {
            alert('Processing failed: ' + error.message);
        } finally {
            this.hideLoader();
        }
    }
    
    async downloadFile() {
        if (this.downloadUrl) {
            window.location.href = this.downloadUrl;
            
            setTimeout(async () => {
                try {
                    await fetch('/cleanup', { method: 'POST' });
                } catch (error) {
                    console.warn('Cleanup failed:', error);
                }
            }, 1000);
        }
    }
    
    async startOver() {
        try {
            await fetch('/cleanup', { method: 'POST' });
        } catch (error) {
            console.warn('Cleanup failed:', error);
        }
        
        this.currentPhase = 1;
        this.uploadedFile = null;
        this.csvHeaders = [];
        this.filename = '';
        this.selectedFields = new Set();
        this.downloadUrl = '';
        
        this.csvFileInput.value = '';
        this.aiPromptTextarea.value = '';
        this.systemPromptTextarea.value = '';
        this.fieldsContainer.innerHTML = '';
        
        this.systemPromptContent.classList.remove('active');
        this.systemPromptToggle.classList.remove('active');
        
        this.goToPhase(1);
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
    }
    
    goToPhase(phase) {
        Object.values(this.phases).forEach(phaseEl => {
            phaseEl.classList.remove('active');
        });
        
        this.phases[phase].classList.add('active');
        this.currentPhase = phase;
        this.updateProgressBar(phase);
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    showLoader(text = 'Loading...') {
        this.loaderText.textContent = text;
        this.loader.classList.remove('hidden');
    }
    
    hideLoader() {
        this.loader.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new JiraConverter();
}); 