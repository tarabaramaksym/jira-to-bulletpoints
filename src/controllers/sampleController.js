const fs = require('fs');
const path = require('path');

const downloadSample = (req, res) => {
  const samplePath = path.join(__dirname, '../../sample', 'sample.csv');
  
  if (fs.existsSync(samplePath)) {
    res.setHeader('Content-disposition', 'attachment; filename="jira-sample.csv"');
    res.setHeader('Content-type', 'text/csv');
    res.sendFile(samplePath);
  } else {
    res.status(404).json({ error: 'Sample file not found' });
  }
};

module.exports = {
  downloadSample
}; 