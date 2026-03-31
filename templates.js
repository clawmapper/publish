'use strict';

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BASE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:10px;box-shadow:0 2px 16px rgba(0,0,0,.08);
        padding:2rem;width:100%;max-width:400px}
  h1{font-size:1.2rem;font-weight:600;margin-bottom:.4rem;color:#111}
  .sub{color:#666;font-size:.875rem;margin-bottom:1.5rem;line-height:1.5}
  label{display:block;font-size:.8rem;font-weight:500;color:#444;margin-bottom:.3rem}
  input{width:100%;padding:.6rem .75rem;border:1px solid #d1d5db;border-radius:6px;
        font-size:1rem;outline:none;transition:border-color .15s}
  input:focus{border-color:#000}
  button{width:100%;margin-top:1rem;padding:.65rem;background:#000;color:#fff;
         border:none;border-radius:6px;font-size:.95rem;font-weight:500;cursor:pointer}
  button:hover{background:#222}
  .alert{padding:.6rem .75rem;border-radius:6px;font-size:.85rem;margin-bottom:1rem}
  .alert-err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
  .alert-ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
  .alert-warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
`;

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>${BASE_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

const ERROR_MESSAGES = {
  wrong_password: 'Incorrect password. Please try again.',
  invalid_email:  'Please enter a valid email address.',
  not_allowed:    'That email address is not on the access list.',
  send_failed:    'Failed to send the access email. Please try again later.',
  no_resend:      'Email access is not available — the server is not configured for sending email. Contact the page owner.',
};

function renderPasswordForm(slug, pageTitle, errorCode) {
  const err = errorCode ? `<div class="alert alert-err">${escHtml(ERROR_MESSAGES[errorCode] ?? errorCode)}</div>` : '';
  return page('Access required', `
  <div class="card">
    <h1>Access required</h1>
    <p class="sub">Enter the password to view <em>${escHtml(pageTitle || slug)}</em>.</p>
    ${err}
    <form method="POST" action="/${escHtml(slug)}/auth">
      <input type="hidden" name="type" value="password">
      <label for="pw">Password</label>
      <input type="password" id="pw" name="password" autofocus required placeholder="••••••••">
      <button type="submit">Continue</button>
    </form>
  </div>`);
}

function renderEmailForm(slug, pageTitle, errorCode) {
  const err = errorCode ? `<div class="alert alert-err">${escHtml(ERROR_MESSAGES[errorCode] ?? errorCode)}</div>` : '';
  return page('Access required', `
  <div class="card">
    <h1>Access required</h1>
    <p class="sub">Enter your email address to request access to <em>${escHtml(pageTitle || slug)}</em>.
      If your address is on the access list, you'll receive a one-time link.</p>
    ${err}
    <form method="POST" action="/${escHtml(slug)}/auth">
      <input type="hidden" name="type" value="email">
      <label for="em">Email address</label>
      <input type="email" id="em" name="email" autofocus required placeholder="you@example.com">
      <button type="submit">Send access link</button>
    </form>
  </div>`);
}

function renderEmailSent(email, pageTitle) {
  return page('Check your email', `
  <div class="card">
    <h1>Check your email</h1>
    <p class="sub">
      We sent an access link to <strong>${escHtml(email)}</strong> for
      <em>${escHtml(pageTitle)}</em>.<br><br>
      The link expires in 15 minutes and can only be used once.
    </p>
    <div class="alert alert-ok" style="margin-top:1rem">Link sent — check your inbox (and spam folder).</div>
  </div>`);
}

function renderNoResend(slug, pageTitle) {
  return page('Email not configured', `
  <div class="card">
    <h1>Email access unavailable</h1>
    <p class="sub">
      <em>${escHtml(pageTitle || slug)}</em> requires email verification,
      but this server is not configured to send email.
    </p>
    <div class="alert alert-warn">
      <strong>Server misconfiguration:</strong> RESEND_API_KEY and FROM_EMAIL are not set.
      The page owner needs to configure email sending before access can be granted.
    </div>
  </div>`);
}

function renderMagicLinkExpired(slug) {
  return page('Link expired', `
  <div class="card">
    <h1>Link expired or already used</h1>
    <p class="sub">This access link is no longer valid — it may have expired (15 min) or already been used.</p>
    <a href="/${escHtml(slug)}" style="display:block;margin-top:1rem;text-align:center;
       padding:.65rem;background:#000;color:#fff;border-radius:6px;text-decoration:none;font-size:.95rem">
      Request a new link
    </a>
  </div>`);
}

function render404() {
  return page('Not found', `
  <div class="card">
    <h1>Page not found</h1>
    <p class="sub">This page doesn't exist or has been deleted.</p>
  </div>`);
}

function renderSendFailed(slug, pageTitle, errMsg) {
  return page('Could not send email', `
  <div class="card">
    <h1>Could not send email</h1>
    <p class="sub">We were unable to send an access link to your address for
      <em>${escHtml(pageTitle || slug)}</em>.</p>
    <div class="alert alert-err">
      <strong>Error:</strong> ${escHtml(errMsg || 'Unknown error')}
    </div>
    <a href="/${escHtml(slug)}" style="display:block;margin-top:1rem;text-align:center;
       padding:.65rem;background:#000;color:#fff;border-radius:6px;text-decoration:none;font-size:.95rem">
      Try again
    </a>
  </div>`);
}

module.exports = {
  renderPasswordForm,
  renderEmailForm,
  renderEmailSent,
  renderNoResend,
  renderMagicLinkExpired,
  render404,
  renderSendFailed,
};
