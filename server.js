const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const { runTest } = require('./runner.js');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Активные клиенты WebSocket
const clients = new Set();
// Ожидающие SMS резолверы: Map<wsClient, Function>
const smsResolvers = new Map();

wss.on('connection', ws => {
  clients.add(ws);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      // Пользователь ввёл SMS-код в браузере
      if (data.type === 'sms_code') {
        const resolve = smsResolvers.get(ws);
        if (resolve) {
          smsResolvers.delete(ws);
          resolve(data.code);
        }
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    smsResolvers.delete(ws);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

let testRunning = false;
let activeWs = null;

app.post('/run', async (req, res) => {
  if (testRunning) return res.status(409).json({ error: 'Тест уже запущен' });

  const config = req.body;
  if (!config.landingUrl) return res.status(400).json({ error: 'Укажите URL лендинга' });

  res.json({ ok: true });
  testRunning = true;

  // Находим активный WebSocket клиент
  activeWs = null;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) { activeWs = ws; break; }
  }

  try {
    broadcast({ type: 'start', config });

    await runTest(config, (event) => {
      // SMS запрос — отправляем в браузер и ждём ответа.
      // Ищем живое соединение прямо сейчас, а не полагаемся на activeWs,
      // запомненный в начале прогона — за долгий прогон оно могло оборваться
      // (например, на телефоне экран погас и вкладка ушла в фон).
      if (event.type === 'sms_wait') {
        let liveWs = (activeWs && activeWs.readyState === WebSocket.OPEN) ? activeWs : null;
        if (!liveWs) {
          for (const ws of clients) {
            if (ws.readyState === WebSocket.OPEN) { liveWs = ws; break; }
          }
        }
        if (liveWs) {
          try {
            const resolve = event.resolve;
            smsResolvers.set(liveWs, resolve);
            liveWs.send(JSON.stringify({ type: 'sms_required' }));
          } catch (e) {
            event.resolve('');
          }
        } else {
          // Нет ни одного живого соединения — некому показать модалку
          event.resolve('');
        }
        return;
      }
      broadcast(event);
    });

  } catch (err) {
    broadcast({ type: 'error', message: err.message });
  } finally {
    testRunning = false;
    broadcast({ type: 'done' });
    activeWs = null;
  }
});

app.get('/status', (req, res) => {
  res.json({ running: testRunning });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('LandingTester server running on port ' + PORT);
});
