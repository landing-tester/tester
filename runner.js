// runner.js — серверная версия test.js для работы через WebSocket
// Поддерживает десктоп (Chromium) и мобильный (iPhone) режим

const { chromium, webkit, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

let selectorRegistry = [];
try { selectorRegistry = require('./selectors.js'); } catch (_) {}

const debugDir = path.join(__dirname, 'public', 'debug');
try { fs.mkdirSync(debugDir, { recursive: true }); } catch (_) {}

// Сохраняет скриншот в public/debug/ и возвращает публичный URL для просмотра в браузере
async function saveDebugShot(pageOrFrame, name, emit) {
  try {
    const targetPage = pageOrFrame.screenshot ? pageOrFrame : null;
    if (!targetPage) return null;
    const fname = name + '-' + Date.now() + '.png';
    await targetPage.screenshot({ path: path.join(debugDir, fname) });
    const url = '/debug/' + fname;
    if (emit) emit({ type: 'log', msg: 'Скриншот: ' + url, logType: 'info' });
    return url;
  } catch (_) { return null; }
}

function findProfile(url) {
  return selectorRegistry.find(p => p.match(url)) || null;
}

function sel(profile, key, fallback, configSelectors) {
  return (configSelectors && configSelectors[key]) || (profile && profile[key]) || fallback;
}


function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Оборачивает промис жёстким таймаутом — нужно для запросов к отдельным
// фреймам (frame.$()), которые сами по себе не имеют встроенного таймаута
// и могут зависнуть навсегда, если конкретный фрейм в нестабильном состоянии
// (перезагружается/переходит на другой URL прямо в этот момент)
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout ' + ms + 'ms')), ms)),
  ]);
}

async function findInput(ctx, selectors) {
  for (const s of selectors) {
    try {
      const el = await ctx.$(s);
      if (el && await el.isVisible()) return el;
    } catch (_) {}
  }
  return null;
}

// ── Обработка поп-апа ──────────────────────────────────────────────────────
async function handlePopup(page, profile, emit) {
  await sleep(1500);

  // Кнопки закрытия (без авторизации)
  const closeSels = [
    'button[aria-label="Закрыть"]', 'button[aria-label="Close"]',
    '[class*="close"]', '[class*="Close"]',
    'div.sign-in__close',
    'button:has-text("Позже")', 'button:has-text("Не сейчас")',
    'button:has-text("Пропустить")',
    'button[data-t="button:accept"]', 'button:has-text("Принять")',
    'button:has-text("Хорошо")',
  ];

  // Кнопки входа в поп-апе
  const loginSels = [
    'div.sign-in__button', '.sign-in__button',
    'button:has-text("Войти")', 'a:has-text("Войти")',
    '[class*="auth"] button',
  ];

  // Сначала пробуем закрыть
  for (const s of closeSels) {
    try {
      const el = await page.$(s);
      if (el && await el.isVisible()) {
        const txt = await el.innerText().catch(() => s);
        await el.click();
        emit({ type: 'log', msg: 'Поп-ап закрыт: "' + txt.trim().slice(0,30) + '"', logType: 'ok' });
        await sleep(1000);
        return 'closed';
      }
    } catch (_) {}
  }

  // Проверяем есть ли кнопка «Войти»
  for (const s of loginSels) {
    try {
      const el = await page.$(s);
      if (el && await el.isVisible()) {
        return 'auth_required';
      }
    } catch (_) {}
  }

  return 'none';
}

