const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TEMP_DIR, TEMP_FILE_MAX_AGE } = require('../utils/constants');

class FileManager {
  static cleanupTempFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        // Silent fail for cleanup
      }
    }
  }

  static saveAchievementsToFile(achievements, sessionId) {
    try {
      if (!achievements || achievements.length === 0) {
        return null;
      }
      
      const uniqueSuffix = crypto.randomBytes(6).toString('hex');
      const timestamp = Date.now();
      const filename = `${sessionId}_${timestamp}_${uniqueSuffix}_achievements.txt`;
      const filePath = path.join(TEMP_DIR, filename);
      
      const content = achievements.join('\n\n');
      fs.writeFileSync(filePath, content, 'utf8');
      
      setTimeout(() => {
        this.cleanupTempFile(filePath);
      }, 60 * 60 * 1000);
      
      return filePath;
    } catch (error) {
      return null;
    }
  }

  static cleanupOldTempFiles() {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      
      let csvFilesCleanedUp = 0;
      let achievementFilesCleanedUp = 0;
      
      files.forEach(file => {
        const filePath = path.join(TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > TEMP_FILE_MAX_AGE) {
          this.cleanupTempFile(filePath);
          
          if (file.includes('achievements')) {
            achievementFilesCleanedUp++;
          } else {
            csvFilesCleanedUp++;
          }
        }
      });
    } catch (error) {
      // Silent fail for cleanup
    }
  }

  static cleanupAllTempFiles() {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      let csvFiles = 0;
      let achievementFiles = 0;
      
      files.forEach(file => {
        const filePath = path.join(TEMP_DIR, file);
        this.cleanupTempFile(filePath);
        
        if (file.includes('achievements')) {
          achievementFiles++;
        } else {
          csvFiles++;
        }
      });
    } catch (error) {
      // Silent fail for cleanup
    }
  }
}

module.exports = FileManager; 