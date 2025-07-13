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
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupDragAndDrop();
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
    
    setupEventListeners() {
        this.uploadBox.addEventListener('click', () => this.csvFileInput.click());
        this.csvFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        this.backBtn.addEventListener('click', () => this.goToPhase(1));
        this.processBtn.addEventListener('click', () => this.processFile());
        this.backToConfigBtn.addEventListener('click', () => this.goToPhase(2));
        this.reprocessBtn.addEventListener('click', () => this.reprocessAchievements());
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
    }
    
    setupPhase3() {
        this.renderAchievementsSelection();
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
    
    renderAchievementsSelection() {
        this.achievementsContainer.innerHTML = '';
        
        // Add header with select all/none actions
        const headerDiv = document.createElement('div');
        headerDiv.className = 'achievements-header';
        headerDiv.innerHTML = `
            <h3>Select achievements to include:</h3>
            <div class="achievements-actions">
                <button class="btn" id="selectAllBtn">Select All</button>
                <button class="btn" id="selectNoneBtn">Select None</button>
            </div>
        `;
        this.achievementsContainer.appendChild(headerDiv);
        
        // Add event listeners for select all/none
        document.getElementById('selectAllBtn').addEventListener('click', () => {
            this.selectedAchievements = new Set(this.achievements);
            this.renderAchievementsSelection();
        });
        
        document.getElementById('selectNoneBtn').addEventListener('click', () => {
            this.selectedAchievements.clear();
            this.renderAchievementsSelection();
        });
        
        // Render individual achievements
        this.achievements.forEach((achievement, index) => {
            const achievementItem = document.createElement('div');
            achievementItem.className = 'achievement-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'achievement-checkbox';
            checkbox.id = `achievement-${index}`;
            checkbox.checked = this.selectedAchievements.has(achievement);
            checkbox.addEventListener('change', () => this.toggleAchievement(achievement));
            
            const text = document.createElement('div');
            text.className = 'achievement-text';
            text.textContent = achievement;
            text.addEventListener('click', () => {
                checkbox.checked = !checkbox.checked;
                this.toggleAchievement(achievement);
            });
            
            achievementItem.appendChild(checkbox);
            achievementItem.appendChild(text);
            
            if (!this.selectedAchievements.has(achievement)) {
                achievementItem.classList.add('disabled');
            }
            
            this.achievementsContainer.appendChild(achievementItem);
        });
    }
    
    toggleAchievement(achievement) {
        if (this.selectedAchievements.has(achievement)) {
            this.selectedAchievements.delete(achievement);
        } else {
            this.selectedAchievements.add(achievement);
        }
        this.renderAchievementsSelection();
    }
    
    async reprocessAchievements() {
        if (this.selectedAchievements.size === 0) {
            alert('Please select at least one achievement to include.');
            return;
        }
        
        this.showLoader('Applying changes and finalizing...');
        
        const requestData = {
            selectedAchievements: Array.from(this.selectedAchievements),
            additionalPrompt: this.additionalPromptTextarea.value.trim()
        };
        
        try {
            const response = await fetch('/reprocess', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.downloadUrl = result.downloadUrl;
                this.goToPhase(4);
            } else {
                alert('Reprocessing failed: ' + result.error);
            }
        } catch (error) {
            alert('Reprocessing failed: ' + error.message);
        } finally {
            this.hideLoader();
        }
    }
    
    async processFile() {
        if (this.selectedFields.size === 0) {
            alert('Please select at least one field to include in the output.');
            return;
        }
        
        this.showLoader('Processing file, this may take a while, please don\'t close this tab...');
        
        const requestData = {
            selectedFields: Array.from(this.selectedFields),
            aiPrompt: this.aiPromptTextarea.value.trim(),
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
                this.achievements = result.achievements;
                this.selectedAchievements = new Set(result.achievements);
                this.setupPhase3();
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
        this.achievements = [];
        this.selectedAchievements = new Set();
        this.downloadUrl = '';
        
        this.csvFileInput.value = '';
        this.aiPromptTextarea.value = '';
        this.additionalPromptTextarea.value = '';
        this.fieldsContainer.innerHTML = '';
        this.achievementsContainer.innerHTML = '';
        
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