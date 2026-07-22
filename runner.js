// runner.js — серверная версия test.js для работы через WebSocket
// Поддерживает десктоп (Chromium) и мобильный (iPhone) режим

const { chromium, webkit, devices } = require('playwright');

let selectorRegistry = [];
try { selectorRegistry = require('./selectors.js'); } catch (_) {}

function findProfile(url) {
  return selectorRegistry.find(p => p.match(url)) || null;
}

function sel(profile, key, fallback, configSelectors) {
  return (configSelectors && configSelectors[key]) || (profile && profile[key]) || fallback;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    for (const s of moreSels) {
      try {
        const el = await page.$(s);
        if (el && await el.isVisible()) {
          await el.click();
          log('Открыто меню «Ещё»', 'ok');
          await sleep(600);
          const loginItem = await page.$('[data-testid="menu-option-switchToLogin"], button:has-text("Войти по логину")').catch(() => null);
          if (loginItem) { await loginItem.click(); await sleep(300); log('Войти по логину', 'ok'); }
          break;
        }
      } catch (_) {}
    }

    const credential = config.account.loginMode === 'email' ? config.account.email : config.account.login;

    const loginField = await findInput(page, [
      'input[placeholder*="Логин или email" i]',
      'input#passp-field-login',
      'input[name="login"]',
      'input[autocomplete="username"]',
    ]);

    if (loginField) {
      await loginField.click(); await sleep(200);
      await loginField.fill(credential);
      log('Логин: ' + credential, 'ok');
    } else {
      // клик по координатам
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

    const nextBtn = await page.$('button:has-text("Войти"), button:has-text("Далее")').catch(() => null);
    if (nextBtn) { await nextBtn.click(); } else { await page.keyboard.press('Enter'); }
    await sleep(2000);

    // пароль
    const passField = await findInput(page, [
      'input[type="password"]', 'input[name="passwd"]',
      'input#passp-field-passwd', 'input[autocomplete="current-password"]',
    ]);

    if (passField) {
      await passField.click(); await sleep(200);
      await passField.fill(config.account.password);
      log('Пароль введён', 'ok');
    } else {
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

    const nextBtn2 = await page.$('button:has-text("Войти"), button:has-text("Далее")').catch(() => null);
    if (nextBtn2) { await nextBtn2.click(); } else { await page.keyboard.press('Enter'); }
    log('Ждём завершения авторизации...', 'info');

    await page.waitForURL(u => !u.includes('passport.yandex'), { timeout: 15000 }).catch(() => {});
    await sleep(1500);

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
async function runTest(config, emit) {
  const results = [];
  const ymGoals = [];

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

  // Строгий фильтр: реальные события Яндекс.Метрики, а не любой текст со словом "goal"
  // (например, у Яндекс.Паспорта в служебных URL встречается goal=https://..., это не про Метрику)
  const METRIKA_GOAL_RE = /Reach goal\.|Goal id\s*[:=]|ym\(\s*\d+\s*,\s*['"]reachGoal['"]/i;

  // CDP перехват Метрики
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', event => {
      const text = (event.args||[]).map(a => a.value || a.description || '').join(' ');
      if (METRIKA_GOAL_RE.test(text)) {
        ymGoals.push(text);
        log('Метрика: ' + text.slice(0, 100), 'ok');
        if (svc) emit({ type:'goals', svc, firedGoals: [text] });
      }
    });
  } catch (_) {}

  page.on('console', msg => {
    const text = msg.text();
    if (METRIKA_GOAL_RE.test(text)) {
      ymGoals.push(text);
      log('Метрика: ' + text.slice(0, 100), 'ok');
      if (svc) emit({ type:'goals', svc, firedGoals: [text] });
    }
  });

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

      let ctaClicked = false;
      for (const s of ctaSels) {
        try {
          const el = await page.$(s);
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            const box = await el.boundingBox();
            if (box && box.width > 0) {
              if (isMobile) {
                // На мобилке авторизация может открыться в popup-окне
                const [popup] = await Promise.all([
                  context.waitForEvent('page', { timeout: 8000 }).catch(() => null),
                  page.mouse.click(box.x + box.width/2, box.y + box.height/2),
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
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
      for (const s of ctaSels2) {
        try {
          const el = await page.$(s);
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            const box = await el.boundingBox();
            if (box && box.width > 0) {
              await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
              log('Клик CTA (открываем виджет): ' + s.slice(0,50), 'ok');
              await sleep(3000);
              break;
            }
          }
        } catch (_) {}
      }

      // Кнопка «Добавить карту»
      const addCardBtn = await page.$('[data-testid="payment-method-button~new-card"], button:has-text("Добавить карту")').catch(() => null);
      if (addCardBtn && await addCardBtn.isVisible().catch(() => false)) {
        await addCardBtn.click({ force: true });
        log('Клик «Добавить карту»', 'ok');
        await sleep(2000);
      }

      // Ищем diehard iframe
      let trustFrame = null;
      const diehardTimeout = (profile && profile.diehardTimeout) || 15;
      for (let i = 0; i < diehardTimeout * 2; i++) {
        for (const f of page.frames()) {
          if (f.url().includes('diehard.yandex.ru') || f.url().includes('diehard.yandex.net')) {
            trustFrame = f; break;
          }
        }
        if (trustFrame) break;
        await sleep(500);
      }

      if (!trustFrame) {
        // проверяем payment-widget
        for (const f of page.frames()) {
          if (f.url().includes('payment-widget')) { trustFrame = f; break; }
        }
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

        // Ждём появления поля номера карты
        await trustFrame.waitForSelector('input#regular-card-number-input', { timeout: 10000 })
          .catch(() => { log('Поле карты не появилось', 'warn'); });
        await sleep(300);

        const numEl = await trustFrame.$('input#regular-card-number-input');
        if (numEl) {
          await numEl.click({ force: true }); await sleep(200);
          await numEl.fill(cardNum);
          log('Номер карты введён', 'ok'); await sleep(300);
        } else { log('Поле номера карты не найдено', 'warn'); }

        const expMonthEl = await trustFrame.$('input#regular-card-month-input');
        if (expMonthEl) {
          await expMonthEl.click({ force: true }); await sleep(200);
          await expMonthEl.fill(expMonth);
          log('Месяц: ' + expMonth, 'ok'); await sleep(200);
        }

        const expYearEl = await trustFrame.$('input#regular-card-year-input');
        if (expYearEl) {
          await expYearEl.click({ force: true }); await sleep(200);
          await expYearEl.fill(expYear);
          log('Год: ' + expYear, 'ok'); await sleep(200);
        }

        const cvcEl = await trustFrame.$('.field-container__cvv_regular input, .field-container__cvv input');
        if (cvcEl) {
          await cvcEl.click({ force: true }); await sleep(200);
          await cvcEl.fill(cardCvc);
          log('CVC введён', 'ok'); await sleep(300);
        }

        await sleep(1000);

        // Кнопка «Подключить» — ищем в payment-widget iframe
        let widgetFrame = null;
        for (const f of page.frames()) {
          if (f.url().includes('payment-widget')) { widgetFrame = f; break; }
        }
        const connectBtnSel = sel(profile, 'connectBtn',
          'button[data-testid="trust-card-form-submit-button"], button:has-text("Подключить")',
          config.selectors);
        const connectBtn = (widgetFrame ? await widgetFrame.$(connectBtnSel).catch(() => null) : null)
          || await page.$(connectBtnSel).catch(() => null);

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
              let smsFrame = page;
              for (let si = 0; si < 60; si++) {
                // проверяем 3DS фрейм банка и ищем SMS поле
                let has3ds = false;
                for (const f of page.frames()) {

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
                    const sf2 = await f.$('#otp-container input, input[maxlength="6"], input[name*="otp"], input[name*="code"], input[id*="otp"]');
                    if (sf2 && await sf2.isVisible().catch(() => false)) {
                      smsField = sf2; smsFrame = f;
                      log('SMS-поле: ' + furl.slice(0, 80), 'ok');
                      break;
                    }
                  } catch (_) {}
                }
                if (smsField || has3ds) break;
                // страница напрямую
                smsField = await page.$('#otp-container input, input[maxlength="6"], input[autocomplete="one-time-code"]').catch(() => null);
                if (smsField && await smsField.isVisible().catch(() => false)) { smsFrame = page; break; }
                smsField = null;
                await sleep(1000);
              }
              if (smsField) {
                log('SMS-поле найдено — показываем окошко', 'ok');
              } else if (smsFrame && smsFrame !== page) {
                log('3DS фрейм банка найден — показываем окошко', 'ok');
              } else {
                log('SMS-поле не найдено — всё равно показываем окошко', 'warn');
              }

              // Теперь показываем модалку
              log('Ждём SMS-код от пользователя...', 'info');
              emit({ type: 'sms_required' });

              const smsCode = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(''), 180000);
                emit({ type: 'sms_wait', resolve: (code) => { clearTimeout(timer); resolve(code); } });
              });

              if (smsCode) {
                // ищем поле для SMS в нескольких местах
                let smsField = null;
                let smsFrame = page;
                for (let si = 0; si < 10; si++) {
                  smsField = await page.$('#otp-container input, input[placeholder*="SMS" i], input[placeholder*="код" i], input[maxlength="6"], input[autocomplete="one-time-code"]').catch(() => null);
                  if (smsField && await smsField.isVisible().catch(() => false)) { smsFrame = page; break; }
                  smsField = null;
                  const sf = await findInput(trustFrame, ['input[maxlength="6"]', 'input[placeholder*="код"]']);
                  if (sf) { smsField = sf; smsFrame = trustFrame; break; }
                  for (const f of page.frames()) {
                    if (f.url().includes('payment-widget')) {
                      const sf2 = await f.$('input[maxlength="6"], input[placeholder*="код" i]').catch(() => null);
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
                } else if (smsFrame && smsFrame !== page) {
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
                      await page.keyboard.type(smsCode, { delay: 80 });
                      await page.keyboard.press('Enter');
                      log('SMS-код введён через клавиатуру', 'ok');
                    }
                  } catch (_) {
                    await page.keyboard.type(smsCode, { delay: 80 });
                    await page.keyboard.press('Enter');
                    log('SMS-код введён через клавиатуру (fallback)', 'ok');
                  }
                } else {
                  log('Вводим код через клавиатуру', 'info');
                  await page.keyboard.type(smsCode, { delay: 80 });
                  await sleep(300);
                  await page.keyboard.press('Enter');
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
              upsaleBtn = await page.$(upsaleSel).catch(() => null);
              if (upsaleBtn && await upsaleBtn.isVisible().catch(() => false)) break;
              upsaleBtn = null;
              for (const f of page.frames()) {
                if (f.url().includes('payment-widget')) {
                  const btn = await f.$(upsaleSel).catch(() => null);
                  if (btn && await btn.isVisible().catch(() => false)) { upsaleBtn = btn; break; }
                }
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
            }

            // «Не сейчас»
            log('Ждём «Не сейчас»...', 'info');
            const skipSel = '[data-testid="button~skip"], button:has-text("Не сейчас")';
            let skipBtn = null;
            for (let i = 0; i < 15; i++) {
              skipBtn = await page.$(skipSel).catch(() => null);
              if (skipBtn && await skipBtn.isVisible().catch(() => false)) break;
              skipBtn = null;
              for (const f of page.frames()) {
                if (f.url().includes('payment-widget')) {
                  const btn = await f.$(skipSel).catch(() => null);
                  if (btn && await btn.isVisible().catch(() => false)) { skipBtn = btn; break; }
                }
              }
              if (skipBtn) break;
              await sleep(1000);
            }
            if (skipBtn) {
              await skipBtn.click({ force: true });
              log('Клик «Не сейчас»', 'ok');
              result('Подписка оформлена', 'pass');
            }

          } else {
            log('Кнопка «Подключить» не найдена', 'warn');
            result('Оплата', 'warn', 'Кнопка не найдена');
          }
      } else {
        log('Виджет не найден', 'warn');
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

module.exports = { runTest };
