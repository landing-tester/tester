const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');
const { runTest } = require('./runner.js');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Активные клиенты WebSocket
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

// Рассылаем сообщение всем клиентам
function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// POST /run — запускает тест
let testRunning = false;

app.post('/run', async (req, res) => {
  if (testRunning) {
    return res.status(409).json({ error: 'Тест уже запущен' });
  }
  const config = req.body;
  if (!config.landingUrl) {
    return res.status(400).json({ error: 'Укажите URL лендинга' });
  }

  res.json({ ok: true, message: 'Тест запущен' });
  testRunning = true;

  try {
    broadcast({ type: 'start', config });
    await runTest(config, (event) => broadcast(event));
  } catch (err) {
    broadcast({ type: 'error', message: err.message });
  } finally {
    testRunning = false;
    broadcast({ type: 'done' });
  }
});

// GET /status — проверить запущен ли тест
app.get('/status', (req, res) => {
  res.json({ running: testRunning });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('LandingTester server running on port ' + PORT);
});
