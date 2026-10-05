export async function createGmailSender(env = process.env) {
  const user = env.GMAIL_USER;
  const password = env.GMAIL_APP_PASSWORD?.replaceAll(' ', '');
  if (!user || !password) return null;
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  return async ({ to, subject, html, text, pdf, messageId }) => {
    const result = await transport.sendMail({
      from: { name: 'Бюро подарков', address: user }, to, subject, html, text, messageId,
      attachments: [{ filename: 'podarochnaya-karta.pdf', content: pdf, contentType: 'application/pdf' }],
    });
    return { accepted: result.accepted?.includes(to) === true };
  };
}
