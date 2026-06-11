# LandingTester v2 — реальный Playwright тестер

## Структура
```
├── server.js       — Express сервер + WebSocket
├── runner.js       — Playwright тест (адаптированный)
├── selectors.js    — профили селекторов по URL
├── public/
│   └── index.html  — дашборд
├── Dockerfile      — для Railway
└── package.json
```

## Деплой на Railway

1. Создайте новый репозиторий на GitHub и загрузите эти файлы
2. Зайдите на railway.app → New Project → Deploy from GitHub repo
3. Выберите репозиторий
4. Railway автоматически найдёт Dockerfile и задеплоит
5. Сайт будет доступен по ссылке вида `https://ваш-проект.up.railway.app`

## Локальный запуск

```bash
npm install
npx playwright install chromium
node server.js
# Открыть http://localhost:3000
```

## Как работает

- Браузер открывает дашборд
- Нажимаете «Запустить» — браузер отправляет POST /run на сервер
- Сервер запускает реальный Playwright в headless режиме
- Результаты стримятся через WebSocket в реальном времени
- Лог и результаты обновляются по мере прохождения тестов
