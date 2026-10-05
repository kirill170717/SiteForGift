import { escapeMarkup } from './gift-crypto.js';

export const DEFAULT_EMAIL = Object.freeze({
  subject: 'Твой подарок — теперь у тебя',
  message: 'Немного интриги осталось позади. Теперь можешь выбрать что-то, от чего загорятся глаза. Пусть это будет маленькая радость только для тебя.',
  signature: 'С теплом,\nтот, кто хотел тебя порадовать',
});

export function validateEmailContent(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid email content');
  const result = {};
  for (const [key, limit] of [['subject', 160], ['message', 3000], ['signature', 300]]) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('Invalid email content');
    if (key === 'subject' && /[\r\n]/.test(value)) throw new Error('Invalid subject');
    result[key] = value.trim();
  }
  return result;
}

export function renderGiftEmail(input = DEFAULT_EMAIL) {
  const content = validateEmailContent(input);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMarkup(content.subject)}</title></head><body style="margin:0;padding:0;background:#f1f0e8;font-family:Arial,sans-serif;color:#f4f2e9"><div style="display:none;max-height:0;overflow:hidden">Ты прошла квест. Самое приятное — в PDF во вложении.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f0e8"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#161919;border-radius:16px;overflow:hidden"><tr><td style="padding:36px 32px 24px;border-bottom:1px solid #343a35"><span style="font-size:33px;color:#dcf982;vertical-align:middle">✳</span><span style="display:inline-block;margin-left:12px;font-size:11px;line-height:1.4;letter-spacing:2px;font-weight:bold;color:#f4f2e9">БЮРО<br>ПОДАРКОВ</span></td></tr><tr><td style="padding:36px 32px"><p style="margin:0 0 20px;font-size:10px;letter-spacing:2px;color:#dcf982">МИССИЯ ВЫПОЛНЕНА</p><h1 style="margin:0 0 24px;font-size:42px;line-height:1.1;letter-spacing:-1px;font-weight:normal;color:#f4f2e9">А теперь —<br><span style="font-family:Georgia,serif;color:#dcf982">для себя.</span></h1><p style="margin:0 0 28px;font-size:15px;line-height:1.8;color:#c8ccc1">${escapeMarkup(content.message).replaceAll('\n', '<br>')}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#dcf982;border-radius:10px;color:#161919"><tr><td style="padding:25px"><p style="margin:0 0 9px;font-size:10px;letter-spacing:1px;font-weight:bold;color:#34432b">ТВОЙ ПОДАРОК</p><p style="margin:0 0 16px;font-size:25px;line-height:1.2;font-weight:bold;color:#161919">Золотое яблоко</p><p style="margin:0;font-size:13px;line-height:1.7;color:#34432b">Подарочная карта находится в PDF во вложении.<br>Сохрани файл — он понадобится для использования карты.</p></td></tr></table><p style="margin:28px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#eabbd1">${escapeMarkup(content.signature).replaceAll('\n', '<br>')}</p></td></tr><tr><td style="padding:22px 32px;border-top:1px solid #343a35;font-size:10px;line-height:1.7;color:#a7aaa1">Письмо отправлено по твоему запросу после прохождения подарочного квеста. Условия использования карты — в сертификате и у магазина.</td></tr></table></td></tr></table></body></html>`;
  const text = `МИССИЯ ВЫПОЛНЕНА\n\nА теперь — для себя.\n\n${content.message}\n\nТвоя подарочная карта «Золотого яблока» — в PDF во вложении. Сохрани файл: он понадобится для использования карты.\n\n${content.signature}\n\nПисьмо отправлено по твоему запросу после прохождения подарочного квеста.`;
  return { subject: content.subject, html, text };
}