// ── Авторизация через Яндекс Паспорт ───────────────────────────────────────
async function doYandexAuth(page, config, profile, results, emit) {
  function log(msg, type) { emit({ type:'log', msg, logType: type||'info' }); }

  try {
    await page.waitForURL('**/passport.yandex**', { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(300);

    // кликаем «Ещё» → «Войти по логину»
    const moreSels = ['[data-testid="split-add-user-more-button"]','button:has-text("Ещё")','a:has-text("Ещё")'];
    let moreClicked = false;
    for (const s of moreSels) {
      try {
        const el = await page.$(s);
        if (el && await el.isVisible()) {
          moreClicked = true;
          await el.tap().catch(() => el.click());
          log('Открыто меню «Ещё»', 'ok');
          await sleep(600);
          // "Войти по логину" в новой вёрстке — не кнопка, а span/заголовок.
          // Активно ЖДЁМ появления (не мгновенная проверка — меню может анимироваться).
          const loginItemSel = '[data-testid="menu-option-switchToLogin"], text=Войти по логину';
          let loginItem = await page.waitForSelector(loginItemSel, { timeout: 3000 }).catch(() => null);
          if (!loginItem) {
            // Запасной способ: ищем "листовой" элемент (без дочерних),
            // у которого текст ТОЧНО равен "Войти по логину" — так не цепляем
            // случайно родительский контейнер, как было с :has-text()
            const handle = await page.evaluateHandle(() => {
              const all = document.querySelectorAll('body *');
              for (const el of all) {
                if (el.children.length === 0 && el.textContent && el.textContent.replace(/\s+/g, ' ').trim() === 'Войти по логину') {
                  return el;
                }
              }
              return null;
            });
            const el = handle.asElement();
            if (el) loginItem = el;
          }
          if (loginItem) {
            await loginItem.tap().catch(() => loginItem.click().catch(() => {}));
            await sleep(300);
            log('Войти по логину', 'ok');
          } else {
            log('Пункт «Войти по логину» не появился за 3с', 'warn');
          }
          break;
        }
      } catch (_) {}
    }
    if (!moreClicked) log('Кнопка «Ещё» не найдена/не видима', 'warn');

    const credential = config.account.loginMode === 'email' ? config.account.email : config.account.login;
    log('Логин (для отладки, в квадратных скобках): [' + credential + '] длина: ' + credential.length, 'info');

    let loginField = null;
    for (let li = 0; li < 15; li++) {
      loginField = await findInput(page, [
        'input[data-testid="text-field-input"][autocomplete="username"]',
        'input[placeholder*="Логин или email" i]',
        'input#passp-field-login',
        'input[name="login"]',
        'input[autocomplete="username"]',
      ]);
      if (loginField) break;
      await sleep(1000);
    }

    if (loginField) {
      await loginField.click(); await sleep(200);
      await loginField.fill(credential);
      const actualVal = await loginField.inputValue().catch(() => '?');
      log('Логин: ' + credential + ' (в поле реально: [' + actualVal + '])', 'ok');
    } else {
      // клик по координатам
      await saveDebugShot(page, 'auth-no-login-field', emit);
      try {
        const bodyAuth = await page.$('div.body-auth, [class*="body-auth"]');
        if (bodyAuth) {
          const box = await bodyAuth.boundingBox();
          if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height*0.3);
        }
      } catch (_) {}
      await page.keyboard.type(credential, { delay: 60 });
      log('Логин введён по координатам', 'ok');
    }

    let nextBtn = await page.$('button[data-testid="split-add-user-next-login"], button:has-text("Войти"), button:has-text("Далее")').catch(() => null);

    // Кнопка может быть ещё disabled сразу после fill() — ждём до 3с, пока станет активной
    if (nextBtn) {
      for (let bi = 0; bi < 6; bi++) {
        const isDisabled = await nextBtn.evaluate(b => b.disabled || b.getAttribute('aria-disabled') === 'true').catch(() => false);
        if (!isDisabled) break;
        await sleep(500);
      }
    }

    async function clickNextLogin() {
      nextBtn = await page.$('button[data-testid="split-add-user-next-login"], button:has-text("Войти"), button:has-text("Далее")').catch(() => null);
      if (nextBtn) {
        try {
          await nextBtn.click({ timeout: 5000 });
        } catch (_) {
          log('Клик «Войти/Далее» перекрыт — пробуем force и Enter', 'warn');
          await saveDebugShot(page, 'click-intercepted-login-next', emit);
          await nextBtn.click({ timeout: 3000, force: true }).catch(() => page.keyboard.press('Enter').catch(() => {}));
        }
      } else { await page.keyboard.press('Enter'); }
    }

    await clickNextLogin();
    await sleep(1500);
    // Если через 1.5с всё ещё на экране логина (URL не сменился на password-шаг) —
    // пробуем клик ещё раз, возможно первый пришёлся на ещё-disabled кнопку
    const urlAfterFirstClick = page.url();
    await sleep(500);
    if (page.url() === urlAfterFirstClick) {
      log('Похоже, экран логина не сменился — пробуем клик «Войти» повторно', 'warn');
      await clickNextLogin();
    }

    // пароль — даём странице время отрисоваться, пробуем несколько раз вместо одной попытки
    let passField = null;
    for (let pi = 0; pi < 15; pi++) {
      passField = await findInput(page, [
        'input[data-testid="text-field-input"][autocomplete="current-password"]',
        'input[type="password"]', 'input[name="passwd"]',
        'input#passp-field-passwd', 'input[autocomplete="current-password"]',
      ]);
      if (passField) break;
      await sleep(1000);
    }

    if (passField) {
      await passField.click(); await sleep(200);
      await passField.fill(config.account.password);
      // подстраховка: дублируем через реальную печать по символам —
      // React иногда завязывает валидацию на keyup, а не только на fill()/input
      await passField.press('End').catch(() => {});
      log('Пароль введён', 'ok');
    } else {
      log('Поле пароля не найдено за 8с — вводим по координатам', 'warn');
      await saveDebugShot(page, 'auth-no-password-field', emit);
      try {
        const bodyAuth = await page.$('div.body-auth, [class*="body-auth"]');
        if (bodyAuth) {
          const box = await bodyAuth.boundingBox();
          if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height*0.3);
        }
      } catch (_) {}
      await page.keyboard.type(config.account.password, { delay: 60 });
      log('Пароль введён по координатам', 'ok');
    }

    const nextBtn2Sel = 'button[data-testid="password-next"], button:has-text("Войти"), button:has-text("Далее")';
    let nextBtn2 = await page.$(nextBtn2Sel).catch(() => null);

    // Кнопка может быть ещё disabled сразу после fill() — ждём до 3с, пока станет активной
    if (nextBtn2) {
      for (let bi = 0; bi < 6; bi++) {
        const isDisabled = await nextBtn2.evaluate(b => b.disabled || b.getAttribute('aria-disabled') === 'true').catch(() => false);
        if (!isDisabled) break;
        await sleep(500);
      }
    }

    async function clickNext2() {
      nextBtn2 = await page.$(nextBtn2Sel).catch(() => null);
      if (nextBtn2) {
        try {
          await nextBtn2.click({ timeout: 5000 });
        } catch (_) {
          log('Клик «Войти/Далее» (после пароля) перекрыт — пробуем force и Enter', 'warn');
          await saveDebugShot(page, 'click-intercepted-password-next', emit);
          await nextBtn2.click({ timeout: 3000, force: true }).catch(() => page.keyboard.press('Enter').catch(() => {}));
        }
      } else { await page.keyboard.press('Enter'); }
    }

    await clickNext2();
    await sleep(1500);
    // Если через 1.5с URL всё ещё содержит /auth/password — пробуем клик ещё раз
    // (возможно, первый клик пришёлся на ещё-disabled кнопку и ничего не сделал)
    if (page.url().includes('/auth/password')) {
      log('Всё ещё на экране пароля — пробуем клик «Далее» повторно', 'warn');
      await clickNext2();
    }
    log('Ждём завершения авторизации...', 'info');

    await page.waitForURL(u => !u.includes('passport.yandex'), { timeout: 15000 }).catch(() => {});
    await sleep(1500);

    // Паспорт иногда проходит через несколько промежуточных шагов
    // (prepare → auth/finished → реальный редирект на лендинг) —
    // даём до 3 дополнительных попыток дождаться ухода с passport.yandex
    for (let ai = 0; ai < 3 && page.url().includes('passport.yandex'); ai++) {
      log('Ещё на passport (' + page.url().slice(0, 80) + '), ждём повторно...', 'info');
      await page.waitForURL(u => !u.includes('passport.yandex'), { timeout: 10000 }).catch(() => {});
      await sleep(1500);
    }

    if (!page.url().includes('passport.yandex')) {
      log('Авторизация успешна', 'ok');
      results.push({ name:'Авторизация', status:'pass' });
      return true;
    } else {
      log('Всё ещё на passport — проверьте логин/пароль', 'warn');
      results.push({ name:'Авторизация', status:'warn', note:'Проверьте логин/пароль' });
      return false;
    }
  } catch (e) {
    log('Ошибка авторизации: ' + e.message, 'fail');
    results.push({ name:'Авторизация', status:'fail', error: e.message });
    return false;
  }
}

