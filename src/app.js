const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const routes      = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1);

const DEFAULT_DEV_ORIGINS = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
];

function normalizeCorsOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

function buildCorsOrigins() {
  const configured = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(normalizeCorsOrigin)
    .filter(Boolean);

  if (configured.length) return configured;
  return process.env.NODE_ENV === 'production' ? [] : DEFAULT_DEV_ORIGINS;
}

const allowedCorsOrigins = buildCorsOrigins();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedCorsOrigins.includes(normalizeCorsOrigin(origin))) return cb(null, true);
    return cb(new Error('Origem nao permitida pelo CORS.'));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(morgan('dev'));
app.use(express.json());

app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use(errorHandler);

module.exports = app;
