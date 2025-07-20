const express = require('express');
const { downloadFile } = require('../controllers/downloadController');
const { downloadSample } = require('../controllers/sampleController');

const router = express.Router();

router.get('/download', downloadFile);
router.get('/sample-csv', downloadSample);

module.exports = router; 