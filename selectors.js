// selectors.js — справочник селекторов для разных лендингов

module.exports = [

  // ── Яндекс Музыка ─────────────────────────────────────────────────────
  {
    match: url => url.includes('music.yandex.ru'),
    name: 'Яндекс Музыка',
    // Закрываем поп-ап "Войдите, чтобы продолжить" крестиком
    popupClose: 'div.sign-in__close',
    // CTA кнопка на самом лендинге — клик запускает авторизацию
    cta: [
      'button:has-text("До года бесплатно")',
      'button:has-text("До года")',
      'button:has-text("Попробовать бесплатно")',
      'button:has-text("Подключить")',
      'span:has-text("До года бесплатно")',
      '.button_type_new-design span',
      '[class*="button-subscription__button"] span',
    ],
    popupLogin: null,
    emailToggle: null,
    emailField: 'input[name="login"], input[id="passp-field-login"]',
    loginBtn: 'button[type="submit"], button:has-text("Войти")',
    personalLanding: false,
  },

  // ── Яндекс Книги ──────────────────────────────────────────────────────
  {
    match: url => url.includes('books.yandex.ru'),
    name: 'Яндекс Книги',
    popupClose: 'div.sign-in__close',
    cta: [
      'button:has-text("До года бесплатно")',
      'button:has-text("До года")',
      'span:has-text("До года бесплатно")',
      '.button_type_new-design span',
      '[class*="button-subscription__button"] span',
    ],
    popupLogin: null,
    emailToggle: null,
    emailField: 'input[name="login"], input[id="passp-field-login"]',
    loginBtn: 'button[type="submit"]',
    personalLanding: false,
  },

  // ── Кинопоиск — лендинг с takemyruble ───────────────────────────────
  {
    match: url => url.includes('kinopoisk.ru') && url.includes('takemyruble'),
    name: 'Кинопоиск (Подключить и смотреть)',
    popupClose: null,
    cta: [
      'xpath=/html/body/div[1]/main/section[1]/div[5]/div[1]/div/span',
      'div.subscription-button span',
      'div.button_background_gradient span',
      'span:has-text("Подключить")',
    ],
    popupLogin: 'div.sign-in__button',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField: 'input[name="email"].login__input',
    loginBtn: 'button.login__button',
    connectBtn: '[data-testid="trust-card-form-submit-button"]',
    personalLanding: false,
  },

  // ── Кинопоиск — обычный лендинг ───────────────────────────────────────
  {
    match: url => url.includes('kinopoisk.ru') && !url.includes('filmId'),
    name: 'Кинопоиск',
    popupClose: null,
    cta: [
      'span:has-text("До года бесплатно")',
      'span:has-text("До года")',
      '.button_type_new-design span',
    ],
    popupLogin: 'div.sign-in__button',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField: 'input[name="email"].login__input',
    loginBtn: 'button.login__button',
    connectBtn: '[data-testid="trust-card-form-submit-button"]',
    personalLanding: false,
  },

  // ── Кинопоиск — персональный лендинг (с filmId) ───────────────────────
  {
    match: url => url.includes('kinopoisk.ru') && url.includes('filmId'),
    name: 'Кинопоиск (персональный)',
    popupClose: null,
    cta: [
      'span:has-text("До года бесплатно")',
      'span:has-text("Смотреть бесплатно")',
      '.button_type_new-design span',
    ],
    popupLogin: 'div.sign-in__button',
    emailToggle: 'button.login__toggle-switch:has-text("Почта"), button.login__toggle-btn:has-text("Почта")',
    emailField: 'input[name="email"].login__input',
    loginBtn: 'button.login__button',
    connectBtn: '[data-testid="trust-card-form-submit-button"]',
    personalLanding: true,
  },

];
