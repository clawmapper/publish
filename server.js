'use strict';

const express      = require('express');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const rateLimit    = require('express-rate-limit');

const db                   = require('./db');
const { validateAllowed, emailMatchesAllowed, inferEmailMode } = require('./validate');
const { sendMagicLink }    = require('./email');
const {
  renderPasswordForm, renderEmailForm, renderEmailSent,
  renderNoResend, renderMagicLinkExpired, render404, renderSendFailed,
} = require('./templates');

// ─── SQLite session store ────────────────────────────────────────────────────

class SQLiteStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
  }

  get(sid, cb) {
    try {
      const row = this.db
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?')
        .get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.db
        .prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?,?,?)')
        .run(sid, JSON.stringify(sess), expires);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  store: new SQLiteStore(db),
  secret: process.env.SESSION_SECRET || 'dev-secret-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseUrl() {
  return (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function generateSlug() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

function uniqueSlug() {
  let slug;
  do {
    slug = generateSlug();
  } while (db.prepare('SELECT 1 FROM pages WHERE slug = ?').get(slug));
  return slug;
}

const VALID_MODES = ['public', 'password', 'email_domain', 'email_list'];

// ─── Middleware ───────────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing API key (Authorization: Bearer <key>)' });
  }
  const key = auth.slice(7).trim();
  const row = db.prepare('SELECT id, name FROM api_keys WHERE key = ?').get(key);
  if (!row) return res.status(401).json({ error: 'Invalid API key' });
  req.apiKeyRow = row;
  next();
}

function requireMasterKey(req, res, next) {
  const masterKey = process.env.API_MASTER_KEY;
  if (!masterKey) {
    return res.status(500).json({ error: 'API_MASTER_KEY is not configured on this server' });
  }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing master key (Authorization: Bearer <key>)' });
  }
  if (auth.slice(7).trim() !== masterKey) {
    return res.status(401).json({ error: 'Invalid master key' });
  }
  next();
}

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please wait a minute.' },
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ─── API: keys ────────────────────────────────────────────────────────────────

app.post('/api/keys', requireMasterKey, (req, res) => {
  const { name } = req.body || {};
  const id  = crypto.randomUUID();
  const key = 'pub_live_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO api_keys (id, key, name, created_at) VALUES (?,?,?,?)')
    .run(id, key, name || null, new Date().toISOString());
  res.status(201).json({ id, key, name: name || null });
});

app.get('/api/keys', requireMasterKey, (_req, res) => {
  const rows = db.prepare('SELECT id, name, created_at FROM api_keys ORDER BY created_at DESC').all();
  res.json(rows);
});

