import { CONFIG, STEP_NAMES, STORAGE_KEY, readProgress, writeProgress, normalizeCode } from './quest.js';
import { parseDeliveryLink, normalizeEmail, createDeliveryClient } from './delivery-client.js';
import { renderGiftEmail } from './email-template.js';
import { escapeMarkup } from './gift-crypto.js';

const $ = (selector) => document.querySelector(selector);
const giftAccess = parseDeliveryLink(location.hash);
const progressKey = giftAccess.mode === 'demo' ? STORAGE_KEY : `${STORAGE_KEY}:${giftAccess.access?.id ?? 'invalid'}`;
let currentStep = readProgress(undefined, progressKey);
let renderVersion = 0;
let soundEnabled = false;
let audio;
let scanTimer;
let selected = new Set();

function playNote(frequency = 660) {
  if (!soundEnabled) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    void audio.resume();
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.045, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    oscillator.connect(volume);
    volume.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.3);
  } catch {
    soundEnabled = false;
    updateSoundButton();
  }
}

function updateSoundButton() {
  $('#sound').textContent = `Звук: ${soundEnabled ? 'вкл.' : 'выкл.'}`;
  $('#sound').setAttribute('aria-pressed', String(soundEnabled));
  $('#sound').setAttribute('aria-label', `${soundEnabled ? 'Выключить' : 'Включить'} звук`);
}

function feedback(message) {
  $('#feedback').textContent = message;
  playNote(330);
}

function advance() {
  clearInterval(scanTimer);
  currentStep += 1;
  writeProgress(currentStep, undefined, progressKey);
  playNote();
  render(true);
}

function heading(icon, title, description) {
  return `<div class="stage-icon" aria-hidden="true">${icon}</div><h3 tabindex="-1">${title}</h3><p class="stage-description">${description}</p>`;
}

