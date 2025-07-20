const AIService = require('../services/AIService');

const aiService = process.env.OPENAI_API_KEY ? new AIService(process.env.OPENAI_API_KEY) : null;

const getAiStatus = async (req, res) => {
  if (!aiService) {
    return res.json({ 
      enabled: false, 
      message: 'AI service not available - OPENAI_API_KEY not set' 
    });
  }
  
  try {
    const isWorking = await aiService.testConnection();
    res.json({ 
      enabled: true, 
      working: isWorking,
      message: isWorking ? 'AI service is working' : 'AI service connection failed'
    });
  } catch (error) {
    res.json({ 
      enabled: true, 
      working: false, 
      message: 'AI service connection failed',
      error: error.message
    });
  }
};

module.exports = {
  getAiStatus
}; 