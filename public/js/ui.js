class UIManager {
    constructor() {
        this.initializeElements();
        this.setupDragAndDrop();
        this.setupSelectButtons();
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
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.selectNoneBtn = document.getElementById('selectNoneBtn');
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
    }
    
    setupSelectButtons() {
        if (this.selectAllBtn) {
            this.selectAllBtn.addEventListener('click', () => this.selectAllAchievements());
        }
        
        if (this.selectNoneBtn) {
            this.selectNoneBtn.addEventListener('click', () => this.selectNoneAchievements());
        }
    }
    
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    goToPhase(phase) {
        Object.values(this.phases).forEach(p => p.classList.remove('active'));
        this.phases[phase].classList.add('active');
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
            cancelBtn.addEventListener('click', () => window.app.cancelProcessing());
            this.loader.appendChild(cancelBtn);
        }
    }
    
    hideLoader() {
        this.loader.classList.add('hidden');
        
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
            partialResultsDiv.classList.add('visible');
            resultsContent.innerHTML = results.map(result => 
                `<div>${result}</div>`
            ).join('');
        }
    }
    
    setupPhase2(csvHeaders, selectedFields) {
        this.fieldsContainer.innerHTML = '';
        
        csvHeaders.forEach(header => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `field-${header}`;
            checkbox.checked = selectedFields.has(header);
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedFields.add(header);
                } else {
                    selectedFields.delete(header);
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
    
    setupPhase3(achievements, selectedAchievements) {
        this.achievements = achievements;
        this.selectedAchievements = selectedAchievements;
        this.achievementsContainer.innerHTML = '';
        
        achievements.forEach((achievement, index) => {
            const achievementDiv = document.createElement('div');
            achievementDiv.className = 'achievement-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `achievement-${index}`;
            checkbox.checked = selectedAchievements.has(achievement);
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedAchievements.add(achievement);
                } else {
                    selectedAchievements.delete(achievement);
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
    
    showError(message) {
        this.hideConnectionError();
        
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
        
        if (!message.includes('refresh') && !message.includes('reconnect')) {
            setTimeout(() => {
                this.hideConnectionError();
            }, 5000);
        }
    }
    
    hideConnectionError() {
        const existingError = document.querySelector('.connection-error');
        if (existingError) {
            existingError.remove();
        }
    }
    
    setFavicon(emoji) {
        const existingFavicon = document.querySelector('link[rel="icon"]');
        if (existingFavicon) {
            existingFavicon.remove();
        }
        
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.href = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`;
        document.head.appendChild(favicon);
    }
    
    selectAllAchievements() {
        if (!this.achievements || !this.selectedAchievements) return;
        
        this.achievements.forEach(achievement => {
            this.selectedAchievements.add(achievement);
        });
        
        this.achievementsContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = true;
        });
    }
    
    selectNoneAchievements() {
        if (!this.selectedAchievements) return;
        
        this.selectedAchievements.clear();
        
        this.achievementsContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
        });
    }
    
    resetForm() {
        this.csvFileInput.value = '';
        this.aiPromptTextarea.value = '';
        this.additionalPromptTextarea.value = '';
        this.fieldsContainer.innerHTML = '';
        this.achievementsContainer.innerHTML = '';
    }
}

window.UIManager = UIManager; 