'use strict';

// Matches full emails: user@domain.tld
const FULL_EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
// Matches domain wildcards: *@domain.tld
const WILDCARD_RE   = /^\*@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

/**
 * Validate and normalise a comma-separated allowed list.
 * Returns { ok: true, normalized: string } or { ok: false, error: string }
 */
function validateAllowed(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'allowed must be a non-empty string' };
  }

  const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    return { ok: false, error: 'allowed list is empty' };
  }

  for (const entry of entries) {
    if (!FULL_EMAIL_RE.test(entry) && !WILDCARD_RE.test(entry)) {
      return {
        ok: false,
        error: `Invalid entry "${entry}" — each entry must be a full email (user@domain.com) or a domain wildcard (*@domain.com)`
      };
    }
  }

  return { ok: true, normalized: entries.join(',') };
}

/**
 * Check whether an email address matches any entry in an allowed list.
 * Subdomains do NOT match: *@corp.com matches corp.com only.
 */
function emailMatchesAllowed(email, allowedList) {
  const lower = email.toLowerCase();
  const atIdx = lower.indexOf('@');
  if (atIdx === -1) return false;
  const domain = lower.slice(atIdx + 1);

  return allowedList.some(entry => {
    const e = entry.toLowerCase().trim();
    if (e.startsWith('*@')) {
      return domain === e.slice(2); // exact domain match, no subdomains
    }
    return lower === e;
  });
}

/**
 * Infer auth_mode from an allowed list string.
 * If every entry is a wildcard → email_domain, otherwise → email_list.
 */
function inferEmailMode(normalized) {
  const entries = normalized.split(',').map(s => s.trim());
  return entries.every(e => e.startsWith('*@')) ? 'email_domain' : 'email_list';
}

module.exports = { validateAllowed, emailMatchesAllowed, inferEmailMode };