function render(focus = false) {
  renderVersion += 1;
  clearInterval(scanTimer);
  $('#intro').hidden = currentStep !== -1;
  $('#quest').hidden = currentStep < 0 || currentStep > 5;
  $('#final').hidden = currentStep !== 6;
  $('#reset').hidden = currentStep === -1;
  $('#feedback').textContent = '';
  if (currentStep === -1) {
    if (focus) $('#start').focus();
    return;
  }
  if (currentStep === 6) {
    renderFinal(focus);
    return;
  }
  $('#steps').innerHTML = STEP_NAMES.map((name, index) => `<li class="${index === currentStep ? 'active' : index < currentStep ? 'done' : ''}" ${index === currentStep ? 'aria-current="step"' : ''}><span class="step-number">${index < currentStep ? '✓' : String(index + 1).padStart(2, '0')}</span><span class="step-text">${name}</span></li>`).join('');
  const progress = Math.min(100, currentStep * 20);
  $('#percent').textContent = `${progress}%`;
  $('#progress').style.width = `${progress}%`;
  $('#stage-label').textContent = currentStep < 5 ? `ПРОВЕРКА ${String(currentStep + 1).padStart(2, '0')} / 05` : 'ПОСЛЕДНЯЯ ФОРМАЛЬНОСТЬ';
  const stage = $('#stage');
  stage.classList.remove('stage-animate');
  if (currentStep === 0) {
    stage.innerHTML = heading('◎', 'Кажется, мы тебя ждали.', 'Система обнаружила человека, которому положен сюрприз. Подтверди: это ты?') + `<div class="choices"><button class="choice" data-answer="yes">Да, подарок точно мне <span>↗</span></button><button class="choice" data-answer="maybe">Возможно. А что дают? <span>?</span></button><button class="choice" data-answer="who">А кто спрашивает? <span>♡</span></button></div>`;
    stage.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => {
      const answer = button.dataset.answer;
      if (answer === 'yes') advance();
      else feedback(answer === 'maybe' ? 'Хороший вопрос. Немного терпения — и узнаешь. Жми первый вариант.' : 'Бюро подарков. Работаем исключительно в твоих интересах. Жми первый вариант.');
    }));
  } else if (currentStep === 1) {
    selected = new Set();
    const qualities = [['✦', 'Сиять'], ['♡', 'Мечтать'], ['☼', 'Улыбаться'], ['✧', 'Удивлять'], ['❀', 'Расцветать'], ['∞', 'Быть собой']];
    stage.innerHTML = heading('✳', 'Капча хорошего настроения.', 'Выбери всё, что тебе сегодня разрешено. Подсказка: здесь можно не скромничать.') + `<div class="selection-grid">${qualities.map(([icon, label], index) => `<button class="selection-tile" aria-pressed="false" data-tile="${index}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</div><button class="primary" id="check-selection" type="button">Проверить выбор <span aria-hidden="true">↗</span></button>`;
    stage.querySelectorAll('[data-tile]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.tile;
      selected.has(key) ? selected.delete(key) : selected.add(key);
      button.setAttribute('aria-pressed', String(selected.has(key)));
      $('#feedback').textContent = '';
      playNote(440);
    }));
    $('#check-selection').addEventListener('click', () => selected.size === 6 ? advance() : feedback('Верный ответ — всё. Тебе можно и сиять, и мечтать, и быть собой.'));
  } else if (currentStep === 2) {
    stage.innerHTML = heading('♡', 'Проверка принятия подарков.', 'Представим: тебе дарят что-то классное. Твои действия?') + `<div class="choices"><button class="choice" data-answer="decline">Сказать: «Ну зачем ты потратился» <span>?</span></button><button class="choice" data-answer="later">Убрать на потом. Очень потом <span>…</span></button><button class="choice" data-answer="enjoy">Обрадоваться и выбрать что-то для себя <span>↗</span></button></div>`;
    stage.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => button.dataset.answer === 'enjoy' ? advance() : feedback(button.dataset.answer === 'decline' ? 'Потому что хочется тебя порадовать. Попробуй вариант, где ты радуешься.' : '«Потом» отменяется. Этот подарок — повод побаловать себя сейчас.')));
  } else if (currentStep === 3) {
    stage.innerHTML = heading('✧', 'Измерим уровень твоего сияния.', 'Без камеры, без фотографий. Наш прибор работает на добрых намерениях.') + `<div class="scan-display" id="scan-display"><span class="scan-value" id="scan-value">0%</span></div><button class="primary" id="scan-button" type="button">Начать сканирование <span aria-hidden="true">✦</span></button>`;
    $('#scan-button').addEventListener('click', startScan);
  } else if (currentStep === 4) {
    stage.innerHTML = heading('⌘', 'Хранилище почти открыто.', 'У каждого сюрприза есть свой код. Наш прибор оставил тебе подсказку — четыре цифры ниже.') + `<p class="code-clue">КОД ДОСТУПА: ${CONFIG.accessCode}</p><form id="code-form"><label class="code-label" for="code">Введи код из подсказки</label><input class="code-input" id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="••••" aria-describedby="code-hint" required><p class="hint" id="code-hint">Подсказка остаётся здесь. Запоминать ничего не нужно.</p><button class="primary" type="submit">Открыть хранилище <span aria-hidden="true">↗</span></button></form>`;
    $('#code-form').addEventListener('submit', event => {
      event.preventDefault();
      normalizeCode($('#code').value) === CONFIG.accessCode ? advance() : feedback('Почти! Код должен совпасть с четырьмя цифрами в подсказке.');
    });
  } else {
    stage.innerHTML = heading('✦', 'Все проверки пройдены.', 'Ты официально допущена к приятным неожиданностям. Осталось нажать одну кнопку.') + `<button class="primary" id="claim" type="button">Получить подарок <span aria-hidden="true">↗</span></button>`;
    $('#claim').addEventListener('click', () => {
      stage.innerHTML = heading('418', 'Подарок слишком хороший.', 'Система немного растерялась. Спокойно: подарок на месте. Последняя формальность — обещание.') + `<p class="code-clue" style="letter-spacing:0">ОШИБКА 418 · ПРЕВЫШЕН УРОВЕНЬ ЗАБОТЫ</p><p class="stage-description">Обещаешь выбрать то, что хочется именно тебе?</p><button class="primary" id="promise" type="button">Обещаю. Открывай! <span aria-hidden="true">♡</span></button>`;
      $('#promise').addEventListener('click', advance);
      stage.querySelector('h3').focus();
      playNote(220);
    });
  }
  requestAnimationFrame(() => stage.classList.add('stage-animate'));
  if (focus) {
    stage.querySelector('h3').focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

function startScan() {
  const button = $('#scan-button');
  button.disabled = true;
  button.textContent = 'Сканируем…';
  $('#scan-display').classList.add('scanning');
  let value = 0;
  scanTimer = setInterval(() => {
    value += 7;
    $('#scan-value').textContent = `${value}%`;
    if (value >= 140) {
      clearInterval(scanTimer);
      $('#scan-display').classList.remove('scanning');
      $('#scan-value').textContent = '140%';
      feedback('Прибор не выдержал. Сияние выше нормы. Считаем это успехом.');
      button.disabled = false;
      button.textContent = 'Принимаю комплимент ↗';
      button.removeEventListener('click', startScan);
      button.addEventListener('click', advance, { once: true });
    }
  }, 100);
}

async function renderFinal(focus) {
  const version = renderVersion;
  $('#final').innerHTML = '<div class="eyebrow" style="justify-content:center">МИССИЯ ВЫПОЛНЕНА</div><h1 id="final-title" tabindex="-1">Сюрприз — <span class="serif">на почту.</span></h1><p class="final-description" role="status">Готовим последний шаг…</p>';
  if (focus) $('#final-title').focus();
  if (giftAccess.mode === 'invalid') {
    showDeliveryError('Нужна новая личная ссылка от отправителя. Эта ссылка не подходит для получения PDF.');
    return;
  }
  let client = null;
  let preview = renderGiftEmail();
  if (giftAccess.mode === 'private') {
    try {
      client = await createDeliveryClient(giftAccess.access);
      if (version !== renderVersion || currentStep !== 6) return;
      if (client.handoffUrl) { showGoogleDelivery(client.handoffUrl); return; }
      const result = await client.status();
      if (version !== renderVersion || currentStep !== 6) return;
      preview = result.preview;
      if (result.status === 'not_configured') { showDeliveryError('Отправитель ещё подключает доставку подарка. Открой личную ссылку позже.'); return; }
      if (result.status === 'sent') { showDeliverySuccess(result.recipient); return; }
      if (result.status !== 'ready') { showDeliveryError('Статус отправки уточняется. Проверь почту или обратись к отправителю подарка.'); return; }
    } catch (error) {
      if (version !== renderVersion || currentStep !== 6) return;
      showDeliveryError(error.message === 'NOT_CONFIGURED' ? 'Отправитель ещё подключает доставку подарка. Личная ссылка сохранится — открой её позже.' : 'Не удалось открыть подарок. Проверь интернет и полную личную ссылку от отправителя.');
      return;
    }
  }
  showDeliveryForm(client, preview, focus);
}

function showGoogleDelivery(url) {
  $('#final').innerHTML = `<div class="eyebrow" style="justify-content:center"><span class="status-dot"></span> МИССИЯ ВЫПОЛНЕНА</div><h1 id="final-title" tabindex="-1">Сюрприз — <span class="serif">на почту.</span></h1><p class="final-description">Осталось указать почту для подарка.<br>Открой форму, проверь адрес и подтверди отправку PDF.</p><a class="primary" id="google-delivery" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Получить письмо с подарком <span aria-hidden="true">↗</span></a><p class="hint">Форма откроется на странице Google. Регистрация получателя не нужна.</p>`;
  $('#google-delivery').href = url;
  $('#final-title').focus();
}

function showDeliveryError(message) {
  $('#final').innerHTML = `<div class="eyebrow" style="justify-content:center">ЛИЧНЫЙ ПОДАРОК</div><h1 id="final-title" tabindex="-1">Подарок <span class="serif">подождёт.</span></h1><p class="final-description" role="alert">${escapeMarkup(message)}</p><button class="primary" id="retry-gift" type="button">Проверить ещё раз <span aria-hidden="true">↗</span></button>`;
  $('#retry-gift').addEventListener('click', () => renderFinal(true));
}

function showDeliverySuccess(recipient) {
  $('#final').innerHTML = `<div class="eyebrow" style="justify-content:center"><span class="status-dot"></span> ПОДАРОК В ПУТИ</div><h1 id="final-title" tabindex="-1">Проверь <span class="serif">почту.</span></h1><p class="final-description">Письмо с PDF принято почтовым сервисом для ${escapeMarkup(recipient)}.<br>Если его нет во входящих, проверь папку «Спам».</p><div class="mail-icon" aria-hidden="true">✉</div><p class="hint">Сохрани вложение. Это твоя подарочная карта «Золотого яблока».</p>`;
  $('#final-title').focus();
  celebrate();
}

function showDeliveryForm(client, preview, focus) {
  const demo = !client;
  $('#final').innerHTML = `<div class="eyebrow" style="justify-content:center"><span class="status-dot"></span> МИССИЯ ВЫПОЛНЕНА</div><h1 id="final-title" tabindex="-1">Сюрприз — <span class="serif">на почту.</span></h1><p class="final-description">Подарочная карта «Золотого яблока» ждёт тебя в PDF.<br>Куда отправить красивое письмо с подарком?</p><div class="delivery-card"><div class="delivery-file"><span class="pdf-icon" aria-hidden="true">PDF</span><div><strong>Твой подарок</strong><p>Подарочная карта · во вложении к письму</p></div><span aria-hidden="true">♡</span></div>${demo ? '<p class="demo-notice">Тестовый режим: PDF пока не добавлен. Настоящее письмо не отправляется.</p>' : ''}<form id="delivery-form"><label class="code-label" for="recipient-email">Твоя электронная почта</label><input class="email-input" id="recipient-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" required><label class="code-label" for="confirm-email">Повтори адрес, чтобы подарок не потерялся</label><input class="email-input" id="confirm-email" name="confirmEmail" type="email" autocomplete="off" maxlength="254" placeholder="Тот же адрес ещё раз" required><button class="primary" type="submit">Проверить адрес <span aria-hidden="true">↗</span></button></form><div id="delivery-confirm" hidden><p class="hint">Письмо с PDF отправим сюда:</p><p id="confirmed-address" class="confirmed-address"></p><div class="final-actions"><button class="primary" id="send-pdf" type="button">${demo ? 'Посмотреть тестовое письмо' : 'Отправить подарок'} <span aria-hidden="true">↗</span></button><button class="secondary" id="edit-email" type="button">Изменить адрес</button></div></div><p id="delivery-feedback" class="feedback" role="status"></p><details class="mail-preview"><summary>Как выглядит письмо</summary><iframe title="Письмо с подарком" id="email-preview" sandbox=""></iframe></details><p class="hint">Адрес используем только для доставки подарка. Проверь его перед отправкой.</p></div>`;
  $('#email-preview').srcdoc = preview.html;
  let email = '';
  let sending = false;
  $('#delivery-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const first = normalizeEmail($('#recipient-email').value);
      const second = normalizeEmail($('#confirm-email').value);
      if (first !== second) throw new Error('mismatch');
      email = first;
      $('#confirmed-address').textContent = email;
      $('#delivery-form').hidden = true;
      $('#delivery-confirm').hidden = false;
      $('#delivery-feedback').textContent = '';
      $('#send-pdf').focus();
    } catch {
      $('#delivery-feedback').textContent = 'Проверь адреса: оба должны быть одинаковыми и без опечаток.';
    }
  });
  $('#edit-email').addEventListener('click', () => {
    $('#delivery-form').hidden = false;
    $('#delivery-confirm').hidden = true;
    $('#recipient-email').focus();
  });
  $('#send-pdf').addEventListener('click', async () => {
    if (sending) return;
    if (demo) {
      $('.mail-preview').open = true;
      $('#delivery-feedback').textContent = 'Это предпросмотр. Письмо не отправлялось.';
      return;
    }
    sending = true;
    const button = $('#send-pdf');
    const edit = $('#edit-email');
    const version = renderVersion;
    button.disabled = true;
    edit.disabled = true;
    button.textContent = 'Отправляем подарок…';
    try {
      const result = await client.send(email, email);
      if (version !== renderVersion || currentStep !== 6) return;
      showDeliverySuccess(result.recipient);
    } catch {
      if (version !== renderVersion || currentStep !== 6) return;
      // Checking status is safe; resending after an SMTP timeout is not.
      showDeliveryError('Не удалось подтвердить отправку. Проверь почту. Нажми «Проверить ещё раз», чтобы уточнить статус, или обратись к отправителю подарка.');
    }
  });
  if (focus) {
    $('#final-title').focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
    celebrate();
  }
}

function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const container = $('#confetti');
  container.replaceChildren();
  for (let index = 0; index < 45; index += 1) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = ['#dcf982', '#eabbd1', '#f4f2e9'][index % 3];
    piece.style.animationDelay = `${Math.random() * 0.7}s`;
    piece.style.animationDuration = `${2 + Math.random()}s`;
    container.append(piece);
  }
  setTimeout(() => container.replaceChildren(), 4000);
}

$('#start').addEventListener('click', advance);
$('#sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  updateSoundButton();
  playNote();
});
$('#reset').addEventListener('click', () => $('#reset-dialog').showModal());
$('#cancel-reset').addEventListener('click', () => $('#reset-dialog').close());
$('#confirm-reset').addEventListener('click', () => {
  $('#reset-dialog').close();
  clearInterval(scanTimer);
  currentStep = -1;
  writeProgress(currentStep, undefined, progressKey);
  render(true);
});
if (giftAccess.mode !== 'demo') {
  $('.demo-label').textContent = 'ЛИЧНАЯ МИССИЯ';
  $('.footer > span:last-child').textContent = '01 / ДЛЯ ТЕБЯ';
  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}
// A newly pasted private link must start a fresh access context.
window.addEventListener('hashchange', () => location.reload());
render();
