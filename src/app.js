const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const routes      = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan('dev'));
app.use(express.json());

app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use(errorHandler);

module.exports = app;
