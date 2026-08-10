// selectors.js — справочник селекторов для разных лендингов

module.exports = [

  // ── Яндекс Музыка ─────────────────────────────────────────────────────
  {
    match: url => url.includes('music.yandex.ru'),
    name: 'Яндекс Музыка',
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

  // ── Яндекс Книги ──────────────────────────────────────────────────────
  {
    match: url => url.includes('books.yandex.ru'),
    name: 'Яндекс Книги',
    popupClose: 'div.sign-in__close',
    cta: [
      'button:has-text("До года бесплатно")',
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

  // ── Кинопоиск — спорт лендинг (sportperfyear и sportperfm) ──────────
  {
    match: url => url.includes('kinopoisk.ru') && (
      url.includes('sportperf')
    ),
    name: 'Кинопоиск (Спорт)',
    popupClose: null,
    cta: [
      // div кнопка — нужен клик по координатам
      'div.promo-sport__button-subscription-offer',
      'div.button_background_gradient:has-text("Попробовать")',
      'div:has-text("Попробовать бесплатно")',
      '.subscription-button',
      '[class*="button_background_gradient"]',
    ],
    popupLogin: 'div.sign-in__button',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField: 'input[name="email"].login__input',
    loginBtn: 'button.login__button',
    connectBtn: '[data-testid="trust-card-form-submit-button"]',
    personalLanding: false,
  },

  // ── Кинопоиск — гифты (/special/new/) ───────────────────────────────
  {
    match: url => url.includes('kinopoisk.ru/special/new/'),
    name: 'Кинопоиск Гифт',
    popupClose: null,
    cta: [
      '[data-testid="submit-button"]',
      'button:has-text("Активировать")',
      'div.sign-in__button.button',
      'div.sign-in__button',
    ],
    popupLogin: 'div.sign-in__button.button',
    moreBtn: '[data-testid="split-add-user-more-button"]',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField: 'input[name="email"].login__input',
    loginBtn: 'button.login__button',
    connectBtn: '[data-testid="trust-card-form-submit-button"]',
    noH1: true,
    noCta: true,
    giftLanding: true,
    personalLanding: false,
  },

  // ── Кинопоиск — лендинги с кнопкой «Подключить и смотреть» ──────────
  {
    match: url => url.includes('kinopoisk.ru') && url.includes('takemyruble'),
    name: 'Кинопоиск (Подключить и смотреть)',
    popupClose: null,
    cta: [
      'div.subscription-button span',
      'div.button_background_gradient span',
      'span:has-text("Подключить")',
    ],
    popupLogin: 'div.sign-in__button',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField: 'input[name="email"].login__input',
    loginBtn: 'button.login__button',
    connectBtn: '[data-testid="trust-card-form-submit-button"]',
    diehardTimeout: 25,
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
