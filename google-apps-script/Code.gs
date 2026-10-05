function doGet() {
  return HtmlService.createHtmlOutputFromFile('Form').setTitle('Бюро подарков — доставка PDF')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getGiftStatus(access) {
  try {
    const gift = authorizeGift_(access);
    const state = readState_(access.id);
    return state ? publicState_(state) : { status: 'ready' };
  } catch (_) { throw new Error('Подарок недоступен. Проверь полную личную ссылку или обратись к отправителю.'); }
}

function sendGift(access, email, confirmation) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Отправка уже выполняется. Проверь статус через минуту.');
  try {
    const gift = authorizeGift_(access);
    const recipient = normalizeEmail_(email);
    if (recipient !== normalizeEmail_(confirmation)) throw new Error('Адреса не совпадают.');
    const previous = readState_(access.id);
    if (previous) {
      if (previous.recipient !== recipient) throw new Error('Этот подарок уже закреплён за другим адресом.');
      if (previous.status === 'sent') return publicState_(previous);
      throw new Error('Отправка уже начата. Проверь почту и уточни статус у отправителя.');
    }
    const file = DriveApp.getFileById(gift.pdfId);
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getViewers().length || file.getEditors().length) {
      throw new Error('Отправитель ещё настраивает приватное хранение PDF.');
    }
    const pdf = file.getBlob();
    const bytes = pdf.getBytes();
    if (bytes.length < 8 || bytes.length > 10 * 1024 * 1024 || String.fromCharCode.apply(null, bytes.slice(0, 5)) !== '%PDF-') {
      throw new Error('Отправитель ещё настраивает PDF.');
    }
    const html = HtmlService.createHtmlOutputFromFile('Email_' + access.id).getContent();
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Сегодня доставка временно недоступна. Попробуй завтра.');
    const properties = PropertiesService.getScriptProperties();
    const state = { status: 'sending', recipient: recipient, startedAt: new Date().toISOString() };
    properties.setProperty('state:' + access.id, JSON.stringify(state));
    try {
      MailApp.sendEmail({ to: recipient, subject: gift.subject, body: gift.text, htmlBody: html,
        name: 'Бюро подарков', attachments: [pdf.setName('podarochnaya-karta.pdf')] });
    } catch (_) {
      state.status = 'uncertain';
      properties.setProperty('state:' + access.id, JSON.stringify(state));
      throw new Error('Не удалось подтвердить отправку. Проверь почту и обратись к отправителю.');
    }
    state.status = 'sent';
    state.sentAt = new Date().toISOString();
    properties.setProperty('state:' + access.id, JSON.stringify(state));
    return publicState_(state);
  } catch (error) {
    // Do not return Drive, authorization or provider diagnostics to the visitor.
    const safe = ['Адреса не совпадают.', 'Этот подарок уже закреплён за другим адресом.',
      'Отправка уже начата. Проверь почту и уточни статус у отправителя.',
      'Отправитель ещё настраивает приватное хранение PDF.', 'Отправитель ещё настраивает PDF.',
      'Сегодня доставка временно недоступна. Попробуй завтра.',
      'Не удалось подтвердить отправку. Проверь почту и обратись к отправителю.'];
    throw new Error(safe.indexOf(error.message) >= 0 ? error.message : 'Подарок недоступен. Проверь ссылку и адрес.');
  } finally { lock.releaseLock(); }
}

// Functions ending in _ cannot be called through google.script.run.
function authorizeGift_(access) {
  if (!access || !/^[a-f0-9]{32}$/.test(access.id || '') || !/^[A-Za-z0-9_-]{43}$/.test(access.token || '')) throw new Error('Invalid access');
  const raw = PropertiesService.getScriptProperties().getProperty('gift:' + access.id);
  if (!raw) throw new Error('Invalid access');
  const gift = JSON.parse(raw);
  if (gift.revoked || !/^[a-f0-9]{64}$/.test(gift.tokenHash || '')) throw new Error('Invalid access');
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, access.token, Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= hash.charCodeAt(index) ^ gift.tokenHash.charCodeAt(index);
  if (difference) throw new Error('Invalid access');
  return gift;
}

function readState_(id) {
  const value = PropertiesService.getScriptProperties().getProperty('state:' + id);
  return value ? JSON.parse(value) : null;
}

function publicState_(state) {
  const parts = state.recipient.split('@');
  return { status: state.status, recipient: parts[0].slice(0, 1) + '***@' + parts[1] };
}

/* EMAIL_NORMALIZER */
