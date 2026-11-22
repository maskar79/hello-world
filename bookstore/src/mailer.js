// Order confirmation email: the buyer's personal download link, in the store's look.
// Sends through Resend (RESEND_API_KEY, needs your own domain) or Brevo (BREVO_API_KEY).
// With neither key set, nothing is sent (local testing prints a short note instead).
const PARTS = ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث', 'الجزء الرابع', 'الجزء الخامس', 'الجزء السادس'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const egp = (n) => `${Number(n).toLocaleString('ar-EG')} ج.م`;

function settings() {
  return {
    provider: process.env.RESEND_API_KEY ? 'resend' : process.env.BREVO_API_KEY ? 'brevo' : 'none',
    fromEmail: process.env.MAIL_FROM_EMAIL || '',
    fromName: process.env.MAIL_FROM_NAME || 'إسراءيل',
    replyTo: process.env.MAIL_REPLY_TO || '',
    whatsapp: process.env.CONTACT_WHATSAPP || '',
    maxDownloads: parseInt(process.env.MAX_DOWNLOADS_PER_BOOK || '3', 10),
  };
}

const enabled = () => {
  const s = settings();
  return s.provider !== 'none' && !!s.fromEmail;
};

// ---------- content ----------
const FONT = "'Cairo','Segoe UI',Tahoma,Arial,sans-serif";

