#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const fs          = require('fs');
const path        = require('path');
const os          = require('os');
const readline    = require('readline');
const crypto      = require('crypto');

const CONFIG_PATH = path.join(os.homedir(), '.publish.json');

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg.api_key || !cfg.base_url) {
    console.error('Not configured. Run: publish configure');
    process.exit(1);
  }
  return cfg;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiFetch(cfg, method, path, body) {
  const url = `${cfg.base_url.replace(/\/$/, '')}${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${cfg.api_key}`,
      'Content-Type':  'application/json',
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    console.error(`Network error: ${e.message}`);
    process.exit(1);
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    console.error(`Error ${res.status}: ${data.error || JSON.stringify(data)}`);
    process.exit(1);
  }
  return data;
}

// ─── Prompt helpers ──────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

function confirm(question) {
  return prompt(`${question} [y/N] `).then(a => /^y(es)?$/i.test(a));
}

// ─── Table printing ──────────────────────────────────────────────────────────

function printTable(rows, cols) {
  // cols: [{ key, header, width? }]
  const widths = cols.map(c => {
    const vals = rows.map(r => String(r[c.key] ?? ''));
    return Math.min(50, Math.max(c.header.length, ...vals.map(v => v.length)));
  });

  const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w);
  const sep = widths.map(w => '─'.repeat(w)).join('─┼─');

  console.log(cols.map((c, i) => pad(c.header, widths[i])).join(' │ '));
  console.log(sep);
  for (const row of rows) {
    console.log(cols.map((c, i) => pad(row[c.key] ?? '', widths[i])).join(' │ '));
  }
}

// ─── Open URL in browser ──────────────────────────────────────────────────────

function openUrl(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

program
  .name('publish')
  .description('Publish self-contained HTML pages via the publish-service API')
  .version('1.0.0');

// configure
program
  .command('configure')
  .description('Set the API base URL and key')
  .action(async () => {
    const cfg    = loadConfig();
    const rawUrl = await prompt(`Base URL [${cfg.base_url || 'https://your-service.railway.app'}]: `);
    const rawKey = await prompt(`API key  [${cfg.api_key ? cfg.api_key.slice(0, 16) + '…' : ''}]: `);
    const newCfg = {
      base_url: rawUrl || cfg.base_url || '',
      api_key:  rawKey || cfg.api_key  || '',
    };
    if (!newCfg.base_url || !newCfg.api_key) {
      console.error('Both base_url and api_key are required.');
      process.exit(1);
    }
    saveConfig(newCfg);
    console.log(`Saved to ${CONFIG_PATH}`);
  });

// upload
program
  .command('upload <file>')
  .description('Publish an HTML file')
  .option('--title <title>',    'Page title')
  .option('--public',           'No authentication')
  .option('--password <pw>',    'Protect with a shared password')
  .option('--allow <list>',     'Comma-separated emails / wildcards (*@corp.com)')
  .option('--slug <slug>',      'Update an existing page by slug')
  .action(async (file, opts) => {
    const cfg = requireConfig();

    let html;
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.error(`Cannot read file: ${e.message}`);
      process.exit(1);
    }

    // Build auth fields
    let auth_mode, password, allowed;

    if (opts.public) {
      auth_mode = 'public';
    } else if (opts.password) {
      auth_mode = 'password';
      password  = opts.password;
    } else if (opts.allow) {
      allowed   = opts.allow;
      // infer mode from list (purely cosmetic label)
      const entries = opts.allow.split(',').map(s => s.trim());
      auth_mode = entries.every(e => e.startsWith('*@')) ? 'email_domain' : 'email_list';
    }

    // Updating existing page
    if (opts.slug) {
      const body = { html };
      if (opts.title)    body.title    = opts.title;
      if (auth_mode)     body.auth_mode = auth_mode;
      if (password)      body.password  = password;
      if (allowed)       body.allowed   = allowed;
      const data = await apiFetch(cfg, 'PUT', `/api/pages/${opts.slug}`, body);
      console.log(data.url);
      return;
    }

    // Creating new page — prompt for auth if no flag given
    if (!auth_mode) {
      const choice = await prompt('How should this be protected? [public / password / email]: ');
      const c = choice.toLowerCase().trim();
      if (c === 'public') {
        auth_mode = 'public';
      } else if (c === 'password') {
        const pw = await prompt('Password: ');
        if (!pw) { console.error('Password cannot be empty'); process.exit(1); }
        auth_mode = 'password';
        password  = pw;
      } else if (c === 'email') {
        const list = await prompt('Allowed emails / wildcards (comma-separated): ');
        if (!list) { console.error('Allowed list cannot be empty'); process.exit(1); }
        allowed   = list;
        const entries = list.split(',').map(s => s.trim());
        auth_mode = entries.every(e => e.startsWith('*@')) ? 'email_domain' : 'email_list';
      } else {
        console.error('Invalid choice. Use: public, password, or email');
        process.exit(1);
      }
    }

    const body = { html, auth_mode };
    if (opts.title) body.title    = opts.title;
    if (password)   body.password = password;
    if (allowed)    body.allowed  = allowed;

    const data = await apiFetch(cfg, 'POST', '/api/pages', body);
    console.log(data.url);
  });

