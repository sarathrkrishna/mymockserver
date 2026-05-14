# mymockserver

Simple Node.js + Express mock server that simulates the LINE Messaging API push endpoint.

## Features

- `POST /v2/bot/message/push`
- `GET /health`
- `GET /db`
- `POST /reset`
- Retry key persistence in `db.json`
- Optional delay, forced status, and random failure behavior
- Render-friendly startup with `process.env.PORT`

## Local run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. The server listens on `http://localhost:3000` by default.

## Environment variables

- `PORT`: server port for local or Render deployment
- `DB_PATH`: optional path to the JSON database file
- `MOCK_DELAY_MS`: optional response delay in milliseconds
- `MOCK_FORCE_STATUS`: optional status code returned for accepted push requests
- `MOCK_RANDOM_FAILURE_RATE`: optional value from `0` to `1` to randomly return HTTP `500`
- `REQUEST_BODY_LIMIT`: optional Express body limit, defaults to `1mb`

## Example push request

```bash
curl -X POST http://localhost:3000/v2/bot/message/push \
  -H 'Content-Type: application/json' \
  -H 'X-Line-Retry-Key: demo-retry-key' \
  -d '{"to":"U123","messages":[{"type":"text","text":"hello"}]}'
```

First request response:

```json
{
  "message": "ok"
}
```

Repeated request with the same `X-Line-Retry-Key` response:

```json
{
  "message": "Already accepted"
}
```

## Render deployment

1. Push this repository to GitHub.
2. In Render, create a new **Web Service** from the GitHub repository.
3. Use these settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Optional: add `MOCK_DELAY_MS`, `MOCK_FORCE_STATUS`, and `MOCK_RANDOM_FAILURE_RATE` as environment variables.
5. Render free tier will inject `PORT`; this server already uses it automatically.

## GitHub auto-deploy workflow

1. Connect the GitHub repository to Render.
2. Enable Render auto-deploy for the branch you want to deploy.
3. Every push to that branch will trigger a new Render deployment.
4. For preview or production branches, manage behavior through Render environment variables instead of code changes.

## API summary

### `POST /v2/bot/message/push`

- Accepts any request body and headers
- Logs timestamp, headers, and body
- Stores `X-Line-Retry-Key` values in `db.json`
- Returns `409` with `{ "message": "Already accepted" }` for duplicate retry keys
- Returns `200` with `{ "message": "ok" }` for accepted requests unless mock behavior overrides it

### `GET /health`

```json
{
  "status": "ok"
}
```

### `GET /db`

Returns the current JSON database contents.

### `POST /reset`

Clears stored retry keys and returns:

```json
{
  "message": "ok"
}
```