function buildOrderEmail(order, { baseUrl, catalog }) {
  const s = settings();
  const link = `${baseUrl}/order.html?id=${order.id}&t=${order.token}`;
  const firstName = String(order.customer.name || '').trim().split(/\s+/)[0] || '';
  const books = order.bookIds.map((id) => {
    const i = catalog.books.findIndex((b) => b.id === id);
    const b = catalog.books[i] || { title: id };
    const cover = b.cover ? `${baseUrl}${b.cover.replace(/\.webp$/, '-email.jpg')}` : '';
    return { title: b.title, subtitle: b.subtitle || '', part: PARTS[i] || '', cover };
  });
  const paid = order.total === 0 ? 'مجانًا' : egp(order.total);
  const waDigits = s.whatsapp.replace(/[^\d]/g, '');

  const subject = order.total === 0 ? 'هديتك جاهزة للتحميل · إسراءيل' : 'كتبك جاهزة للتحميل · إسراءيل';

  const bookRows = books.map((b) => `
              <tr>
                <td width="64" valign="top" style="padding:10px 0 10px 14px;">
                  ${b.cover ? `<img src="${esc(b.cover)}" width="56" height="79" alt="" style="display:block;width:56px;height:79px;border:0;">` : ''}
                </td>
                <td valign="middle" style="padding:10px 0;font-family:${FONT};text-align:right;">
                  ${b.part ? `<span style="display:inline-block;background:#FFD200;color:#000;font-size:12px;font-weight:700;padding:1px 8px;border-bottom:2px solid #000;">${esc(b.part)}</span><br>` : ''}
                  <span style="display:block;font-size:16px;font-weight:700;color:#000;margin-top:4px;">${esc(b.title)}</span>
                  <span style="display:block;font-size:13px;color:#5B6468;">${esc(b.subtitle)} · نسخة PDF</span>
                </td>
              </tr>`).join(`
              <tr><td colspan="2" style="border-top:1px solid #E3E5E2;font-size:0;line-height:0;">&nbsp;</td></tr>`);

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F1EC;" dir="rtl">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">تم تأكيد طلبك. اضغط على الزر لتحميل كتبك بصيغة PDF.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F1EC;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:600px;background:#FFFFFF;border-top:6px solid #FFD200;">

        <!-- header -->
        <tr><td style="background:#000000;padding:28px 28px 24px;text-align:right;font-family:${FONT};">
          <span style="display:inline-block;background:#FFD200;color:#000;font-size:12px;font-weight:700;padding:2px 10px;">${order.total === 0 ? 'هدية' : 'تم تأكيد الدفع'}</span>
          <div style="font-size:40px;line-height:1.3;font-weight:900;color:#FFFFFF;margin-top:8px;">إسراءيل</div>
          <div style="font-size:14px;color:#9FACB4;">رحلةٌ بين القرآن والعقل والتاريخ</div>
        </td></tr>

        <!-- greeting -->
        <tr><td style="padding:28px 28px 8px;text-align:right;font-family:${FONT};color:#1A1A1A;">
          <div style="font-size:20px;font-weight:700;color:#000;">مرحبًا ${esc(firstName)}،</div>
          <div style="font-size:15px;line-height:1.9;margin-top:6px;">
            ${order.total === 0 ? 'وصلتك هديتك، و' : 'شكرًا لشرائك. تم تأكيد الدفع، و'}${books.length > 1 ? 'كتبك جاهزة للتحميل الآن.' : 'كتابك جاهز للتحميل الآن.'}
          </div>
        </td></tr>

        <!-- books -->
        <tr><td style="padding:8px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">${bookRows}
          </table>
        </td></tr>

        <!-- button -->
        <tr><td align="center" style="padding:18px 28px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#FFD200;border:2px solid #000000;box-shadow:3px 3px 0 #000;">
              <a href="${esc(link)}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:18px;font-weight:700;color:#000000;text-decoration:none;">حمّل ${books.length > 1 ? 'كتبك' : 'كتابك'} الآن</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:8px 28px 0;text-align:center;font-family:${FONT};font-size:12px;color:#5B6468;">
          إذا لم يعمل الزر، انسخ هذا الرابط في المتصفح:<br>
          <a href="${esc(link)}" style="color:#1A1A1A;word-break:break-all;direction:ltr;unicode-bidi:embed;">${esc(link)}</a>
        </td></tr>

        <!-- notes -->
        <tr><td style="padding:22px 28px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:#FFF9E6;border-right:5px solid #FFD200;">
            <tr><td style="padding:12px 16px;font-family:${FONT};font-size:14px;line-height:1.9;color:#1A1A1A;text-align:right;">
              <strong style="color:#000;">احتفظ بهذه الرسالة.</strong> الرابط خاص بك، ويمكنك العودة إليه في أي وقت.<br>
              • يمكنك تحميل كل كتاب حتى ${s.maxDownloads.toLocaleString('ar-EG')} مرات.<br>
              • كل نسخة مطبوع عليها اسمك وبريدك الإلكتروني، فلا تشاركها مع غيرك.<br>
              • الكتب نسخ إلكترونية PDF، وليست نسخًا ورقية مطبوعة.
            </td></tr>
          </table>
        </td></tr>

        <!-- order summary -->
        <tr><td style="padding:16px 28px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="font-family:${FONT};font-size:14px;color:#1A1A1A;">
            <tr><td style="padding:4px 0;color:#5B6468;text-align:right;">رقم الطلب</td><td style="padding:4px 0;text-align:left;direction:ltr;font-family:Arial,sans-serif;">${esc(order.id)}</td></tr>
            ${order.discount ? `<tr><td style="padding:4px 0;color:#E46C0A;text-align:right;">خصم${order.promoCode ? ` (${esc(order.promoCode)})` : ''}</td><td style="padding:4px 0;text-align:left;color:#E46C0A;">− ${egp(order.discount)}</td></tr>` : ''}
            <tr><td style="padding:8px 0 0;border-top:2px solid #000;font-size:16px;font-weight:700;color:#000;text-align:right;">المدفوع</td><td style="padding:8px 0 0;border-top:2px solid #000;font-size:16px;font-weight:700;color:#000;text-align:left;">${paid}</td></tr>
          </table>
        </td></tr>

        <!-- contact -->
        <tr><td style="background:#2E383A;border-top:4px solid #FFD200;padding:20px 28px;text-align:right;font-family:${FONT};color:#FFFFFF;">
          <div style="font-size:16px;font-weight:700;">للتواصل مع الكاتب</div>
          <div style="font-size:13px;color:#9FACB4;margin:2px 0 10px;">لأي استفسار أو مشكلة في التحميل، ردّ على هذه الرسالة${waDigits ? ' أو راسلنا على واتساب' : ''}.</div>
          ${waDigits ? `<a href="https://wa.me/${waDigits}" style="display:inline-block;background:#FFD200;color:#000;font-weight:700;font-size:14px;padding:8px 16px;text-decoration:none;border:2px solid #000;">راسلنا على واتساب</a>` : ''}
        </td></tr>
        <tr><td style="background:#2E383A;border-top:1px solid #46525A;padding:14px 28px;text-align:center;font-family:${FONT};font-size:12px;color:#9FACB4;">
          م. محمد عسكر · جميع الحقوق محفوظة · يُمنع إعادة نشر الكتب أو توزيعها
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `مرحبًا ${firstName}،`,
    '',
    order.total === 0 ? 'وصلتك نسختك المهداة، وهي جاهزة للتحميل.' : 'شكرًا لشرائك. تم تأكيد الدفع، وكتبك جاهزة للتحميل.',
    '',
    ...books.map((b) => `- ${b.title} (${b.subtitle}) · PDF`),
    '',
    'رابط التحميل الخاص بك:',
    link,
    '',
    `يمكنك تحميل كل كتاب حتى ${s.maxDownloads} مرات. كل نسخة مطبوع عليها اسمك وبريدك، فلا تشاركها.`,
    '',
    `رقم الطلب: ${order.id}`,
    `المدفوع: ${paid}`,
    '',
    `للتواصل: ردّ على هذه الرسالة${waDigits ? ` أو راسلنا على واتساب: https://wa.me/${waDigits}` : ''}.`,
    'م. محمد عسكر',
  ].join('\n');

  return { subject, html, text, link };
}

// ---------- sending ----------
async function send({ to, toName, subject, html, text }) {
  const s = settings();
  if (s.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${s.fromName} <${s.fromEmail}>`, to: [to], subject, html, text,
        ...(s.replyTo ? { reply_to: s.replyTo } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data.id || 'sent';
  }
  if (s.provider === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: s.fromName, email: s.fromEmail }, to: [{ email: to, name: toName || undefined }],
        subject, htmlContent: html, textContent: text,
        ...(s.replyTo ? { replyTo: { email: s.replyTo } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data.messageId || 'sent';
  }
  throw new Error('No email service configured (RESEND_API_KEY or BREVO_API_KEY, plus MAIL_FROM_EMAIL)');
}

async function sendOrderEmail(order, ctx) {
  const mail = buildOrderEmail(order, ctx);
  return send({ to: order.customer.email, toName: order.customer.name, ...mail });
}

module.exports = { buildOrderEmail, sendOrderEmail, enabled, settings };
