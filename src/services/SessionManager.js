const { sessionStore, fallbackStorage } = require('../middleware/sessionMiddleware');

class SessionManager {
  static getSessionData(sessionId, callback) {
    const fallbackData = fallbackStorage.get(sessionId);
    if (fallbackData) {
      return callback(null, fallbackData);
    }
    
    sessionStore.get(sessionId, (err, sessionData) => {
      if (err) {
        return callback(err, null);
      }
      callback(null, sessionData);
    });
  }

  static saveSessionData(sessionData, callback) {
    const sessionId = sessionData.id || sessionData.sessionID;
    if (!sessionId) {
      return callback();
    }
    
    const properSessionData = {
      ...sessionData,
      cookie: sessionData.cookie || {
        originalMaxAge: 2 * 60 * 60 * 1000,
        expires: new Date(Date.now() + 2 * 60 * 60 * 1000),
        secure: false,
        httpOnly: false,
        path: '/'
      }
    };
    
    fallbackStorage.set(sessionId, properSessionData);
    callback();
  }

  static findSessionWithData(dataKey) {
    for (const [key, data] of fallbackStorage.entries()) {
      if (data[dataKey]) {
        return { sessionId: key, sessionData: data };
      }
    }
    return null;
  }

  static cleanupSession(sessionId) {
    fallbackStorage.delete(sessionId);
    sessionStore.destroy(sessionId, () => {});
  }
}

module.exports = SessionManager; 