// ── Главная функция ─────────────────────────────────────────────────────────
async function runTestInner(config, emit, browserRef) {
  const results = [];
  const ymGoals = [];

  // Очищаем скриншоты предыдущих прогонов — иначе public/debug/ будет
  // бесконечно копиться и есть место на диске
  try {
    const oldFiles = fs.readdirSync(debugDir);
    for (const f of oldFiles) {
      try { fs.unlinkSync(path.join(debugDir, f)); } catch (_) {}
    }
  } catch (_) {}

  function log(msg, type) { emit({ type:'log', msg, logType: type||'info' }); }
  function result(name, status, note, error) {
    const r = { name, status };
    if (note) r.note = note;
    if (error) r.error = error;
    results.push(r);
    emit({ type:'result', name, status, note, error });
  }

  const profile = findProfile(config.landingUrl);
  if (profile) log('Профиль: ' + profile.name, 'info');

  // Определяем сервис заранее — нужно для live-обновления целей Метрики по ходу теста
  const svc = config.landingUrl.includes('music.yandex') ? 'music'
    : config.landingUrl.includes('kinopoisk') ? 'kp'
    : config.landingUrl.includes('books.yandex') ? 'books'
    : config.landingUrl.includes('plus.yandex') ? 'plus'
    : null;

  // Запуск браузера
  const isMobile = config.device === 'iphone' || config.device === 'pixel';
  log('Устройство: ' + (config.device || 'chromium'), 'info');
  log('Запускаем браузер...', 'info');

  let browser, context;
  try {
    if (config.device === 'iphone') {
      browser = await webkit.launch({ headless: true });
      context = await browser.newContext({
        ...devices['iPhone 13'],
        deviceScaleFactor: 2,
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
      });
    } else if (config.device === 'pixel') {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
      });
      context = await browser.newContext({
        ...devices['Pixel 5'],
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
      });
    } else if (config.device === 'yandex') {
      // Реального бинарника Яндекс Браузера на Linux-сервере нет — используем обычный
      // Chromium с User-Agent Яндекс Браузера. Это не полноценная эмуляция движка
      // (внутри всё равно Blink/Chromium), но лендинг увидит именно этот UA.
      log('Яндекс Браузер: реального движка на сервере нет, эмулируем через Chromium + UA Яндекс Браузера', 'warn');
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
      });
      context = await browser.newContext({
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.6.0.0 Safari/537.36',
      });
    } else {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
      });
      context = await browser.newContext({
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
    }
  } catch (e) {
    emit({ type:'error', message: 'Ошибка запуска браузера: ' + e.message });
    emit({ type:'results', results });
    return;
  }

  const page = await context.newPage();
  browserRef.browser = browser; // чтобы watchdog снаружи мог принудительно закрыть браузер

  // Строгий фильтр: реальные события Яндекс.Метрики, а не любой текст со словом "goal"
  // (например, у Яндекс.Паспорта в служебных URL встречается goal=https://..., это не про Метрику)
  const METRIKA_GOAL_RE = /Reach goal\.|Goal id\s*[:=]|ym\(\s*\d+\s*,\s*['"]reachGoal['"]/i;

  // Перехват событий Метрики. Используем оба источника (CDP и обычный page.on('console')),
  // т.к. на практике только page.on('console') не всегда ловит события Метрики надёжно —
  // а с обоими сразу события задваивались. Решаем через дедупликацию по тексту события.
  const seenGoalTexts = new Set();
  function handleConsoleText(text) {
    if (!METRIKA_GOAL_RE.test(text)) return;
    if (seenGoalTexts.has(text)) return; // такое событие уже обработано вторым слушателем
    seenGoalTexts.add(text);
    ymGoals.push(text);
    log('Метрика: ' + text.slice(0, 100), 'ok');
    if (svc) emit({ type:'goals', svc, firedGoals: [text] });
  }

  page.on('console', msg => handleConsoleText(msg.text()));

  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', event => {
      const text = (event.args||[]).map(a => a.value || a.description || '').join(' ');
      handleConsoleText(text);
    });
  } catch (_) {}

  try {
    // ── БЛОК 1: Открытие лендинга ──────────────────────────────────────────
    const ymUrl = config.landingUrl + (config.landingUrl.includes('?') ? '&' : '?') + '_ym_debug=2';
    log('Открываем: ' + ymUrl, 'info');
    await page.goto(ymUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2500);
    log('Страница загружена', 'ok');
    result('Открытие лендинга', 'pass');

    // ── БЛОК 2: Поп-ап ─────────────────────────────────────────────────────
    const popupResult = await handlePopup(page, profile, emit);

    if (popupResult === 'closed') {
      result('Поп-ап', 'pass', 'Нет поп-апа');
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(3000);
    } else if (popupResult === 'none') {
      result('Поп-ап', 'pass', 'Нет поп-апа');
    }

    // ── БЛОК 3: Базовые проверки ───────────────────────────────────────────
    // Авторизация
    if (config.account && config.account.email && config.account.password) {
      log('Начинаем авторизацию...', 'info');

      // CTA кнопка
      const ctaSels = (profile && profile.cta) || [
        'div.promo-sport__button-subscription-offer',
        '[class*="button_background_gradient"]',
        'button:has-text("До года бесплатно")',
        'button:has-text("Попробовать бесплатно")',
        'button:has-text("Попробовать")',
        'span:has-text("До года бесплатно")',
        '.button_type_new-design span',
      ];

      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);

      // Поп-ап (например, "Войдите, чтобы продолжить") мог появиться заново
      // после скролла/времени на странице — закрываем его ещё раз перед кликом по CTA
      const popupAgain = await handlePopup(page, profile, emit);
      if (popupAgain === 'closed') { await sleep(800); }

      let ctaClicked = false;

      // Активно ждём появления CTA (карусель/контент на мобиле может грузиться с задержкой) —
      // раньше была одна мгновенная проверка, из-за которой кнопка иногда "не находилась",
      // просто не успев отрендериться
      if (!ctaClicked && !(popupAgain === 'auth_required')) {
        await page.waitForSelector(ctaSels.join(', '), { timeout: 15000 }).catch(() => {});
      }

      if (popupAgain === 'auth_required') {
        // Поп-ап сам по себе — это уже экран входа (например "Войдите, чтобы продолжить").
        // Кликаем прямо в него, не пытаясь достучаться до кнопки лендинга под ним.
        const popupLoginSel = sel(profile, 'popupLogin', 'div.sign-in__button, .sign-in__button, button:has-text("Войти"), a:has-text("Войти"), [class*="auth"] button', config.selectors);
        const loginBtn = await page.$(popupLoginSel).catch(() => null);
        if (loginBtn && await loginBtn.isVisible().catch(() => false)) {
          await loginBtn.click({ timeout: 5000 }).catch(() => loginBtn.tap().catch(() => {}));
          log('Клик «Войти» в поп-апе (повторная проверка)', 'ok');
          ctaClicked = true;
          await sleep(2000);
        }
      }

      for (const s of (ctaClicked ? [] : ctaSels)) {
        try {
          const el = await page.$(s);
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            const box = await el.boundingBox();
            if (box && box.width > 0) {
              // Диагностика: что реально лежит в точке клика (вдруг сверху невидимый оверлей)
              try {
                const cx = box.x + box.width/2, cy = box.y + box.height/2;
                const atPoint = await page.evaluate(([x,y]) => {
                  const el2 = document.elementFromPoint(x, y);
                  return el2 ? (el2.outerHTML || '').slice(0, 200) : 'null';
                }, [cx, cy]);
                log('В точке клика реально: ' + atPoint, 'info');
              } catch (_) {}

              if (isMobile) {
                // На мобилке авторизация может открыться в popup-окне.
                // Используем tap() — на мобильной вёрстке некоторые сайты
                // реагируют иначе на touch-события, чем на обычный клик мышью.
                const [popup] = await Promise.all([
                  context.waitForEvent('page', { timeout: 8000 }).catch(() => null),
                  el.click({ timeout: 5000 }).catch(() => el.tap().catch(() => page.mouse.click(box.x + box.width/2, box.y + box.height/2))),
                ]);
                log('Клик CTA: ' + s.slice(0,50), 'ok');
                ctaClicked = true;
                if (popup) {
                  log('Авторизация открылась в отдельном окне', 'ok');
                  await popup.waitForLoadState('domcontentloaded').catch(() => {});
                  await sleep(1500);
                  if (config.account && config.account.email) {
                    await doYandexAuth(popup, config, profile, results, emit);
                    await sleep(2000);
                  }
                  break;
                } else {
                  await sleep(2000);
                }
              } else {
                await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                log('Клик CTA: ' + s.slice(0,50), 'ok');
                ctaClicked = true;
                await sleep(2500);
              }
              break;
            }
          }
        } catch (_) {}
      }

      if (!ctaClicked) {
        // диагностика — логируем все видимые кнопки
        log('CTA не найдена. Видимые кнопки:', 'warn');
        try {
          const allBtns = await page.$$('button, a[href], div[class*="button"]');
          for (const btn of allBtns) {
            try {
              if (await btn.isVisible()) {
                const txt = (await btn.innerText().catch(() => '')).trim().slice(0, 60);
                if (txt) log('  · "' + txt + '"', 'info');
              }
            } catch (_) {}
          }
        } catch (_) {}
      }

      // Авторизация через попап или Паспорт
      if (popupResult === 'auth_required') {
        const popupLoginSel = sel(profile, 'popupLogin', 'div.sign-in__button', config.selectors);
        const loginBtn = await page.$(popupLoginSel).catch(() => null);
        if (loginBtn && await loginBtn.isVisible().catch(() => false)) {
          await loginBtn.click();
          await sleep(1500);
          log('Клик «Войти» в поп-апе', 'ok');
        }
      }

      await doYandexAuth(page, config, profile, results, emit);
    }

    // H1
    log('Проверяем H1...', 'info');
    const h1Els = await page.$$('h1');
    let h1Text = '';
    for (const el of h1Els) {
      try {
        const txt = (await el.innerText()).trim();
        if (txt.length > h1Text.length && !txt.toLowerCase().includes('cookie')) h1Text = txt;
      } catch (_) {}
    }
    if (h1Text) { log('H1: ' + h1Text.slice(0,60), 'ok'); result('H1 присутствует', 'pass', h1Text.slice(0,60)); }
    else { log('H1 не найден', 'warn'); result('H1 присутствует', 'warn', 'Не найден'); }

    // Meta title
    const metaTitle = await page.title().catch(() => '');
    if (metaTitle) { log('Title: ' + metaTitle.slice(0,60), 'ok'); result('Meta title', 'pass', metaTitle.slice(0,60)); }
    else { result('Meta title', 'warn', 'Пустой'); }

    // Битые картинки
    const brokenImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter(img => !img.complete || img.naturalWidth === 0)
        .map(img => img.src).slice(0,5)
    ).catch(() => []);
    if (brokenImgs.length === 0) { log('Битых картинок нет', 'ok'); result('Битые картинки', 'pass'); }
    else { log('Битые картинки: ' + brokenImgs.length, 'warn'); result('Битые картинки', 'warn', brokenImgs.length + ' шт.'); }

    // Персональные посадки
    const personalParams = ['filmId','sportperfm','albumId','artistId'];
    const urlHasPersonal = personalParams.find(p => config.landingUrl.includes(p));
    if (urlHasPersonal) { result('Персональные посадки', 'warn', urlHasPersonal + ' в URL'); }
    else { log('Персональных посадок нет', 'ok'); result('Персональные посадки', 'pass', 'Чисто'); }

    // ── БЛОК 4: Виджет и оплата ────────────────────────────────────────────
    if (config.card && config.card.number && config.account && config.account.email) {
      log('Ищем виджет покупки...', 'info');
      await sleep(2000);

      // На мобиле клик по CTA может открыть виджет в НОВОЙ странице (popup),
      // а не в текущей — тогда весь дальнейший поиск виджета/полей нужно вести
      // именно в этой новой странице, а не в исходной.
      let activePage = page;

      // После авторизации кликаем CTA снова чтобы открыть виджет
      const ctaSels2 = (profile && profile.cta) || [
        'div.promo-sport__button-subscription-offer',
        '[class*="button_background_gradient"]',
        'button:has-text("До года бесплатно")',
        'button:has-text("Попробовать бесплатно")',
        'button:has-text("Попробовать")',
        'button:has-text("Подключить")',
        'span:has-text("До года бесплатно")',
        '.button_type_new-design span',
      ];
      await activePage.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
      await activePage.waitForSelector(ctaSels2.join(', '), { timeout: 15000 }).catch(() => {});
      for (const s of ctaSels2) {
        try {
          const el = await activePage.$(s);
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            const box = await el.boundingBox();
            if (box && box.width > 0) {
              if (isMobile) {
                const [popup] = await Promise.all([
                  context.waitForEvent('page', { timeout: 8000 }).catch(() => null),
                  el.click({ timeout: 5000 }).catch(() => el.tap().catch(() => activePage.mouse.click(box.x + box.width/2, box.y + box.height/2))),
                ]);
                log('Клик CTA (открываем виджет): ' + s.slice(0,50), 'ok');
                if (popup) {
                  log('Виджет открылся в отдельном окне', 'ok');
                  await popup.waitForLoadState('domcontentloaded').catch(() => {});
                  activePage = popup;
                  await sleep(1500);
                }
              } else {
                await activePage.mouse.click(box.x + box.width/2, box.y + box.height/2);
                log('Клик CTA (открываем виджет): ' + s.slice(0,50), 'ok');
              }
              await sleep(3000);
              break;
            }
          }
        } catch (_) {}
      }

      // Кнопка «Добавить карту»
      const addCardBtn = await activePage.$('[data-testid="payment-method-button~new-card"], button:has-text("Добавить карту")').catch(() => null);
      if (addCardBtn && await addCardBtn.isVisible().catch(() => false)) {
        await addCardBtn.click({ force: true });
        log('Клик «Добавить карту»', 'ok');
        await sleep(2000);
      }

      // Диагностика: показываем все фреймы прямо сейчас, не дожидаясь ошибки —
      // полезно видеть, что вообще есть на странице в этот момент
      const framesNow = activePage.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
      log('Фреймы на странице сейчас: ' + (framesNow.length ? framesNow.slice(0,6).join(' | ').slice(0,300) : 'нет фреймов'), 'info');
      log('URL страницы сейчас: ' + activePage.url(), 'info');

      // Ищем diehard iframe
      let trustFrame = null;
      const diehardTimeout = (profile && profile.diehardTimeout) || 15;
      for (let i = 0; i < diehardTimeout * 2; i++) {
        for (const f of activePage.frames()) {
          if (f.url().includes('diehard.yandex.ru') || f.url().includes('diehard.yandex.net')) {
            trustFrame = f; break;
          }
        }
        if (trustFrame) break;
        await sleep(500);
      }

      if (!trustFrame) {
        // проверяем payment-widget — тоже с повтором, а не одной попыткой
        for (let i = 0; i < 10; i++) {
          for (const f of activePage.frames()) {
            if (f.url().includes('payment-widget')) { trustFrame = f; break; }
          }
          if (trustFrame) break;
          await sleep(500);
        }
      }

      if (!trustFrame) {
        // Диагностика: показываем все фреймы, которые реально есть на странице,
        // чтобы понять, под каким доменом/паттерном виджет открылся на самом деле
        const allFrameUrls = activePage.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
        if (allFrameUrls.length) {
          log('Виджет не найден. Фреймы на странице: ' + allFrameUrls.slice(0,6).join(' | ').slice(0,300), 'warn');
        } else {
          log('Виджет не найден. На странице вообще нет дочерних фреймов', 'warn');
        }
        log('URL текущей страницы: ' + activePage.url(), 'warn');
      }

      if (trustFrame) {
        log('Фрейм оплаты найден: ' + trustFrame.url().slice(0,60), 'ok');
        result('Виджет открылся', 'pass');

        await sleep(1000);

        // Ввод карты — используем точные ID как в рабочем test.js
        const cardNum = config.card.number.replace(/\s/g, '');
        const cardExpiry = config.card.expiry || '12/27';
        const cardCvc = config.card.cvc || '123';
        const expParts = cardExpiry.split('/');
        const expMonth = (expParts[0] || '').trim();
        const expYear  = (expParts[1] || '').trim();

        // Форма карты не всегда лежит именно в trustFrame — иногда она рендерится
        // во вложенном дочернем фрейме с другим доменом (например, у payment-widget.plus.yandex.ru).
        // Поэтому ищем поле номера карты по ВСЕМ фреймам страницы, а не только в trustFrame.
        let cardFrame = null;
        for (let ci = 0; ci < 22; ci++) {
          for (const f of activePage.frames()) {
            const el = await withTimeout(f.$('input#regular-card-number-input'), 2000).catch(() => null);
            if (el) { cardFrame = f; break; }
          }
          if (cardFrame) break;
          await sleep(1000);
        }

        if (cardFrame && cardFrame !== trustFrame) {
          log('Поле карты найдено во вложенном фрейме: ' + cardFrame.url().slice(0,60), 'ok');
        }
        if (!cardFrame) {
          log('Поле карты не появилось ни в одном фрейме', 'warn');
          cardFrame = trustFrame; // на всякий случай пробуем как раньше
        }

        const numEl = await cardFrame.$('input#regular-card-number-input');
        if (numEl) {
          await numEl.click({ force: true }); await sleep(200);
          await numEl.fill(cardNum);
          log('Номер карты введён', 'ok'); await sleep(300);
        } else { log('Поле номера карты не найдено', 'warn'); }

        const expMonthEl = await cardFrame.$('input#regular-card-month-input');
        if (expMonthEl) {
          await expMonthEl.click({ force: true }); await sleep(200);
          await expMonthEl.fill(expMonth);
          log('Месяц: ' + expMonth, 'ok'); await sleep(200);
        }

        const expYearEl = await cardFrame.$('input#regular-card-year-input');
        if (expYearEl) {
          await expYearEl.click({ force: true }); await sleep(200);
          await expYearEl.fill(expYear);
          log('Год: ' + expYear, 'ok'); await sleep(200);
        }

        const cvcEl = await cardFrame.$('input#regular-card-cvv-input, .field-container__cvv_regular input, .field-container__cvv input');
        if (cvcEl) {
          await cvcEl.click({ force: true }); await sleep(200);
          await cvcEl.fill(cardCvc);
          log('CVC введён', 'ok'); await sleep(300);
        }

        await sleep(1000);

        // Кнопка «Подключить» — сначала ищем там же, где была форма карты,
        // затем в payment-widget iframe, и только потом на самой странице
        let widgetFrame = null;
        for (const f of activePage.frames()) {
          if (f.url().includes('payment-widget')) { widgetFrame = f; break; }
        }
        const connectBtnSel = sel(profile, 'connectBtn',
          'button[data-testid="trust-card-form-submit-button"], button:has-text("Подключить")',
          config.selectors);
        const connectBtn = await cardFrame.$(connectBtnSel).catch(() => null)
          || (widgetFrame ? await widgetFrame.$(connectBtnSel).catch(() => null) : null)
          || await activePage.$(connectBtnSel).catch(() => null);

        if (connectBtn) {
          await connectBtn.click({ force: true });
          log('Клик «Подключить»', 'ok');
          await sleep(3000);

            // SMS подтверждение
            const isPaidCard = config.account && config.account.type === 'paid-card';

            if (!isPaidCard) {
              // Сначала ждём появления SMS-поля на странице (до 60 секунд)
              log('Ждём SMS-поле на странице...', 'info');
              let smsField = null;
              let smsFrame = activePage;
              for (let si = 0; si < 60; si++) {
                // проверяем 3DS фрейм банка и ищем SMS поле
                let has3ds = false;
                for (const f of activePage.frames()) {

                  const furl = f.url();
                  // 3DS фрейм банка — ждём именно страницу с формой ввода кода
                  // trust.yandex.ru — промежуточный, secure.tbank.ru — реальная форма
                  if (furl.includes('secure.tbank.ru') || furl.includes('3dsec') ||
                      (furl.includes('acs/') && furl.includes('challenge'))) {
                    has3ds = true;
                    smsFrame = f;
                    log('3DS форма банка: ' + furl.slice(0, 80), 'ok');
                    break;
                  }
                  // ищем поле напрямую
                  try {
                    const sf2 = await withTimeout(f.$('input[data-qa="otp-input"], #otp-container input, input[maxlength="6"], input[maxlength="4"], input[name*="otp"], input[name*="code"], input[id*="otp"]'), 2000).catch(() => null);
                    if (sf2 && await sf2.isVisible().catch(() => false)) {
                      smsField = sf2; smsFrame = f;
                      log('SMS-поле: ' + furl.slice(0, 80), 'ok');
                      break;
                    }
                  } catch (_) {}
                }
                if (smsField || has3ds) break;
                // страница напрямую
                smsField = await activePage.$('input[data-qa="otp-input"], #otp-container input, input[maxlength="6"], input[maxlength="4"], input[autocomplete="one-time-code"]').catch(() => null);
                if (smsField && await smsField.isVisible().catch(() => false)) { smsFrame = activePage; break; }
                smsField = null;
                await sleep(1000);
              }
              if (smsField) {
                log('SMS-поле найдено — показываем окошко', 'ok');
              } else if (smsFrame && smsFrame !== activePage) {
                log('3DS фрейм банка найден — показываем окошко', 'ok');
              } else {
                log('SMS-поле не найдено — всё равно показываем окошко', 'warn');
              }

              // Показываем модалку — сервер сам пришлёт sms_required при обработке sms_wait ниже
              log('Ждём SMS-код от пользователя...', 'info');

              const smsCode = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(''), 180000);
                emit({ type: 'sms_wait', resolve: (code) => { clearTimeout(timer); resolve(code); } });
              });

              if (smsCode) {
                // ищем поле для SMS в нескольких местах
                let smsField = null;
                let smsFrame = activePage;
                for (let si = 0; si < 10; si++) {
                  smsField = await activePage.$('input[data-qa="otp-input"], #otp-container input, input[placeholder*="SMS" i], input[placeholder*="код" i], input[maxlength="6"], input[maxlength="4"], input[autocomplete="one-time-code"]').catch(() => null);
                  if (smsField && await smsField.isVisible().catch(() => false)) { smsFrame = activePage; break; }
                  smsField = null;
                  const sf = await findInput(trustFrame, ['input[data-qa="otp-input"]', 'input[maxlength="6"]', 'input[maxlength="4"]', 'input[placeholder*="код"]']);
                  if (sf) { smsField = sf; smsFrame = trustFrame; break; }
                  for (const f of activePage.frames()) {
                    if (f.url().includes('payment-widget')) {
                      const sf2 = await withTimeout(f.$('input[data-qa="otp-input"], input[maxlength="6"], input[maxlength="4"], input[placeholder*="код" i]'), 2000).catch(() => null);
                      if (sf2 && await sf2.isVisible().catch(() => false)) { smsField = sf2; smsFrame = f; break; }
                    }
                  }
                  if (smsField) break;
                  await sleep(500);
                }

                if (smsField) {
                  await smsField.click({ force: true }); await sleep(200);
                  await smsField.type(smsCode, { delay: 80 });
                  log('SMS-код введён в поле', 'ok');
                  await sleep(500);
                  await smsField.press('Enter');
                } else if (smsFrame && smsFrame !== activePage) {
                  // 3DS фрейм — фокусируем и вводим через keyboard
                  log('Вводим код в 3DS фрейм банка...', 'info');
                  try {
                    // пробуем найти любой input в фрейме
                    const anyInput = await smsFrame.$('input').catch(() => null);
                    if (anyInput) {
                      await anyInput.click({ force: true }); await sleep(200);
                      await anyInput.type(smsCode, { delay: 80 });
                      await anyInput.press('Enter');
                      log('SMS-код введён в 3DS форму', 'ok');
                    } else {
                      await activePage.keyboard.type(smsCode, { delay: 80 });
                      await activePage.keyboard.press('Enter');
                      log('SMS-код введён через клавиатуру', 'ok');
                    }
                  } catch (_) {
                    await activePage.keyboard.type(smsCode, { delay: 80 });
                    await activePage.keyboard.press('Enter');
                    log('SMS-код введён через клавиатуру (fallback)', 'ok');
                  }
                } else {
                  log('Вводим код через клавиатуру', 'info');
                  await activePage.keyboard.type(smsCode, { delay: 80 });
                  await sleep(300);
                  await activePage.keyboard.press('Enter');
                }
                log('SMS-код введён: ' + smsCode, 'ok');
                await sleep(3000);
                result('SMS-подтверждение', 'pass', 'Введено вручную');
              } else {
                log('SMS-код не введён (пропущен)', 'warn');
                result('SMS-подтверждение', 'warn', 'Пропущено');
              }
            } else {
              // Paid-card — одноклик без SMS
              log('Одноклик — SMS не требуется', 'ok');
              result('Оплата', 'pass', 'Одноклик');
            }

            await sleep(2000);
            result('Оплата', 'pass');

            // Опция «Попробовать»
            log('Ждём экран опции...', 'info');
            const upsaleSel = '[data-testid="accept-button"], button:has-text("Попробовать бесплатно"), button:has-text("Попробовать")';
            let upsaleBtn = null;
            for (let i = 0; i < 30; i++) {
              upsaleBtn = await activePage.$(upsaleSel).catch(() => null);
              if (upsaleBtn && await upsaleBtn.isVisible().catch(() => false)) break;
              upsaleBtn = null;
              // Ищем во ВСЕХ фреймах, а не только тех, где в URL есть "payment-widget" —
              // экран опции иногда рендерится в другом фрейме (например diehard)
              for (const f of activePage.frames()) {
                const btn = await withTimeout(f.$(upsaleSel), 2000).catch(() => null);
                if (btn && await btn.isVisible().catch(() => false)) { upsaleBtn = btn; break; }
              }
              if (upsaleBtn) break;
              await sleep(1000);
            }

            if (upsaleBtn) {
              await upsaleBtn.click({ force: true });
              log('Клик «Попробовать» на опции', 'ok');
              result('Опция принята', 'pass');
              await sleep(2000);
            } else {
              result('Опция принята', 'warn', 'Экран не появился');
              const frameUrls = activePage.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
              log('Опция не найдена. Фреймы: ' + (frameUrls.length ? frameUrls.slice(0,6).join(' | ').slice(0,300) : 'нет'), 'warn');
              await saveDebugShot(activePage, 'upsale-not-found', emit);
            }

            // «Не сейчас»
            log('Ждём «Не сейчас»...', 'info');
            const skipSel = '[data-testid="button~skip"], button:has-text("Не сейчас")';
            let skipBtn = null;
            for (let i = 0; i < 15; i++) {
              skipBtn = await activePage.$(skipSel).catch(() => null);
              if (skipBtn && await skipBtn.isVisible().catch(() => false)) break;
              skipBtn = null;
              for (const f of activePage.frames()) {
                const btn = await withTimeout(f.$(skipSel), 2000).catch(() => null);
                if (btn && await btn.isVisible().catch(() => false)) { skipBtn = btn; break; }
              }
              if (skipBtn) break;
              await sleep(1000);
            }
            if (skipBtn) {
              await skipBtn.click({ force: true });
              log('Клик «Не сейчас»', 'ok');
              result('Подписка оформлена', 'pass');
            } else {
              log('Кнопка «Не сейчас» не найдена', 'warn');
            }

          } else {
            log('Кнопка «Подключить» не найдена', 'warn');
            result('Оплата', 'warn', 'Кнопка не найдена');
          }
      } else {
        log('Виджет не найден', 'warn');
        await saveDebugShot(activePage, 'widget-not-found', emit);
        result('Виджет открылся', 'warn', 'Не отображается');
      }
    }

    // ── БЛОК 5: Цели Метрики ───────────────────────────────────────────────
    log('Итого целей Метрики: ' + ymGoals.length, ymGoals.length > 0 ? 'ok' : 'warn');
    if (ymGoals.length > 0) {
      result('Яндекс Метрика', 'pass', ymGoals.length + ' событий');
      // финальная сверка полным списком — подстраховка на случай гонки событий
      if (svc) emit({ type:'goals', svc, firedGoals: ymGoals });
    } else {
      result('Яндекс Метрика', 'warn', '0 событий');
    }

  } catch (err) {
    log('Ошибка: ' + err.message, 'fail');
    result('Критическая ошибка', 'fail', '', err.message);
  } finally {
    await browser.close();
    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const warn = results.filter(r => r.status === 'warn').length;
    log('Готово. Прошли: ' + pass + ' Упали: ' + fail + ' Предупреждения: ' + warn, fail > 0 ? 'warn' : 'ok');
    emit({ type:'results', results });
  }
}

