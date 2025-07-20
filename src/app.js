require('dotenv').config();

const express = require('express');
const path = require('path');
const { sessionMiddleware } = require('./middleware/sessionMiddleware');
const routes = require('./routes');

const app = express();

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(sessionMiddleware);
app.use('/', routes);

module.exports = app; 