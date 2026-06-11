// runner.js — запускает реальный Playwright тест и стримит результаты через callback

const { chromium, webkit, devices } = require('playwright');
const path = require('path');

// Загружаем selectors
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

// Основная функция — принимает конфиг и emit-коллбек
async function runTest(config, emit) {
  const results = [];

  function log(msg, type = 'info') {
    emit({ type: 'log', msg, logType: type });
  }

  function result(name, status, note = '') {
    results.push({ name, status, note });
    emit({ type: 'result', name, status, note });
  }

  const profile = findProfile(config.landingUrl);
  if (profile) log('Профиль: ' + profile.name, 'info');

  // Запускаем браузер
  log('Запускаем браузер...', 'info');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // ── Открываем лендинг ────────────────────────────────────────────────
    log('Открываем: ' + config.landingUrl, 'info');
    await page.goto(config.landingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    result('Страница открыта', 'pass');

    // ── Функциональные проверки ──────────────────────────────────────────
    log('Проверяем H1...', 'info');
    const h1 = await page.$('h1');
    if (h1) {
      const h1Text = await h1.innerText().catch(() => '');
      log('H1: ' + h1Text.trim().slice(0, 60), 'ok');
      result('H1 присутствует', 'pass', h1Text.trim().slice(0, 60));
    } else {
      log('H1 не найден', 'warn');
      result('H1 присутствует', 'warn', 'H1 не найден');
    }

    // CTA кнопка
    log('Ищем CTA кнопку...', 'info');
    const ctaSels = (profile && profile.cta) || [
      'button:has-text("Попробовать")', 'button:has-text("Подключить")',
      'button:has-text("Купить")', 'button:has-text("Оформить")',
      '.button_type_new-design span', '[class*="cta"]',
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

    // Мета-теги
    const metaTitle = await page.title().catch(() => '');
    if (metaTitle) {
      log('Title: ' + metaTitle.slice(0, 60), 'ok');
      result('Meta title', 'pass', metaTitle.slice(0, 60));
    } else {
      result('Meta title', 'warn', 'Пустой');
    }

    // Битые картинки
    log('Проверяем картинки...', 'info');
    const brokenImgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .filter(img => !img.complete || img.naturalWidth === 0)
        .map(img => img.src).slice(0, 5);
    });
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
      emit({ type: 'step', step: 'auth' });

      // Кликаем CTA
      let ctaClicked = false;
      for (const s of ctaSels) {
        try {
          const el = await page.$(s);
          if (el && await el.isVisible()) {
            await el.click();
            await sleep(1500);
            ctaClicked = true;
            log('Клик на CTA', 'ok');
            break;
          }
        } catch (_) {}
      }

      // Кнопка «Войти» в поп-апе
      await sleep(1500);
      const popupLoginSel = sel(profile, 'popupLogin', 'div.sign-in__button, button:has-text("Войти")', config.selectors);
      const popupLogin = await page.$(popupLoginSel).catch(() => null);
      if (popupLogin && await popupLogin.isVisible().catch(() => false)) {
        await popupLogin.click();
        await sleep(1500);
        log('Клик на кнопку авторизации', 'ok');
      }

      // Email toggle
      const emailToggleSel = sel(profile, 'emailToggle',
        'button.login__toggle-switch:has-text("Почта"), button.login__toggle-btn:has-text("Почта")', config.selectors);
      const emailToggle = await page.$(emailToggleSel).catch(() => null);
      if (emailToggle && await emailToggle.isVisible().catch(() => false)) {
        await emailToggle.click();
        await sleep(500);
        log('Переключились на Почта', 'ok');
      }

      // Вводим логин
      const loginField = await findInput(page, [
        'input[name="login"]', 'input[name="email"]',
        'input[type="email"]', 'input.login__input',
        'input[placeholder*="почт"]', 'input[placeholder*="логин"]',
      ]);
      if (loginField) {
        const loginVal = config.account.loginMode === 'login'
          ? config.account.login
          : config.account.email;
        await loginField.fill(loginVal);
        await sleep(300);
        log('Логин введён: ' + loginVal, 'ok');

        // Enter или кнопка Войти
        await page.keyboard.press('Enter');
        await sleep(1500);
      } else {
        log('Поле логина не найдено', 'warn');
        result('Авторизация', 'warn', 'Поле логина не найдено');
      }

      // Пароль
      const passField = await findInput(page, [
        'input[name="passwd"]', 'input[name="password"]',
        'input[type="password"]', 'input.login__input',
      ]);
      if (passField) {
        await passField.fill(config.account.password);
        await sleep(300);
        log('Пароль введён', 'ok');
        await page.keyboard.press('Enter');
        await sleep(3000);
        log('Авторизация выполнена', 'ok');
        result('Авторизация', 'pass');
      } else {
        log('Поле пароля не найдено', 'warn');
        result('Авторизация', 'warn', 'Поле пароля не найдено');
      }
    }

    // ── Виджет покупки ───────────────────────────────────────────────────
    if (config.checkWidget !== false) {
      log('Ищем виджет покупки...', 'info');
      emit({ type: 'step', step: 'widget' });
      await sleep(2000);

      // Ищем кнопку «Подключить» в виджете
      const connectSel = sel(profile, 'connectBtn',
        '[data-testid="trust-card-form-submit-button"], button:has-text("Подключить"), button:has-text("Оформить")',
        config.selectors);
      const connectBtn = await page.$(connectSel).catch(() => null);

      if (connectBtn && await connectBtn.isVisible().catch(() => false)) {
        log('Виджет открыт, кнопка подключения найдена', 'ok');
        result('Виджет покупки', 'pass', 'Кнопка видна');
      } else {
        // Проверяем iframe виджета
        let widgetFrame = null;
        for (const f of page.frames()) {
          if (f.url().includes('payment-widget')) { widgetFrame = f; break; }
        }
        if (widgetFrame) {
          log('Виджет найден в iframe', 'ok');
          result('Виджет покупки', 'pass', 'Iframe виджета найден');
        } else {
          log('Виджет не найден', 'warn');
          result('Виджет покупки', 'warn', 'Не отображается');
        }
      }
    }

    // ── Цели Яндекс Метрики ──────────────────────────────────────────────
    if (config.checkYmGoal) {
      log('Проверяем _ym_debug...', 'info');
      const ymUrl = config.landingUrl + (config.landingUrl.includes('?') ? '&' : '?') + '_ym_debug=2';
      await page.goto(ymUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(2000);

      const ymAvailable = await page.evaluate(() => typeof window.Ya !== 'undefined' || typeof window.ym !== 'undefined');
      if (ymAvailable) {
        log('Яндекс Метрика найдена на странице', 'ok');
        result('Яндекс Метрика', 'pass', '_ym_debug=2 активен');
      } else {
        log('Яндекс Метрика не найдена', 'warn');
        result('Яндекс Метрика', 'warn', 'Ya/ym не найдены');
      }
    }

  } catch (err) {
    log('Ошибка: ' + err.message, 'fail');
    result('Критическая ошибка', 'fail', err.message);
  } finally {
    await browser.close();
    log('Готово. Прошли: ' + results.filter(r => r.status === 'pass').length +
        ' Упали: ' + results.filter(r => r.status === 'fail').length +
        ' Предупреждения: ' + results.filter(r => r.status === 'warn').length, 'ok');
    emit({ type: 'results', results });
  }
}

module.exports = { runTest };