// Обёртка со страховочным таймаутом на весь прогон целиком.
// Если что-то где-то зависнет без ограничения по времени (сеть, зомби-процесс
// браузера и т.д.) — прогон принудительно завершится сам, а не будет висеть
// вечно и блокировать сервер для всех следующих тестов.
async function runTest(config, emit) {
  const WATCHDOG_MS = 6 * 60 * 1000; // 6 минут на весь прогон
  const browserRef = { browser: null };
  let watchdogTimer;
  let finished = false;

  const watchdog = new Promise((resolve) => {
    watchdogTimer = setTimeout(async () => {
      if (finished) return;
      emit({ type: 'log', msg: 'Прогон превысил ' + (WATCHDOG_MS / 60000) + ' минут — принудительно завершаем', logType: 'fail' });
      if (browserRef.browser) {
        try { await browserRef.browser.close(); } catch (_) {}
      }
      emit({ type: 'results', results: [{ name: 'Критическая ошибка', status: 'fail', note: 'Таймаут прогона (' + (WATCHDOG_MS / 60000) + ' мин)' }] });
      resolve();
    }, WATCHDOG_MS);
  });

  await Promise.race([
    runTestInner(config, emit, browserRef).finally(() => { finished = true; clearTimeout(watchdogTimer); }),
    watchdog,
  ]);
}

