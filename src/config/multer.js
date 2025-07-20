const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { TEMP_DIR, FILE_SIZE_LIMIT } = require('../utils/constants');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { mode: 0o700 });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = crypto.randomBytes(6).toString('hex');
    const timestamp = Date.now();
    const sessionId = req.sessionID || 'unknown';
    const filename = `${sessionId}_${timestamp}_${uniqueSuffix}.csv`;
    cb(null, filename);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: FILE_SIZE_LIMIT
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

module.exports = upload; 