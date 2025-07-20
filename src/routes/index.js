const express = require('express');
const path = require('path');
const uploadRoutes = require('./upload');
const downloadRoutes = require('./download');
const apiRoutes = require('./api');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public', 'index.html'));
});

router.use('/', uploadRoutes);
router.use('/', downloadRoutes);
router.use('/', apiRoutes);

module.exports = router; 