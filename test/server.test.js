const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server');

const PACKAGE_NAME = 'mymockserver';

function createTempDbPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${PACKAGE_NAME}-test-`));
  return {
    dbPath: path.join(directory, 'db.json'),
    directory,
  };
}

async function startServer() {
  const { dbPath, directory } = createTempDbPath();
  const app = createApp({ dbPath });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  return {
    dbPath,
    directory,
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopServer(server, directory) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  fs.rmSync(directory, { recursive: true, force: true });
}

test('GET /health returns ok', async () => {
  const { server, baseUrl, directory } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await stopServer(server, directory);
  }
});

test('POST /v2/bot/message/push deduplicates retry keys', async () => {
  const { server, baseUrl, dbPath, directory } = await startServer();

  try {
    const firstResponse = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-retry-key': 'retry-123',
      },
      body: JSON.stringify({ hello: 'world' }),
    });

    assert.equal(firstResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), { message: 'ok' });

    const secondResponse = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-retry-key': 'retry-123',
      },
      body: JSON.stringify({ hello: 'again' }),
    });

    assert.equal(secondResponse.status, 409);
    assert.deepEqual(await secondResponse.json(), { message: 'Already accepted' });

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(typeof db.retryKeys['retry-123'], 'string');
  } finally {
    await stopServer(server, directory);
  }
});

test('POST /reset clears persisted retry keys', async () => {
  const { server, baseUrl, directory } = await startServer();

  try {
    await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-retry-key': 'retry-reset',
      },
      body: JSON.stringify({ message: 'test' }),
    });

    const resetResponse = await fetch(`${baseUrl}/reset`, {
      method: 'POST',
    });

    assert.equal(resetResponse.status, 200);
    assert.deepEqual(await resetResponse.json(), { message: 'ok' });

    const dbResponse = await fetch(`${baseUrl}/db`);
    assert.deepEqual(await dbResponse.json(), { retryKeys: {} });
  } finally {
    await stopServer(server, directory);
  }
});

test('mock configuration can force a status code with delay', async () => {
  const { server, baseUrl, directory } = await startServer();
  const originalForceStatus = process.env.MOCK_FORCE_STATUS;
  const originalDelay = process.env.MOCK_DELAY_MS;

  process.env.MOCK_FORCE_STATUS = '503';
  process.env.MOCK_DELAY_MS = '25';

  try {
    const start = Date.now();
    const response = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ config: true }),
    });
    const elapsed = Date.now() - start;

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: 'mock response' });
    assert.ok(elapsed >= 20);
  } finally {
    if (originalForceStatus === undefined) {
      delete process.env.MOCK_FORCE_STATUS;
    } else {
      process.env.MOCK_FORCE_STATUS = originalForceStatus;
    }

    if (originalDelay === undefined) {
      delete process.env.MOCK_DELAY_MS;
    } else {
      process.env.MOCK_DELAY_MS = originalDelay;
    }

    await stopServer(server, directory);
  }
});
