import { CONFIG, STEP_NAMES, readProgress, writeProgress, normalizeCode } from './quest.js';

const $ = (selector) => document.querySelector(selector);
let currentStep = readProgress();
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
  writeProgress(currentStep);
  playNote();
  render(true);
}

function heading(icon, title, description) {
  return `<div class="stage-icon" aria-hidden="true">${icon}</div><h3 tabindex="-1">${title}</h3><p class="stage-description">${description}</p>`;
}

function render(focus = false) {
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

function renderFinal(focus) {
  $('#final').innerHTML = `<div class="eyebrow" style="justify-content:center"><span class="status-dot"></span> МИССИЯ ВЫПОЛНЕНА</div><h1 id="final-title" tabindex="-1">А теперь — <span class="serif">для себя.</span></h1><p class="final-description">Пусть это будет что-то, от чего загорятся глаза.<br>Ты заслуживаешь приятных вещей. Просто потому, что ты — это ты.</p><div class="certificate"><div class="certificate-top"><span class="certificate-brand">ЗОЛОТОЕ<br>ЯБЛОКО</span><span class="test-stamp">DEMO / НЕ ДЛЯ ОПЛАТЫ</span></div><div class="certificate-value">${CONFIG.amount} ₽</div><div class="certificate-note">Тестовая подарочная карта<br>Для репетиции самого приятного момента</div><div class="certificate-code"><span>Номер карты</span><code>${CONFIG.cardNumber}</code></div><div class="certificate-code"><span>Тестовый PIN</span><code>${CONFIG.pin}</code></div></div><div class="final-actions"><button class="primary" id="copy" type="button">Скопировать номер <span aria-hidden="true">↗</span></button><button class="secondary" id="download" type="button">Сохранить демо-карту ↓</button></div><p class="feedback" id="final-feedback" role="status"></p><p class="hint">Это демонстрация подарка, а не действующий сертификат магазина. Номер и PIN вымышлены. Оплатить покупки ими нельзя.</p>`;
  $('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(CONFIG.cardNumber);
      $('#final-feedback').textContent = 'Тестовый номер скопирован.';
      playNote();
    } catch {
      $('#final-feedback').textContent = `Браузер не разрешил копирование. Номер: ${CONFIG.cardNumber}. Его можно выделить вручную.`;
    }
  });
  $('#download').addEventListener('click', downloadCard);
  if (focus) {
    $('#final-title').focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
    celebrate();
  }
}

function downloadCard() {
  // All interpolated values are fixed demo configuration, never user input.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="680" viewBox="0 0 1080 680"><rect width="1080" height="680" rx="35" fill="#dcf982"/><g fill="#161919" font-family="Arial,sans-serif"><text x="65" y="100" font-size="38" font-weight="bold">ЗОЛОТОЕ ЯБЛОКО</text><text x="65" y="145" font-size="20">ТЕСТОВАЯ ПОДАРОЧНАЯ КАРТА</text><text x="65" y="330" font-size="110" font-weight="bold">${CONFIG.amount} ₽</text><text x="65" y="430" font-size="28">Номер: ${CONFIG.cardNumber}</text><text x="65" y="480" font-size="28">Тестовый PIN: ${CONFIG.pin}</text><text x="65" y="565" font-size="23" font-weight="bold">DEMO — НЕ ДЛЯ ОПЛАТЫ</text><text x="65" y="610" font-size="20">Номер и PIN вымышлены. Это не действующий сертификат.</text></g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gift-card-demo.svg';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#final-feedback').textContent = 'Демо-карта подготовлена для сохранения.';
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
  writeProgress(currentStep);
  render(true);
});
render();
