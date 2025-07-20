const express = require('express');
const upload = require('../config/multer');
const { uploadFile } = require('../controllers/uploadController');

const router = express.Router();

router.post('/upload', upload.single('csvFile'), uploadFile);

module.exports = router; 