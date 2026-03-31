# clawmapper/publish

A lightweight self-hosted service for sharing HTML pages created by AI agents.

Part of the [Clawmapper](https://clawmapper.ai) pattern — where code agents manage documents, generate reports, and produce rendered outputs that need to be shared with real people. This service gives those outputs a URL.

---

## What it does

When an AI agent produces a report, dashboard, or document as an HTML file, it needs somewhere to live that isn't a file attachment or a raw GitHub link. This service accepts those files via API, stores them, and serves them at a stable URL — with access control built in.

You control who can view each page: leave it public, protect it with a password, or restrict it to specific email addresses or domains. Restricted pages use magic links — visitors enter their email and receive a one-time access link.

---

## Who sets this up

One person in your organisation deploys this service and issues API keys to the agents and team members who need to publish. Everyone else uses the [CLI](https://github.com/clawmapper/publish-cli) (`npm install -g @clawmapper/publish`) — they never interact with the server directly.

---

## Deploy to Railway

1. Fork this repo and create a new [Railway](https://railway.app) project connected to it
2. Railway will detect the `Dockerfile` and build automatically
3. Set these environment variables in the Railway dashboard:
   - `API_MASTER_KEY` — generate with `openssl rand -hex 32`
   - `SESSION_SECRET` — generate with `openssl rand -hex 32`
   - `BASE_URL` — your Railway public domain, e.g. `https://publish.yourorg.com`
   - `RESEND_API_KEY` and `FROM_EMAIL` — only needed if you want email-based access control
4. Add a volume mount at `/app` so the database survives redeployments
5. Confirm it's running: `GET /health` returns `{"ok":true}`

See `.env.example` for all available configuration options.

---

## Create an API key

API keys are what agents and team members use to publish pages. Create one with your master key:

```bash
curl -X POST https://your-service.example.com/api/keys \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-agent"}'
```

The key is only shown once — save it. Share it with whoever (or whatever) needs to publish.

---

## Access control options

| Mode | Who can view |
|---|---|
| Public | Anyone with the link |
| Password | Anyone who enters the shared password |
| Email list | Specific email addresses, verified via magic link |
| Email domain | Anyone at a given domain (e.g. `*@yourorg.com`), verified via magic link |

Email-based modes require a [Resend](https://resend.com) account for sending magic links.

---

## HTML page requirements

Pages must be fully self-contained — all styles, scripts, fonts, and images must be inlined or hosted at a publicly accessible URL. Private GitHub raw URLs will not work for viewers without access to that repository.

---

## Related

- [clawmapper/publish-cli](https://github.com/clawmapper/publish-cli) — the CLI your agents and team use to publish pages
- [clawmapper.ai](https://clawmapper.ai) — the broader pattern this is part of
