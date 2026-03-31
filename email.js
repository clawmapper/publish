'use strict';

const { Resend } = require('resend');

/**
 * Send a magic-link email via Resend.
 *
 * Returns:
 *   { ok: true }
 *   { ok: false, noKey: true }   — RESEND_API_KEY not set
 *   { ok: false, error: string } — send failed
 */
async function sendMagicLink(to, pageTitle, magicUrl) {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, noKey: true };
  }

  if (!process.env.FROM_EMAIL) {
    return { ok: false, error: 'FROM_EMAIL environment variable is not set' };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to,
      subject: `Your access link for "${pageTitle}"`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;color:#222">
          <h2 style="margin-bottom:8px">Access link</h2>
          <p style="color:#555;margin-bottom:24px">
            You requested access to <strong>${escHtml(pageTitle)}</strong>.
            Click the button below — the link expires in 15 minutes and can only be used once.
          </p>
          <a href="${escHtml(magicUrl)}"
             style="display:inline-block;background:#000;color:#fff;padding:12px 24px;
                    border-radius:6px;text-decoration:none;font-size:15px">
            Access page
          </a>
          <p style="margin-top:24px;font-size:12px;color:#999">
            If you didn't request this, you can safely ignore it.
          </p>
        </body>
        </html>
      `
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendMagicLink };
