const express = require('express');
const { getAiStatus } = require('../controllers/apiController');
const { cleanupSession } = require('../controllers/cleanupController');

const router = express.Router();

router.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});

router.get('/ai-status', getAiStatus);
router.post('/cleanup', cleanupSession);
router.get('/cleanup', cleanupSession);

module.exports = router; 