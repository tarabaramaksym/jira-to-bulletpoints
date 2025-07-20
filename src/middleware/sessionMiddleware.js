const session = require('express-session');
const { SESSION_SECRET, SESSION_MAX_AGE } = require('../utils/constants');

const MemoryStore = require('express-session').MemoryStore;
const sessionStore = new MemoryStore();

const fallbackStorage = new Map();

const sessionMiddleware = session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  rolling: true,
  cookie: { 
    secure: false,
    maxAge: SESSION_MAX_AGE,
    httpOnly: false
  }
});

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);

module.exports = {
  sessionMiddleware,
  sessionStore,
  fallbackStorage,
  wrap
}; 