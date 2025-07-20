const path = require('path');

const TEMP_DIR = path.join(__dirname, '../../temp_uploads');
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = 'jira-converter-secret-key';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 2;
const CLEANUP_INTERVAL = 60 * 60 * 1000;
const TEMP_FILE_MAX_AGE = 2 * 60 * 60 * 1000;
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;
const CHUNK_SIZE = 50;

module.exports = {
    TEMP_DIR,
    PORT,
    SESSION_SECRET,
    SESSION_MAX_AGE,
    CLEANUP_INTERVAL,
    TEMP_FILE_MAX_AGE,
    FILE_SIZE_LIMIT,
    CHUNK_SIZE
}; 