app.delete('/api/keys/:id', requireMasterKey, (req, res) => {
  const r = db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

// ─── API: pages ───────────────────────────────────────────────────────────────

// Build a safe page response object (no html, no password_hash)
function pageResponse(row) {
  return {
    slug:       row.slug,
    title:      row.title,
    auth_mode:  row.auth_mode,
    allowed:    row.allowed || null,
    url:        `${baseUrl()}/${row.slug}`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Shared validation helper used by both POST and PUT
async function buildPageFields(body, existing) {
  const errors = [];
  const fields = {};

  // html
  const html = body.html !== undefined ? body.html : (existing?.html ?? null);
  if (!html) errors.push('html is required');
  else fields.html = html;

  // title (optional)
  fields.title = body.title !== undefined ? (body.title || null) : (existing?.title ?? null);

  // auth_mode
  const auth_mode = body.auth_mode !== undefined ? body.auth_mode : (existing?.auth_mode ?? 'public');
  if (!VALID_MODES.includes(auth_mode)) {
    errors.push(`auth_mode must be one of: ${VALID_MODES.join(', ')}`);
  }
  fields.auth_mode = auth_mode;

  // password
  if (auth_mode === 'password') {
    if (body.password) {
      fields.password_hash = await bcrypt.hash(body.password, 10);
    } else if (existing?.password_hash) {
      fields.password_hash = existing.password_hash; // keep existing
    } else {
      errors.push('password is required when auth_mode is "password"');
    }
  } else {
    fields.password_hash = null;
  }

  // allowed
  if (auth_mode === 'email_domain' || auth_mode === 'email_list') {
    const rawAllowed = body.allowed !== undefined ? body.allowed : existing?.allowed;
    if (!rawAllowed) {
      errors.push('allowed is required when auth_mode is "email_domain" or "email_list"');
    } else {
      const v = validateAllowed(rawAllowed);
      if (!v.ok) errors.push(v.error);
      else fields.allowed = v.normalized;
    }
  } else {
    // If switching away from email mode and caller supplied allowed, still validate it
    if (body.allowed !== undefined && body.allowed !== null && body.allowed !== '') {
      const v = validateAllowed(body.allowed);
      if (!v.ok) errors.push(v.error);
      else fields.allowed = v.normalized;
    } else {
      fields.allowed = null;
    }
  }

  return { errors, fields };
}

// POST /api/pages — create
app.post('/api/pages', requireApiKey, async (req, res) => {
  const { errors, fields } = await buildPageFields(req.body, null);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const slug = uniqueSlug();
  const now  = new Date().toISOString();

  db.prepare(`
    INSERT INTO pages (slug, title, html, auth_mode, password_hash, allowed, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(slug, fields.title, fields.html, fields.auth_mode, fields.password_hash, fields.allowed, now, now);

  const row = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
  res.status(201).json(pageResponse(row));
});

// GET /api/pages — list
app.get('/api/pages', requireApiKey, (_req, res) => {
  const rows = db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all();
  res.json(rows.map(pageResponse));
});

// GET /api/pages/:slug — get one
app.get('/api/pages/:slug', requireApiKey, (req, res) => {
  const row = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Page not found' });
  res.json(pageResponse(row));
});

// PUT /api/pages/:slug — update
app.put('/api/pages/:slug', requireApiKey, async (req, res) => {
  const existing = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!existing) return res.status(404).json({ error: 'Page not found' });

  const { errors, fields } = await buildPageFields(req.body, existing);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pages SET title=?, html=?, auth_mode=?, password_hash=?, allowed=?, updated_at=?
    WHERE slug=?
  `).run(fields.title, fields.html, fields.auth_mode, fields.password_hash, fields.allowed, now, req.params.slug);

  const row = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  res.json(pageResponse(row));
});

// DELETE /api/pages/:slug
app.delete('/api/pages/:slug', requireApiKey, (req, res) => {
  const r = db.prepare('DELETE FROM pages WHERE slug = ?').run(req.params.slug);
  if (r.changes === 0) return res.status(404).json({ error: 'Page not found' });
  // Clean up magic links for this slug
  db.prepare('DELETE FROM magic_links WHERE slug = ?').run(req.params.slug);
  res.json({ ok: true });
});

// ─── Public page serving ──────────────────────────────────────────────────────

// Check if the current session grants access to a slug
function sessionHasAccess(req, slug) {
  return req.session.access?.[slug] === true;
}

// Grant session access to a slug
function grantAccess(req, slug) {
  req.session.access = { ...(req.session.access || {}), [slug]: true };
}

// GET /:slug — view page
app.get('/:slug', (req, res) => {
  const { slug } = req.params;
  // Avoid matching /health etc already handled above; also block /api/* just in case
  if (slug.startsWith('api')) return res.status(404).send(render404());

  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
  if (!page) return res.status(404).send(render404());

  if (page.auth_mode === 'public' || sessionHasAccess(req, slug)) {
    return res.send(page.html);
  }

  const err = req.query.error || null;
  if (page.auth_mode === 'password') {
    return res.send(renderPasswordForm(slug, page.title, err));
  }
  // email_domain or email_list
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
    return res.status(503).send(renderNoResend(slug, page.title));
  }
  return res.send(renderEmailForm(slug, page.title, err));
});

// POST /:slug/auth — handle password or email submission
app.post('/:slug/auth', authLimiter, async (req, res) => {
  const { slug } = req.params;
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
  if (!page) return res.status(404).send(render404());

  const { type, password, email } = req.body || {};

  // ── Password auth ──
  if (type === 'password' && page.auth_mode === 'password') {
    const ok = page.password_hash && await bcrypt.compare(password || '', page.password_hash);
    if (!ok) return res.redirect(`/${slug}?error=wrong_password`);
    grantAccess(req, slug);
    return res.redirect(`/${slug}`);
  }

  // ── Email auth ──
  if (type === 'email' && (page.auth_mode === 'email_domain' || page.auth_mode === 'email_list')) {
    // Check Resend config first — fail loudly
    if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
      return res.status(503).send(renderNoResend(slug, page.title));
    }

    const emailLower = (email || '').toLowerCase().trim();
    if (!emailLower || !emailLower.includes('@')) {
      return res.redirect(`/${slug}?error=invalid_email`);
    }

    const allowedList = page.allowed ? page.allowed.split(',').map(s => s.trim()) : [];
    if (!emailMatchesAllowed(emailLower, allowedList)) {
      return res.redirect(`/${slug}?error=not_allowed`);
    }

    // Generate magic link
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 15 * 60 * 1000;
    db.prepare('INSERT INTO magic_links (token, slug, email, expires_at) VALUES (?,?,?,?)')
      .run(token, slug, emailLower, expires);

    const magicUrl = `${baseUrl()}/${slug}/verify?token=${token}`;
    const result   = await sendMagicLink(emailLower, page.title || slug, magicUrl);

    if (!result.ok) {
      // Clean up the token we just inserted
      db.prepare('DELETE FROM magic_links WHERE token = ?').run(token);
      return res.status(500).send(renderSendFailed(slug, page.title, result.error || 'Failed to send email'));
    }

    return res.send(renderEmailSent(emailLower, page.title || slug));
  }

  // Fallback
  res.redirect(`/${slug}`);
});

// GET /:slug/verify — magic link verification
app.get('/:slug/verify', (req, res) => {
  const { slug }  = req.params;
  const { token } = req.query;

  if (!token) return res.redirect(`/${slug}`);

  const link = db.prepare(
    'SELECT * FROM magic_links WHERE token = ? AND slug = ? AND used = 0'
  ).get(token, slug);

  if (!link || link.expires_at < Date.now()) {
    return res.send(renderMagicLinkExpired(slug));
  }

  db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').run(token);
  grantAccess(req, slug);
  res.redirect(`/${slug}`);
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`publish-service running on port ${PORT}`);
  if (!process.env.API_MASTER_KEY) console.warn('⚠  API_MASTER_KEY is not set');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-please-change') {
    console.warn('⚠  SESSION_SECRET is not set or is using the default');
  }
});

module.exports = app; // for testing