// list
program
  .command('list')
  .description('List all published pages')
  .action(async () => {
    const cfg  = requireConfig();
    const rows = await apiFetch(cfg, 'GET', '/api/pages');
    if (!rows.length) { console.log('No pages yet.'); return; }
    printTable(rows, [
      { key: 'slug',       header: 'Slug' },
      { key: 'title',      header: 'Title' },
      { key: 'auth_mode',  header: 'Auth' },
      { key: 'url',        header: 'URL' },
      { key: 'updated_at', header: 'Updated' },
    ]);
  });

// delete
program
  .command('delete <slug>')
  .description('Delete a page')
  .action(async (slug) => {
    const cfg = requireConfig();
    const ok  = await confirm(`Delete "${slug}"? This cannot be undone.`);
    if (!ok) { console.log('Aborted.'); return; }
    await apiFetch(cfg, 'DELETE', `/api/pages/${slug}`);
    console.log(`Deleted ${slug}`);
  });

// open
program
  .command('open <slug>')
  .description('Open a page URL in the default browser')
  .action(async (slug) => {
    const cfg  = requireConfig();
    const data = await apiFetch(cfg, 'GET', `/api/pages/${slug}`);
    openUrl(data.url);
    console.log(data.url);
  });

// auth
program
  .command('auth <slug>')
  .description('Show or modify auth settings for a page')
  .option('--add <entry>',      'Add an email/wildcard to the allowed list')
  .option('--remove <entry>',   'Remove an email/wildcard from the allowed list')
  .option('--set <list>',       'Replace the allowed list entirely')
  .option('--password <pw>',    'Set a new password')
  .option('--public',           'Remove all auth (make page public)')
  .action(async (slug, opts) => {
    const cfg = requireConfig();

    // Fetch current state
    const current = await apiFetch(cfg, 'GET', `/api/pages/${slug}`);

    // No flags → just display
    const hasFlag = opts.add || opts.remove || opts.set || opts.password || opts.public;
    if (!hasFlag) {
      console.log(`Slug:      ${current.slug}`);
      console.log(`Auth mode: ${current.auth_mode}`);
      if (current.allowed) console.log(`Allowed:   ${current.allowed}`);
      return;
    }

    const body = {};

    if (opts.public) {
      body.auth_mode = 'public';
      body.allowed   = null;
    } else if (opts.password) {
      body.auth_mode = 'password';
      body.password  = opts.password;
    } else if (opts.set) {
      const entries = opts.set.split(',').map(s => s.trim());
      body.auth_mode = entries.every(e => e.startsWith('*@')) ? 'email_domain' : 'email_list';
      body.allowed   = opts.set;
    } else if (opts.add || opts.remove) {
      const existing = current.allowed ? current.allowed.split(',').map(s => s.trim()) : [];

      let entries = [...existing];
      if (opts.add) {
        const toAdd = opts.add.split(',').map(s => s.trim());
        for (const e of toAdd) {
          if (!entries.includes(e)) entries.push(e);
        }
      }
      if (opts.remove) {
        const toRemove = opts.remove.split(',').map(s => s.trim()).map(e => e.toLowerCase());
        entries = entries.filter(e => !toRemove.includes(e.toLowerCase()));
      }

      if (entries.length === 0) {
        console.error('Allowed list would become empty. Use --public to remove auth.');
        process.exit(1);
      }

      body.allowed   = entries.join(',');
      body.auth_mode = entries.every(e => e.startsWith('*@')) ? 'email_domain' : 'email_list';
    }

    const updated = await apiFetch(cfg, 'PUT', `/api/pages/${slug}`, body);
    console.log(`Updated ${slug}`);
    console.log(`Auth mode: ${updated.auth_mode}`);
    if (updated.allowed) console.log(`Allowed:   ${updated.allowed}`);
  });

program.parse();
