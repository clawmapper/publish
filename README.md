# publish-service

A self-hosted HTTP service for publishing self-contained HTML pages. Designed for use by AI agents and CLI tools that need to share rendered output — reports, dashboards, documents — with controlled access.

Pages are stored in SQLite. Authentication supports public access, shared passwords, or email-based magic links (via Resend). Sessions persist across server restarts.

---

## Self-contained HTML requirement

Each page must be a **single, fully self-contained HTML file**. All CSS, JavaScript, fonts, and images must either be:

- **Inlined** directly in the HTML (as `<style>` blocks, `<script>` blocks, or `data:` URIs), or
- **Hosted at a publicly accessible URL** with no authentication required (e.g. a CDN, public S3 bucket, or public image host).

**Private GitHub raw URLs will not work for unauthenticated viewers.** GitHub raw URLs for files in private repositories require authentication (cookies or tokens). When a viewer loads your page, their browser fetches those URLs without any credentials — GitHub returns a 404 or redirect to a login page, and the resource fails to load. If you need to include images or assets from a private repository, embed them as base64 `data:` URIs instead.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port the HTTP server listens on |
| `DATABASE_PATH` | No | `./publish.db` | Path to the SQLite database file |
| `API_MASTER_KEY` | Yes (production) | — | Secret key for managing API keys via `POST /api/keys`. Without this, key management endpoints return 500. |
| `SESSION_SECRET` | Yes (production) | `dev-secret-please-change` | Secret used to sign session cookies. Use a long random string in production. |
| `BASE_URL` | Yes (production) | `http://localhost:PORT` | Public base URL of the service, used to construct page URLs and magic links. No trailing slash. |
| `RESEND_API_KEY` | Required for email auth | — | API key from [resend.com](https://resend.com). Required when any page uses `email_domain` or `email_list` auth. |
| `FROM_EMAIL` | Required when RESEND_API_KEY is set | — | The `From` address for magic link emails. Must be a verified sender address in your Resend account. |

---

## Railway deploy

1. Fork or clone this repository and push to GitHub.
2. Create a new Railway project and connect your GitHub repo.
3. Railway will detect the `Dockerfile` and build automatically.
4. Set environment variables in the Railway dashboard:
   - `API_MASTER_KEY` — generate with `openssl rand -hex 32`
   - `SESSION_SECRET` — generate with `openssl rand -hex 32`
   - `BASE_URL` — set to your Railway public domain, e.g. `https://publish-service-production.up.railway.app`
   - `RESEND_API_KEY` and `FROM_EMAIL` if you want email auth
5. Add a volume mount at `/app` (or set `DATABASE_PATH` to a persistent volume path) so the SQLite database survives redeployments.
6. Deploy. The `/health` endpoint will return `{"ok":true}` when the service is running.

---

## Bootstrap: create your first API key

API keys are created using the master key. The master key is only ever used server-side (never in the CLI config).

```bash
curl -X POST https://your-service.railway.app/api/keys \
  -H "Authorization: Bearer YOUR_API_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Response:
```json
{
  "id": "uuid",
  "key": "pub_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "name": "my-agent"
}
```

Save the `key` — it is only shown once.

---

## API reference

All API endpoints (except `/health`) require `Authorization: Bearer <api_key>` or `Authorization: Bearer <master_key>` as noted.

### Health

#### `GET /health`

No authentication required.

**Response:**
```json
{ "ok": true, "ts": "2024-01-01T00:00:00.000Z" }
```

---

### Key management (master key required)

#### `POST /api/keys`

Create a new API key.

**Request body:**
```json
{ "name": "optional-label" }
```

**Response `201`:**
```json
{
  "id": "uuid",
  "key": "pub_live_...",
  "name": "optional-label"
}
```

#### `GET /api/keys`

List all API keys (key values are not returned, only metadata).

**Response `200`:**
```json
[
  { "id": "uuid", "name": "my-agent", "created_at": "2024-01-01T00:00:00.000Z" }
]
```

#### `DELETE /api/keys/:id`

Delete an API key by its UUID.

**Response `200`:**
```json
{ "ok": true }
```

---

### Pages (API key required)

#### `POST /api/pages`

Create a new page. The slug is auto-generated (8-character base64url).

**Request body:**
```json
{
  "html": "<!DOCTYPE html>...",
  "title": "My Report",
  "auth_mode": "public",
  "password": "secret123",
  "allowed": "alice@example.com,*@corp.com"
}
```

| Field | Required | Description |
|---|---|---|
| `html` | Yes | Full HTML string for the page |
| `title` | No | Human-readable title shown in auth forms |
| `auth_mode` | No (default: `public`) | One of: `public`, `password`, `email_domain`, `email_list` |
| `password` | Required when `auth_mode` is `password` | Plaintext password (hashed before storage) |
| `allowed` | Required when `auth_mode` is `email_domain` or `email_list` | Comma-separated list of full emails (`user@domain.com`) and/or domain wildcards (`*@domain.com`) |

**Response `201`:**
```json
{
  "slug": "aB3xY7qZ",
  "title": "My Report",
  "auth_mode": "public",
  "allowed": null,
  "url": "https://your-service.railway.app/aB3xY7qZ",
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

Note: `html` and `password_hash` are never returned in API responses.

#### `GET /api/pages`

List all pages ordered by most recently updated.

**Response `200`:** Array of page objects (same shape as create response).

#### `GET /api/pages/:slug`

Get metadata for a single page.

**Response `200`:** Page object. **`404`** if not found.

#### `PUT /api/pages/:slug`

Update an existing page. All fields are optional — omitted fields retain their current values. To change the password on a password-protected page, supply a new `password` field; omitting it keeps the existing hash.

**Request body:** Same fields as `POST /api/pages`, all optional.

**Response `200`:** Updated page object.

#### `DELETE /api/pages/:slug`

Delete a page and all associated magic links.

**Response `200`:**
```json
{ "ok": true }
```

---

### Error responses

All error responses have the shape:
```json
{ "error": "Human-readable message" }
```

Common status codes: `400` (validation), `401` (missing/invalid auth), `404` (not found), `500` (server error).

---

## CLI install and usage

### Install

```bash
# From the project directory
npm install
npm link   # makes `publish` available globally

# Or run directly
node cli.js <command>
```

### Configure

Run once to save your server URL and API key to `~/.publish.json` (mode 600):

```bash
publish configure
# Base URL: https://your-service.railway.app
# API key:  pub_live_xxxx...
```

### Commands

#### `publish upload <file>`

Publish an HTML file. Prints the URL on success.

```bash
# Public page
publish upload report.html --public --title "Q4 Report"

# Password protected
publish upload report.html --password "hunter2" --title "Internal Report"

# Email list restricted
publish upload report.html --allow "alice@example.com,bob@example.com"

# Domain-wide access (all addresses @corp.com)
publish upload report.html --allow "*@corp.com"

# Mixed: specific addresses and a domain wildcard
publish upload report.html --allow "contractor@gmail.com,*@corp.com"

# Update an existing page by slug
publish upload report-v2.html --slug aB3xY7qZ

# Interactive (no flags): prompts for auth choice
publish upload report.html
```

**Options:**

| Flag | Description |
|---|---|
| `--title <title>` | Set the page title |
| `--public` | No authentication |
| `--password <pw>` | Protect with a shared password |
| `--allow <list>` | Comma-separated email addresses and/or `*@domain.com` wildcards |
| `--slug <slug>` | Update an existing page instead of creating a new one |

#### `publish list`

List all published pages in a table.

```bash
publish list
```

#### `publish delete <slug>`

Delete a page (prompts for confirmation).

```bash
publish delete aB3xY7qZ
```

#### `publish open <slug>`

Open a page in the default browser.

```bash
publish open aB3xY7qZ
```

#### `publish auth <slug>`

Show or modify auth settings for a page.

```bash
# Show current auth settings
publish auth aB3xY7qZ

# Make public
publish auth aB3xY7qZ --public

# Change password
publish auth aB3xY7qZ --password "newpassword"

# Replace the allowed list entirely
publish auth aB3xY7qZ --set "alice@example.com,*@corp.com"

# Add entries to the allowed list
publish auth aB3xY7qZ --add "newperson@example.com"

# Remove entries from the allowed list
publish auth aB3xY7qZ --remove "alice@example.com"
```

---

## Auth modes explained

### `public`

No authentication. Anyone with the URL can view the page.

### `password`

Visitors are shown a password form. On correct submission, a session cookie is set granting access for 7 days. The password is stored as a bcrypt hash.

### `email_domain` and `email_list`

Visitors enter their email address. The service checks whether it matches the allowed list:

- **`email_domain`**: The `allowed` field contains only domain wildcards (e.g. `*@corp.com`). Any address at that exact domain matches. Subdomains do not match: `*@corp.com` will not grant access to `user@sub.corp.com`.
- **`email_list`**: The `allowed` field contains one or more full email addresses (e.g. `alice@example.com`). Only those exact addresses match.
- Both modes can be **mixed**: `*@corp.com,contractor@gmail.com` — the mode stored will be `email_list` (since not all entries are wildcards), but matching logic is identical for both modes.

If the address matches, a one-time magic link is emailed to the visitor. The link expires in 15 minutes and becomes invalid after first use. Clicking it sets a session cookie granting access for 7 days.

If `RESEND_API_KEY` and `FROM_EMAIL` are not set and a page uses email auth, visitors see a clear HTML error page explaining that the server is not configured for email — the magic link flow cannot proceed.

---

## Email setup (Resend)

1. Sign up at [resend.com](https://resend.com) and get an API key.
2. Add and verify a sender domain in the Resend dashboard.
3. Set `RESEND_API_KEY` to your key and `FROM_EMAIL` to a verified address on that domain (e.g. `noreply@yourdomain.com`).
4. Both variables must be set. If only one is present, the service will return an error when attempting to send.

Magic link emails are sent with the subject `Your access link for "<page title>"` and include a single-use button linking to `GET /:slug/verify?token=<token>`.
