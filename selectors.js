// selectors.js — справочник селекторов для разных лендингов
// Тестер автоматически выбирает нужный набор по URL

module.exports = [

  // ── Яндекс Музыка ─────────────────────────────────────────────────────
  {
    match: url => url.includes('music.yandex.ru'),
    name: 'Яндекс Музыка',
    cta: [
      'span:has-text("До года бесплатно")',
      'span:has-text("До года")',
      '.button_type_new-design span',
      '[class*="button-subscription__button"] span',
    ],
    moreBtn:    '[data-testid="split-add-user-more-button"]',
    loginItem:  '[data-testid="menu-option-switchToLogin"]',
    // мобильный поп-ап
    popupSel:   'div.app__sign-in, div.sign-in, [class*="sign-in__block"]',
    popupLogin: 'div.sign-in__button.button, div.sign-in__button',
    popupClose: null,
    emailToggle: null,
    emailField:  null,
    loginBtn:    null,
    personalLanding: false,
  },

  // ── Яндекс Книги ──────────────────────────────────────────────────────
  {
    match: url => url.includes('books.yandex.ru'),
    name: 'Яндекс Книги',
    cta: [
      'span:has-text("До года бесплатно")',
      'span:has-text("До года")',
      '.button_type_new-design span',
      '[class*="button-subscription__button"] span',
    ],
    moreBtn:   '[data-testid="split-add-user-more-button"]',
    loginItem: '[data-testid="menu-option-switchToLogin"]',
    popupClose: null,
    popupLogin: null,
    emailToggle: null,
    emailField: null,
    loginBtn: null,
    personalLanding: false,
  },

  // ── Кинопоиск — гифты (/special/new/) ───────────────────────────────
  {
    match: url => url.includes('kinopoisk.ru/special/new/'),
    name: 'Кинопоиск Гифт',
    cta: [
      '[data-testid="submit-button"]',
      'button:has-text("Активировать")',
      '.GiftStartScreen__form-button--QHZTR button',
      '[class*="GiftStartScreen__form-button"] button',
      'div.sign-in__button.button',
      'div.sign-in__button',
    ],
    popupLogin:  'div.sign-in__button.button',
    moreBtn:     'xpath=/html/body/div/div[2]/div/form/div[2]/div[2]/div/div/button[2], [data-testid="split-add-user-more-button"], button:has-text("Ещё")',
    loginItem:   '[data-testid="menu-option-switchToLogin"]',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField:  'input[name="email"].login__input',
    loginBtn:    'button.login__button',
    connectBtn:  '[data-testid="trust-card-form-submit-button"]',
    activateBtn: null,
    noH1: true,    // на гифт-лендингах нет H1
    noCta: true,   // CTA = кнопка Активировать в виджете, не на странице
    personalLanding: false,
  },

  // ── Кинопоиск — лендинги с кнопкой «Подключить и смотреть» ──────────────
  {
    match: url => url.includes('kinopoisk.ru') && (
      url.includes('takemyruble360') ||
      url.includes('takemyruble-')
    ),
    name: 'Кинопоиск (Подключить и смотреть)',
    cta: [
      'xpath=/html/body/div[1]/main/section[1]/div[5]/div[1]/div/span',
      'div.subscription-button span',
      'div.button_background_gradient span',
      'span:has-text("Подключить")',
    ],
    popupLogin:  'div.sign-in__button',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField:  'input[name="email"].login__input',
    loginBtn:    'button.login__button',
    connectBtn:  '[data-testid="trust-card-form-submit-button"]',
    diehardTimeout: 25,
    initialWait: 5000,  // виджет грузится медленнее
    personalLanding: false,
  },

  // ── Кинопоиск — обычный лендинг ───────────────────────────────────────
  {
    match: url => url.includes('kinopoisk.ru') && !url.includes('filmId'),
    name: 'Кинопоиск',
    cta: [
      'span:has-text("До года бесплатно")',
      'span:has-text("До года")',
      '.button_type_new-design span',
    ],
    popupLogin:  'div.sign-in__button',
    emailToggle: 'button.login__toggle-btn:has-text("Почта"), button.login__toggle-switch:has-text("Почта")',
    emailField:  'input[name="email"].login__input',
    loginBtn:    'button.login__button',
    connectBtn:  '[data-testid="trust-card-form-submit-button"]',
    personalLanding: false,
  },

  // ── Кинопоиск — персональный лендинг (с filmId) ───────────────────────
  {
    match: url => url.includes('kinopoisk.ru') && url.includes('filmId'),
    name: 'Кинопоиск (персональный)',
    cta: [
      'span:has-text("До года бесплатно")',
      'span:has-text("Смотреть бесплатно")',
      '.button_type_new-design span',
    ],
    popupLogin:  'div.sign-in__button',
    emailToggle: 'button.login__toggle-switch:has-text("Почта"), button.login__toggle-btn:has-text("Почта")',
    emailField:  'input[name="email"].login__input',
    loginBtn:    'button.login__button',
    connectBtn:  '[data-testid="trust-card-form-submit-button"]',
    personalLanding: true,
  },

];