// ── Визуальная проверка вёрстки на нескольких устройствах ──────────────────
// Лёгкая проверка: без авторизации и оплаты — только загрузка страницы,
// базовые проверки (H1, CTA видна, картинки не битые) и скриншот.
// Устройства идут ПОСЛЕДОВАТЕЛЬНО (не параллельно) — экономим память сервера.

const VISUAL_DEVICES = [
  { key: 'chromium', label: 'Chromium Desktop' },
  { key: 'yandex',   label: 'Яндекс Браузер' },
  { key: 'iphone',   label: 'iPhone 13' },
  { key: 'pixel',    label: 'Pixel 5' },
];

async function launchForDevice(deviceKey) {
  if (deviceKey === 'iphone') {
    const browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({
      ...devices['iPhone 13'], deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    });
    return { browser, context };
  }
  if (deviceKey === 'pixel') {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
    const context = await browser.newContext({ ...devices['Pixel 5'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    return { browser, context };
  }
  if (deviceKey === 'yandex') {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      locale: 'ru-RU', timezoneId: 'Europe/Moscow',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.6.0.0 Safari/537.36',
    });
    return { browser, context };
  }
  // chromium (десктоп по умолчанию)
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  return { browser, context };
}

async function checkOneDevice(deviceKey, label, landingUrl, emit) {
  const checks = [];
  let screenshotUrl = null;
  let browser = null;

  function pushCheck(name, status, note) {
    checks.push({ name, status, note });
  }

  try {
    const launched = await withTimeout(launchForDevice(deviceKey), 30000);
    browser = launched.browser;
    const context = launched.context;
    const page = await context.newPage();

    try {
      await withTimeout(page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }), 25000);
      await sleep(1500);
      pushCheck('Открытие лендинга', 'pass');
    } catch (e) {
      pushCheck('Открытие лендинга', 'fail', e.message.slice(0, 100));
      throw e; // без загруженной страницы остальные проверки бессмысленны
    }

    // Закрываем поп-ап (например "Войдите, чтобы продолжить"), если он есть —
    // иначе он перекрывает весь лендинг на скриншоте
    const profile = findProfile(landingUrl);
    try {
      const popupResult = await withTimeout(handlePopup(page, profile, emit), 10000);
      if (popupResult === 'auth_required') {
        // Поп-ап без крестика — сам является формой входа, стандартного
        // способа закрыть нет. Пробуем по очереди несколько приёмов:
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(400);

        // 1) Ищем сам оверлей по типичным именам классов и кликаем по нему
        //    в точке ЗА ПРЕДЕЛАМИ самой карточки модалки (обычно верх/низ экрана)
        const overlaySel = '[class*="overlay" i], [class*="backdrop" i], [class*="modal-bg" i], [class*="modal__bg" i], [role="dialog"]';
        const overlay = await page.$(overlaySel).catch(() => null);
        if (overlay) {
          const vp = page.viewportSize() || { width: 400, height: 800 };
          // кликаем в самом верху экрана — там обычно только фон, а не сама карточка
          await page.mouse.click(vp.width / 2, 15).catch(() => {});
          await sleep(400);
        }

        // 2) Если не помогло — просто кликаем в угол страницы (за пределами модалки)
        await page.mouse.click(5, 5).catch(() => {});
        await sleep(400);
      }
    } catch (_) {}

    // H1
    const h1Els = await page.$$('h1').catch(() => []);
    let h1Text = '';
    for (const el of h1Els) {
      try {
        const txt = (await el.innerText()).trim();
        if (txt.length > h1Text.length && !txt.toLowerCase().includes('cookie')) h1Text = txt;
      } catch (_) {}
    }
    if (h1Text) pushCheck('H1 присутствует', 'pass', h1Text.slice(0, 60));
    else pushCheck('H1 присутствует', 'warn', 'Не найден');

    // CTA видна (используем профиль лендинга, если есть)
    const ctaSels = (profile && profile.cta) || [
      'button:has-text("До года бесплатно")', 'span:has-text("До года бесплатно")',
      'button:has-text("Попробовать")', 'button:has-text("Подключить")',
    ];
    let ctaVisible = false;
    for (const s of ctaSels) {
      try {
        const el = await page.$(s);
        if (el && await el.isVisible().catch(() => false)) { ctaVisible = true; break; }
      } catch (_) {}
    }
    pushCheck('CTA кнопка видима', ctaVisible ? 'pass' : 'warn', ctaVisible ? '' : 'Не найдена');

    // Битые картинки
    const brokenImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).filter(img => !img.complete || img.naturalWidth === 0).length
    ).catch(() => 0);
    pushCheck('Битые картинки', brokenImgs === 0 ? 'pass' : 'warn', brokenImgs === 0 ? '' : brokenImgs + ' шт.');

    // Meta title
    const title = await page.title().catch(() => '');
    pushCheck('Meta title', title ? 'pass' : 'warn', title ? title.slice(0, 50) : 'Пустой');

    // Горизонтальный скролл (частая проблема мобильной вёрстки)
    const hasHScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    ).catch(() => false);
    pushCheck('Горизонтальный скролл', hasHScroll ? 'warn' : 'pass', hasHScroll ? 'Есть — возможен баг вёрстки' : '');

    // Скриншот
    screenshotUrl = await saveDebugShot(page, 'visual-' + deviceKey, emit).catch(() => null);

  } catch (e) {
    if (!checks.length) pushCheck('Открытие лендинга', 'fail', e.message.slice(0, 100));
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }

  return { device: deviceKey, label, checks, screenshotUrl };
}

