'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'publish.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    slug        TEXT PRIMARY KEY,
    title       TEXT,
    html        TEXT NOT NULL,
    auth_mode   TEXT NOT NULL DEFAULT 'public',
    password_hash TEXT,
    allowed     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id         TEXT PRIMARY KEY,
    key        TEXT UNIQUE NOT NULL,
    name       TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    token      TEXT PRIMARY KEY,
    slug       TEXT NOT NULL,
    email      TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    sess       TEXT NOT NULL,
    expires    INTEGER NOT NULL
  );
`);

// Periodic cleanup of expired magic links and sessions
setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM magic_links WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
}, 5 * 60 * 1000);

module.exports = db;
