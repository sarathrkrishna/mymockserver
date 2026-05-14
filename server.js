const express = require('express');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 3000;
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-line-signature',
]);

function createDefaultDb() {
  return { retryKeys: {} };
}

function ensureDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    writeDb(dbPath, createDefaultDb());
  }
}

function readDb(dbPath) {
  ensureDb(dbPath);

  try {
    const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return {
      retryKeys:
        parsed && typeof parsed.retryKeys === 'object' && parsed.retryKeys !== null
          ? parsed.retryKeys
          : {},
    };
  } catch (error) {
    const defaultDb = createDefaultDb();
    writeDb(dbPath, defaultDb);
    return defaultDb;
  }
}

function writeDb(dbPath, db) {
  const directory = path.dirname(dbPath);
  const tempPath = path.join(directory, `${path.basename(dbPath)}.tmp`);

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, dbPath);
}

function sanitizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      REDACTED_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value,
    ])
  );
}

function normalizeBody(bodyBuffer) {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return null;
  }

  const text = bodyBuffer.toString('utf8');

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function limitLoggedBody(body) {
  if (typeof body === 'string' && body.length > 5000) {
    return `${body.slice(0, 5000)}…[truncated]`;
  }

  return body;
}

function parseInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseRate(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number.parseFloat(value);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.min(1, Math.max(0, parsed));
}

function getMockConfig() {
  const delayMs = Math.max(0, parseInteger(process.env.MOCK_DELAY_MS) || 0);
  const forcedStatus = parseInteger(process.env.MOCK_FORCE_STATUS);
  const randomFailureRate = parseRate(process.env.MOCK_RANDOM_FAILURE_RATE);

  return {
    delayMs,
    forcedStatus:
      forcedStatus && forcedStatus >= 100 && forcedStatus <= 599 ? forcedStatus : null,
    randomFailureRate,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createApp(options = {}) {
  const app = express();
  const dbPath = options.dbPath || process.env.DB_PATH || path.join(__dirname, 'db.json');

  app.disable('x-powered-by');
  app.use(express.raw({ type: '*/*', limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/db', (_req, res) => {
    res.json(readDb(dbPath));
  });

  app.post('/reset', (_req, res) => {
    writeDb(dbPath, createDefaultDb());
    res.json({ message: 'ok' });
  });

  app.post('/v2/bot/message/push', async (req, res) => {
    const timestamp = new Date().toISOString();
    const body = normalizeBody(req.body);
    const retryKey = req.get('x-line-retry-key');

    console.log(
      JSON.stringify({
        timestamp,
        path: req.originalUrl,
        method: req.method,
        headers: sanitizeHeaders(req.headers),
        body: limitLoggedBody(body),
      })
    );

    const db = readDb(dbPath);

    if (retryKey && db.retryKeys[retryKey]) {
      return res.status(409).json({
        message: 'Already accepted',
      });
    }

    if (retryKey) {
      db.retryKeys[retryKey] = timestamp;
      writeDb(dbPath, db);
    }

    const config = getMockConfig();

    if (config.delayMs > 0) {
      await delay(config.delayMs);
    }

    if (config.forcedStatus) {
      return res.status(config.forcedStatus).json({
        message: config.forcedStatus === 200 ? 'ok' : 'mock response',
      });
    }

    if (config.randomFailureRate > 0 && Math.random() < config.randomFailureRate) {
      return res.status(500).json({
        message: 'mock response',
      });
    }

    return res.status(200).json({
      message: 'ok',
    });
  });

  return app;
}

if (require.main === module) {
  const port = parseInteger(process.env.PORT) || DEFAULT_PORT;
  const app = createApp();

  app.listen(port, () => {
    console.log(JSON.stringify({ message: 'mock server listening', port }));
  });
}

module.exports = {
  createApp,
  DEFAULT_DB: createDefaultDb(),
  readDb,
  writeDb,
};
