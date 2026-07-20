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

  // Запуск браузера
  const isMobile = config.device === 'iphone' || config.device === 'pixel';
  log('Устройство: ' + (config.device || 'chromium'), 'info');
  log('Запускаем браузер...', 'info');

  let browser, context;
  try {
    if (config.device === 'iphone') {
      browser = await webkit.launch({ headless: true, args: [] });
      context = await browser.newContext({
        ...devices['iPhone 13'],
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
      });
    } else {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
      });
      const ctxOpts = { locale:'ru-RU', timezoneId:'Europe/Moscow' };
      if (config.device === 'pixel') {
        Object.assign(ctxOpts, devices['Pixel 5']);
      } else {
        ctxOpts.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      }
      context = await browser.newContext(ctxOpts);
    }
  } catch (e) {
    emit({ type:'error', message: 'Ошибка запуска браузера: ' + e.message });
    emit({ type:'results', results });
    return;
  }

  const page = await context.newPage();

  // CDP перехват Метрики
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', event => {
      const text = (event.args||[]).map(a => a.value || a.description || '').join(' ');
      if (/reachGoal|Goal|ym\./i.test(text)) {
        ymGoals.push(text);
        log('Метрика: ' + text.slice(0, 100), 'ok');
      }
    });
  } catch (_) {}

  page.on('console', msg => {
    const text = msg.text();
    if (/reachGoal|Goal|ym\.|Metrika/i.test(text)) {
      ymGoals.push(text);
      log('Метрика: ' + text.slice(0, 100), 'ok');
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
              await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
              log('Клик CTA: ' + s.slice(0,50), 'ok');
              ctaClicked = true;
              await sleep(2500);
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

        // Ввод карты
        const cardNum = config.card.number.replace(/\s/g, '');
        const cardExpiry = config.card.expiry || '12/27';
        const cardCvc = config.card.cvc || '123';

        const cardField = await findInput(trustFrame, [
          'input[placeholder*="Номер"]', 'input[name*="card"]',
          'input[data-testid="card-number"]', 'input[autocomplete="cc-number"]',
          'input[type="tel"]', 'input[inputmode="numeric"]',
        ]);

        if (cardField) {
          await cardField.click(); await sleep(300);
          await cardField.type(cardNum, { delay: 80 });
          log('Номер карты введён', 'ok');
          await sleep(500);

          // Срок
          const expField = await findInput(trustFrame, [
            'input[placeholder*="ММ/ГГ"]', 'input[placeholder*="MM/YY"]',
            'input[data-testid="card-expiry"]', 'input[autocomplete="cc-exp"]',
          ]);
          if (expField) { await expField.click(); await expField.type(cardExpiry, { delay: 80 }); log('Срок введён', 'ok'); await sleep(300); }

          // CVC
          const cvcField = await findInput(trustFrame, [
            'input[placeholder*="CVC"]', 'input[placeholder*="CVV"]',
            'input[data-testid="card-cvc"]', 'input[autocomplete="cc-csc"]',
          ]);
          if (cvcField) { await cvcField.click(); await cvcField.type(cardCvc, { delay: 80 }); log('CVC введён', 'ok'); await sleep(300); }

          // Кнопка «Подключить»
          const connectSel = sel(profile, 'connectBtn', '[data-testid="trust-card-form-submit-button"], button:has-text("Подключить"), button:has-text("Оформить")', config.selectors);
          const connectBtn = await findInput(trustFrame, connectSel.split(',').map(s => s.trim()));
          if (connectBtn) {
            await connectBtn.click({ force: true });
            log('Клик «Подключить»', 'ok');
            await sleep(3000);

            // SMS подтверждение
            const smsField = await findInput(trustFrame, [
              'input[placeholder*="SMS"]', 'input[placeholder*="код"]',
              'input[data-testid="sms-code"]', 'input[autocomplete="one-time-code"]',
            ]);

            if (smsField) {
              log('Ожидаем SMS-код от пользователя...', 'info');
              emit({ type: 'sms_required' });

              // Ждём SMS-код от пользователя через WebSocket (до 3 минут)
              const smsCode = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(''), 180000);
                emit({ type: 'sms_wait', resolve: (code) => { clearTimeout(timer); resolve(code); } });
              });

              if (smsCode) {
                await smsField.click(); await sleep(200);
                await smsField.type(smsCode, { delay: 80 });
                log('SMS-код введён', 'ok');
                await sleep(1000);
                await page.keyboard.press('Enter');
                await sleep(3000);
                result('SMS-подтверждение', 'pass', 'Введено вручную');
              } else {
                log('SMS-код не введён (таймаут)', 'warn');
                result('SMS-подтверждение', 'warn', 'Таймаут');
              }
            } else {
              // Одноклик — SMS не нужен
              log('SMS не запрошен — одноклик', 'ok');
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
          log('Поле карты не найдено', 'warn');
          result('Виджет открылся', 'warn', 'Поле карты не найдено');
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
      const url = config.landingUrl;
      const svc = url.includes('music.yandex') ? 'music' : url.includes('kinopoisk') ? 'kp' : url.includes('books.yandex') ? 'books' : null;
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
