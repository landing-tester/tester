// runner.js — адаптированный test.js для работы через сервер
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

async function runTest(config, emit) {
  const results = [];
  const ymGoals = [];

  function log(msg, type = 'info') {
    emit({ type: 'log', msg, logType: type });
  }

  function result(name, status, note = '') {
    results.push({ name, status, note });
    emit({ type: 'result', name, status, note });
  }

  const profile = findProfile(config.landingUrl);
  if (profile) log('Профиль: ' + profile.name, 'info');

  log('Запускаем браузер...', 'info');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Перехват целей Метрики через CDP
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', event => {
      const text = (event.args || []).map(a => a.value || a.description || '').join(' ');
      if (/reachGoal|Goal|ym\./i.test(text)) {
        ymGoals.push(text);
        log('Метрика: ' + text.slice(0, 100), 'ok');
      }
    });
  } catch (_) {}

  page.on('console', msg => {
    const text = msg.text();
    const match = text.match(/reachGoal\s*\(\s*['"]([^'"]+)['"]/i);
    if (match) {
      ymGoals.push(match[1]);
      log('reachGoal: ' + match[1], 'ok');
    }
  });

  try {
    // ── Открываем лендинг с _ym_debug=2 ──────────────────────────────────
    const ymUrl = config.landingUrl + (config.landingUrl.includes('?') ? '&' : '?') + '_ym_debug=2';
    log('Открываем: ' + ymUrl, 'info');
    await page.goto(ymUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    result('Страница открыта', 'pass');

    // ── Обрабатываем поп-ап ───────────────────────────────────────────────
    await sleep(1500);

    // Закрываем поп-ап крестиком
    const popupCloseSel = profile && profile.popupClose;
    if (popupCloseSel) {
      try {
        const closeBtn = await page.$(popupCloseSel);
        if (closeBtn && await closeBtn.isVisible()) {
          await closeBtn.click();
          log('Поп-ап закрыт крестиком', 'ok');
          await sleep(2000);
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      } catch (_) {}
    } else {
      // Пробуем стандартные кнопки закрытия
      const closeSels = [
        'button[aria-label="Закрыть"]', 'button[aria-label="Close"]',
        '[class*="close"]', 'button:has-text("Позже")', 'button:has-text("Не сейчас")',
        'button[data-t="button:accept"]', 'button:has-text("Принять")',
      ];
      for (const s of closeSels) {
        try {
          const btn = await page.$(s);
          if (btn && await btn.isVisible()) {
            const txt = await btn.innerText().catch(() => s);
            await btn.click();
            log('Закрыт баннер: "' + txt.trim().slice(0, 30) + '"', 'ok');
            await sleep(1000);
            break;
          }
        } catch (_) {}
      }
    }

    // ── Базовые проверки ─────────────────────────────────────────────────
    log('Проверяем H1...', 'info');
    const h1Els = await page.$$('h1');
    let h1Text = '';
    for (const el of h1Els) {
      try {
        const txt = (await el.innerText()).trim();
        if (txt.length > h1Text.length &&
            !txt.toLowerCase().includes('cookie') &&
            !txt.toLowerCase().includes('uses cookies') &&
            !txt.toLowerCase().includes('использует')) {
          h1Text = txt;
        }
      } catch (_) {}
    }
    if (h1Text) {
      log('H1: ' + h1Text.slice(0, 60), 'ok');
      result('H1 присутствует', 'pass', h1Text.slice(0, 60));
    } else {
      log('H1 не найден', 'warn');
      result('H1 присутствует', 'warn', 'H1 не найден');
    }

    // CTA кнопка
    const ctaSels = (profile && profile.cta) || [
      'button:has-text("Попробовать")', 'button:has-text("Подключить")',
      'button:has-text("Купить")', 'span:has-text("До года бесплатно")',
      '.button_type_new-design span', '[class*="button-subscription__button"] span',
    ];
    let ctaFound = false;
    for (const s of ctaSels) {
      try {
        const el = await page.$(s);
        if (el && await el.isVisible()) {
          const txt = await el.innerText().catch(() => s);
          log('CTA: "' + txt.trim().slice(0, 40) + '"', 'ok');
          result('CTA кнопка', 'pass', txt.trim().slice(0, 40));
          ctaFound = true;
          break;
        }
      } catch (_) {}
    }
    if (!ctaFound) {
      log('CTA кнопка не найдена', 'warn');
      result('CTA кнопка', 'warn', 'Не найдена');
    }

    // Meta title
    const metaTitle = await page.title().catch(() => '');
    if (metaTitle) {
      log('Title: ' + metaTitle.slice(0, 60), 'ok');
      result('Meta title', 'pass', metaTitle.slice(0, 60));
    } else {
      result('Meta title', 'warn', 'Пустой');
    }

    // Битые картинки
    const brokenImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter(img => !img.complete || img.naturalWidth === 0)
        .map(img => img.src).slice(0, 5)
    );
    if (brokenImgs.length === 0) {
      log('Битых картинок нет', 'ok');
      result('Битые картинки', 'pass');
    } else {
      log('Битые картинки: ' + brokenImgs.length, 'warn');
      result('Битые картинки', 'warn', brokenImgs.length + ' шт.');
    }

    // Персональные посадки
    const personalParams = ['filmId', 'sportperfm', 'albumId', 'artistId'];
    const urlHasPersonal = personalParams.find(p => config.landingUrl.includes(p));
    if (urlHasPersonal) {
      log('Персональная посадка: ' + urlHasPersonal, 'warn');
      result('Персональные посадки', 'warn', urlHasPersonal + ' найден в URL');
    } else {
      log('Персональных посадок нет', 'ok');
      result('Персональные посадки', 'pass', 'Чисто');
    }

    // ── Авторизация ──────────────────────────────────────────────────────
    if (config.account && config.account.email && config.account.password) {
      log('Начинаем авторизацию...', 'info');

      // Кликаем CTA на лендинге
      let ctaClicked = false;
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);

      for (const s of ctaSels) {
        try {
          let el;
          if (s.startsWith('xpath=')) {
            const els = await page.$x(s.replace('xpath=', '')).catch(() => []);
            el = els[0] || null;
          } else {
            el = await page.$(s);
          }
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            const box = await el.boundingBox();
            if (box && box.width > 0) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              log('Клик CTA для авторизации', 'ok');
              ctaClicked = true;
              await sleep(2500);
              break;
            }
          }
        } catch (_) {}
      }

      // Кнопка «Войти» в поп-апе (Кинопоиск)
      if (!page.url().includes('passport.yandex')) {
        const popupLoginSel = sel(profile, 'popupLogin', null, config.selectors);
        if (popupLoginSel) {
          const popupLogin = await page.$(popupLoginSel).catch(() => null);
          if (popupLogin && await popupLogin.isVisible().catch(() => false)) {
            await popupLogin.click();
            await sleep(1500);
            log('Клик на кнопку авторизации', 'ok');
          }
        }
      }

      // Ждём passport
      await page.waitForURL('**/passport.yandex**', { timeout: 8000 }).catch(() => {});
      await sleep(500);

      const isPassport = page.url().includes('passport.yandex');

      if (isPassport) {
        log('Открылся Яндекс паспорт', 'ok');

        // Кнопка «Ещё» → «Войти по логину»
        const moreSels = ['[data-testid="split-add-user-more-button"]', 'button:has-text("Ещё")', 'a:has-text("Ещё")'];
        for (const s of moreSels) {
          try {
            const el = await page.$(s);
            if (el && await el.isVisible()) {
              await el.click();
              await sleep(600);
              log('Открыто меню «Ещё»', 'ok');
              const loginItem = await page.$('[data-testid="menu-option-switchToLogin"], button:has-text("Войти по логину")').catch(() => null);
              if (loginItem) { await loginItem.click(); await sleep(500); log('Войти по логину', 'ok'); }
              break;
            }
          } catch (_) {}
        }

        // Вводим логин
        const credential = config.account.loginMode === 'login' ? config.account.login : config.account.email;
        const loginField = await findInput(page, [
          'input[id="passp-field-login"]', 'input[name="login"]',
          'input[autocomplete="username"]', 'input[placeholder*="логин" i]',
        ]);

        if (loginField) {
          await loginField.click(); await sleep(200);
          await loginField.fill(credential);
          log('Логин: ' + credential, 'ok');
        } else {
          // кликаем по координатам
          try {
            const bodyAuth = await page.$('div.body-auth, [class*="body-auth"]');
            if (bodyAuth) {
              const box = await bodyAuth.boundingBox();
              if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
            }
          } catch (_) {}
          await page.keyboard.type(credential, { delay: 60 });
          log('Логин введён по координатам', 'ok');
        }

        const loginBtn = await page.$('button:has-text("Войти")');
        if (loginBtn) { await loginBtn.click(); } else { await page.keyboard.press('Enter'); }
        await sleep(2000);

        // Пароль
        const passField = await findInput(page, [
          'input[id="passp-field-passwd"]', 'input[name="passwd"]',
          'input[type="password"]', 'input[autocomplete="current-password"]',
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
              if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
            }
          } catch (_) {}
          await page.keyboard.type(config.account.password, { delay: 60 });
          log('Пароль введён по координатам', 'ok');
        }

        const nextBtn = await page.$('button:has-text("Далее"), button:has-text("Войти")');
        if (nextBtn) { await nextBtn.click(); } else { await page.keyboard.press('Enter'); }
        log('Ждём завершения авторизации...', 'info');

        await page.waitForURL(u => !u.includes('passport.yandex'), { timeout: 15000 }).catch(() => {});
        await sleep(2000);

        if (!page.url().includes('passport.yandex')) {
          log('Авторизация успешна', 'ok');
          result('Авторизация', 'pass');
        } else {
          log('Авторизация не завершена — проверьте логин/пароль', 'warn');
          result('Авторизация', 'warn', 'Проверьте логин/пароль');
        }
      } else if (ctaClicked) {
        log('Авторизация через форму на лендинге', 'info');
        // Кинопоиск — форма прямо на странице
        const emailToggleSel = sel(profile, 'emailToggle', null, config.selectors);
        if (emailToggleSel) {
          const toggle = await page.$(emailToggleSel).catch(() => null);
          if (toggle && await toggle.isVisible().catch(() => false)) {
            await toggle.click(); await sleep(500);
            log('Переключились на Почта', 'ok');
          }
        }

        const emailFieldSel = sel(profile, 'emailField', 'input[name="email"], input[name="login"]', config.selectors);
        const emailField = await findInput(page, emailFieldSel.split(',').map(s => s.trim()));
        if (emailField) {
          const credential = config.account.loginMode === 'login' ? config.account.login : config.account.email;
          await emailField.fill(credential);
          log('Логин введён: ' + credential, 'ok');
          await page.keyboard.press('Enter');
          await sleep(1500);
          result('Авторизация', 'pass');
        } else {
          log('Поле логина не найдено', 'warn');
          result('Авторизация', 'warn', 'Поле не найдено');
        }
      } else {
        log('CTA не найдена — авторизация пропущена', 'warn');
        result('Авторизация', 'warn', 'CTA не найдена');
      }
    }

    // ── Виджет ──────────────────────────────────────────────────────────
    if (config.checkWidget !== false) {
      log('Ищем виджет покупки...', 'info');
      await sleep(2000);
      const widgetSels = [
        '[data-testid="trust-card-form-submit-button"]',
        'button:has-text("Подключить")', 'button:has-text("Оформить")',
        '[class*="widget"]', '[class*="payment"]', 'iframe[src*="payment-widget"]',
      ];
      let widgetFound = false;
      for (const s of widgetSels) {
        try {
          const el = await page.$(s);
          if (el && await el.isVisible()) {
            log('Виджет найден: ' + s, 'ok');
            result('Виджет покупки', 'pass');
            widgetFound = true;
            break;
          }
        } catch (_) {}
      }
      // Проверяем iframe
      if (!widgetFound) {
        for (const f of page.frames()) {
          if (f.url().includes('payment-widget')) {
            log('Виджет найден в iframe', 'ok');
            result('Виджет покупки', 'pass', 'Iframe');
            widgetFound = true;
            break;
          }
        }
      }
      if (!widgetFound) {
        log('Виджет не найден', 'warn');
        result('Виджет покупки', 'warn', 'Не отображается');
      }
    }

    // ── Цели Метрики ────────────────────────────────────────────────────
    if (config.checkYmGoal) {
      log('Итого целей Метрики: ' + ymGoals.length, ymGoals.length > 0 ? 'ok' : 'warn');
      if (ymGoals.length > 0) {
        result('Яндекс Метрика', 'pass', ymGoals.length + ' событий');
        const url = config.landingUrl;
        const svc = url.includes('music.yandex') ? 'music' : url.includes('kinopoisk') ? 'kp' : url.includes('books.yandex') ? 'books' : null;
        if (svc) emit({ type: 'goals', svc, firedGoals: ymGoals });
      } else {
        log('Целей не зафиксировано — откройте лендинг вручную с _ym_debug=2', 'warn');
        result('Яндекс Метрика', 'warn', '0 событий');
      }
    }

  } catch (err) {
    log('Ошибка: ' + err.message, 'fail');
    result('Критическая ошибка', 'fail', err.message);
  } finally {
    await browser.close();
    const pass = results.filter(r => r.status === 'pass').length;
    const fail = results.filter(r => r.status === 'fail').length;
    const warn = results.filter(r => r.status === 'warn').length;
    log('Готово. Прошли: ' + pass + ' Упали: ' + fail + ' Предупреждения: ' + warn, fail > 0 ? 'warn' : 'ok');
    emit({ type: 'results', results });
  }
}

module.exports = { runTest };
