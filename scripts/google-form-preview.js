import { readFile } from 'node:fs/promises';

// Local visual preview only. Never calls Google or sends an email.
export async function googleFormPreview() {
  const html = await readFile(new URL('../google-apps-script/Form.html', import.meta.url), 'utf8');
  const adapter = `<script>const google = { script: {
    url: { getLocation: callback => callback({ hash: 'delivery=' + '0'.repeat(32) + '&token=' + 'A'.repeat(43) }) },
    run: { withSuccessHandler: success => ({ withFailureHandler: failure => ({
      getGiftStatus: () => queueMicrotask(() => success({ status: 'ready' })),
      sendGift: () => queueMicrotask(() => failure(new Error('Тестовый режим. Письмо не отправляется.')))
    }) }) }
  } };</script>`;
  return html.replace('<main>', '<main><p class="message">Тестовая форма. PDF не добавлен, письмо не отправляется.</p>')
    .replace('<script>', adapter + '<script>');
}
