const express = require('express');
const { getAiStatus } = require('../controllers/apiController');
const { cleanupSession } = require('../controllers/cleanupController');

const router = express.Router();

router.get('/ai-status', getAiStatus);
router.post('/cleanup', cleanupSession);
router.get('/cleanup', cleanupSession);

module.exports = router; 