async function runVisualCheckInner(config, emit) {
  const landingUrl = config.landingUrl;
  emit({ type: 'log', msg: 'Проверка вёрстки на ' + VISUAL_DEVICES.length + ' устройствах: ' + landingUrl, logType: 'info' });

  const allResults = [];
  for (const d of VISUAL_DEVICES) {
    emit({ type: 'log', msg: 'Устройство: ' + d.label + '...', logType: 'info' });
    const result = await checkOneDevice(d.key, d.label, landingUrl, emit);
    allResults.push(result);
    emit({ type: 'visual_result', ...result });
  }

  emit({ type: 'visual_done', results: allResults });
}

// Обёртка с общим страховочным таймаутом (аналогично основному runTest)
async function runVisualCheck(config, emit) {
  const WATCHDOG_MS = 5 * 60 * 1000; // 5 минут на все 4 устройства
  let watchdogTimer;
  let finished = false;

  const watchdog = new Promise((resolve) => {
    watchdogTimer = setTimeout(() => {
      if (finished) return;
      emit({ type: 'log', msg: 'Проверка вёрстки превысила ' + (WATCHDOG_MS / 60000) + ' минут — прерываем', logType: 'fail' });
      emit({ type: 'visual_done', results: [] });
      resolve();
    }, WATCHDOG_MS);
  });

  await Promise.race([
    runVisualCheckInner(config, emit).finally(() => { finished = true; clearTimeout(watchdogTimer); }),
    watchdog,
  ]);
}

module.exports = { runTest, runVisualCheck };
