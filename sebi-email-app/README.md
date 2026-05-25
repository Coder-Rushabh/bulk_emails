# AdvisorConnect Pro

A full-stack outreach platform for discovering, enriching, and contacting SEBI-registered investment advisers (and arbitrary LinkedIn-sourced leads) with rate-limited, audit-logged SMTP delivery.

The system combines:

- **Headless-browser scrapers** (Playwright) that harvest structured records from the SEBI public register and LinkedIn public profiles.
- **An email-enrichment pipeline** that resolves contact addresses via structured page data → Google search → Hunter.io API fallback.
- **A Flask SMTP gateway** that fronts Gmail (or any STARTTLS server) with per-day send-quota enforcement.
- **A React + Vite single-page application** for reviewing leads, tracking outreach status, templating messages with field substitution, and dispatching campaigns.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Repository Layout](#repository-layout)
3. [Tech Stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Configuration](#configuration)
7. [Running the System](#running-the-system)
8. [Component Reference](#component-reference)
9. [Data Schemas](#data-schemas)
10. [HTTP API](#http-api)
11. [Rate Limiting & Quotas](#rate-limiting--quotas)
12. [Security Considerations](#security-considerations)
13. [Legal & Compliance](#legal--compliance)
14. [Troubleshooting](#troubleshooting)
15. [Roadmap](#roadmap)

---

## Architecture

```
┌──────────────────────┐      ┌──────────────────────┐
│  scrape_sebi.py      │─────▶│  sebi_advisers.csv   │
│  (Playwright)        │      └──────────────────────┘
└──────────────────────┘                  │
                                          │
┌──────────────────────┐      ┌──────────────────────┐
│  linkedin_scraper.py │─────▶│  linkedin_results.csv│
│  (Playwright +       │      └──────────────────────┘
│   Hunter.io)         │                  │
└──────────────────────┘                  ▼
                                ┌──────────────────────┐
                                │  React SPA (Vite)    │
                                │  ─ CSV/XLSX import   │
                                │  ─ Field mapping     │
                                │  ─ Template editor   │
                                │  ─ Status tracking   │
                                │  (localStorage)      │
                                └──────────┬───────────┘
                                           │ HTTP POST /send-email
                                           ▼
                                ┌──────────────────────┐
                                │  Flask SMTP Gateway  │
                                │  ─ Quota enforcement │
                                │  ─ STARTTLS / Gmail  │
                                │  ─ email_limit.json  │
                                └──────────┬───────────┘
                                           │ SMTP (port 587)
                                           ▼
                                ┌──────────────────────┐
                                │  smtp.gmail.com      │
                                │  (or any SMTP host)  │
                                └──────────────────────┘
```

There is no shared persistent store; lead data lives in CSVs on disk, UI state lives in browser `localStorage`, and quota state lives in `email_limit.json`. A standalone Postgres connection probe (`test_db_connection.py`) is provided for a planned migration to a relational backend.

---

## Repository Layout

```
bot/
├── advisor_app.html          # Standalone (CDN-free) React UI — Babel in-browser
├── email_server.py           # Flask SMTP gateway (port 5000)
├── email_limit.json          # Per-date send counter (JSON)
├── scrape_sebi.py            # SEBI Investment Adviser register scraper
├── linkedin_scraper.py       # LinkedIn public-profile scraper + email enrichment
├── keywords.txt              # LinkedIn search queries (one per line)
├── sebi_advisers.csv         # Scraper output (canonical lead source)
├── test_db_connection.py     # Standalone Postgres connectivity probe
├── lib/                      # Vendored frontend assets for advisor_app.html
│   ├── react.js
│   ├── react-dom.js
│   ├── babel.js
│   ├── papaparse.js
│   ├── xlsx.full.min.js
│   └── font-awesome.css
└── sebi-email-app/           # Production React build (Vite)
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── App.css
        └── index.css
```

The project ships **two** frontends:

- `advisor_app.html` — zero-build static page that loads React via in-browser Babel. Useful for quick demos on a stock Python http.server.
- `sebi-email-app/` — Vite + React 19 production build with proper bundling, ESLint, and HMR.

They consume the same Flask backend and the same CSV schema.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Scraping | Python 3.10+, Playwright (Chromium), `requests` |
| Backend  | Flask, Flask-CORS, `smtplib`, `email.mime` |
| Frontend (prod) | React 19, Vite 8, Axios, PapaParse, SheetJS (`xlsx`), `lucide-react` |
| Frontend (static demo) | React 18 UMD, in-browser Babel, PapaParse, SheetJS |
| Data sources | SEBI public register, Google Search, LinkedIn public profiles, Hunter.io |
| State (client) | `localStorage` (statuses, template, sender config, field mapping) |
| State (server) | `email_limit.json` (atomic, single-process) |
| Optional DB | PostgreSQL via `psycopg2` (probe only — not yet wired into the app) |

---

## Prerequisites

- **Python** 3.10 or newer
- **Node.js** 20 or newer (for `sebi-email-app`)
- **Chromium** for Playwright (installed via `playwright install chromium`)
- **A Gmail account with an App Password** (Google no longer permits raw account passwords for SMTP). Generate one at <https://myaccount.google.com/apppasswords>.
- *(Optional)* **Hunter.io API key** for LinkedIn email enrichment (free tier: 25 lookups/month).
- *(Optional)* **PostgreSQL** instance if you intend to migrate off the CSV-on-disk model.

---

## Installation

```powershell
# 1. Clone or unzip the project, then cd into it
cd bot

# 2. Python dependencies
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install flask flask-cors playwright requests psycopg2-binary
playwright install chromium

# 3. Frontend dependencies (production SPA)
cd sebi-email-app
npm install
cd ..
```

---

## Configuration

### Flask backend — `email_server.py`

```python
SMTP_SERVER       = "smtp.gmail.com"     # any STARTTLS host
SMTP_PORT         = 587
SENDER_EMAIL      = ""                   # default sender; overridable per request
SENDER_PASSWORD   = ""                   # Gmail App Password
DAILY_SEND_LIMIT  = 100                  # quota per calendar day (server local time)
LIMIT_TRACK_FILE  = "email_limit.json"   # quota persistence
```

Credentials can also be supplied **per request** in the JSON body — the React SPA stores them in `localStorage` under `sender_config` and sends them on every `POST /send-email`. The hard-coded constants act as fall-backs only.

### LinkedIn scraper — `linkedin_scraper.py`

```python
KEYWORDS_FILE             = "keywords.txt"
OUTPUT_FILE               = "linkedin_results.csv"
MAX_PROFILES_PER_KEYWORD  = 10
REQUEST_DELAY             = (3, 6)       # randomised throttle (seconds)
HUNTER_API_KEY            = ""           # optional
```

`keywords.txt` accepts one search query per line; `#` introduces a comment.

### React SPA — `sebi-email-app/src/App.jsx`

```js
const API_URL     = 'http://localhost:5000';
const DAILY_LIMIT = 100;
```

The SPA expects the Flask backend on `localhost:5000` and auto-loads `/data.csv` from the Vite `public/` directory on first mount. Place a copy of `sebi_advisers.csv` there (or use the in-app file picker).

---

## Running the System

Three processes, three terminals:

### Terminal 1 — SMTP Gateway

```powershell
python email_server.py
# → Email server starting on http://localhost:5000
```

### Terminal 2 — Frontend

**Option A: Production SPA (recommended)**

```powershell
cd sebi-email-app
npm run dev
# → http://localhost:5173
```

**Option B: Static demo page**

```powershell
python -m http.server 8000
# → http://localhost:8000/advisor_app.html
```

### Terminal 3 — Scrapers (run as needed)

```powershell
python scrape_sebi.py          # → sebi_advisers.csv
python linkedin_scraper.py     # → linkedin_results.csv
```

---

## Component Reference

### `scrape_sebi.py`

Headless Chromium scraper that paginates the SEBI Investment Adviser register at
`https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=13`.

- Uses an exact text-match selector (`text-is`) on the field title span to disambiguate `"Address"` from `"Correspondence Address"`.
- Detects page transitions by polling the first record's `Name` value rather than relying on URL changes (SEBI's pagination is JavaScript-driven, not URL-based).
- Writes one row per adviser to `sebi_advisers.csv`. Empty-name rows are dropped.

### `linkedin_scraper.py`

Multi-stage public-profile harvester. For each keyword:

1. Runs `site:linkedin.com/in/ "<keyword>"` against Google, unwraps `/url?q=` redirects, and deduplicates canonical URLs.
2. Loads each profile and extracts data in priority order:
   - `<script type="application/ld+json">` Person schema (most reliable)
   - Open Graph meta tags (`og:title`)
   - `<title>` element
   - First visible `<h1>`
3. Runs an email-resolution cascade (first hit wins):
   1. Email embedded in profile structured data or About text
   2. Secondary Google search: `"<name>" "<company>" email`
   3. Hunter.io email-finder API (requires `HUNTER_API_KEY`)
4. Persists per-profile provenance in `email_source` so downstream consumers can weight confidence.

Inter-request delays are randomised in `REQUEST_DELAY` to be polite to Google. Note that LinkedIn aggressively cloaks logged-out views, so yield rates depend on profile visibility settings.

### `email_server.py`

A thin Flask app exposing a single route:

- Constructs a `MIMEMultipart` message with plaintext body.
- Opens an SMTP connection, calls `starttls()`, authenticates, and dispatches.
- Increments today's counter (`YYYY-MM-DD` key) in `email_limit.json` only on a successful send.
- Returns `429 Too Many Requests` once `DAILY_SEND_LIMIT` is reached for the current local date.

The server is **single-process and not thread-safe** with respect to the JSON quota file. For multi-worker deployments, replace with an atomic counter (Redis `INCR`, Postgres row, etc.).

### React SPA (`sebi-email-app/`)

- **Data import:** drag-and-drop CSV or XLSX via PapaParse / SheetJS.
- **Field mapping:** dynamic mapping of arbitrary column headers to `name`, `email`, `regNo`. Persisted to `localStorage` under `field_mapping`.
- **Template editor:** Mustache-style placeholders (e.g. `{Name}`, `{RegNo}`) substituted per-row at send time.
- **Status tracking:** per-row send status stored client-side under `advisor_statuses`.
- **Sender config:** SMTP host, port, username, and App Password persisted in `localStorage` under `sender_config` and sent on each request.
- **Views:** `daily` (next-N queue under the quota), `all` (full dataset), `template`, `settings`.

### `test_db_connection.py`

Standalone Postgres connectivity probe using a literal IPv6 address (intended for a Supabase / managed Postgres host). It is **not** consumed by the app at present; it exists so that a future migration off the CSV/JSON model has a known-good connection template.

---

## Data Schemas

### `sebi_advisers.csv`

| Column | Source |
|---|---|
| `Name` | SEBI record |
| `Registration No.` | SEBI record |
| `E-mail` | SEBI record |
| `Telephone` | SEBI record |
| `Fax No.` | SEBI record |
| `Address` | SEBI record |
| `Contact Person` | SEBI record |
| `Correspondence Address` | SEBI record |
| `Validity` | SEBI record |

### `linkedin_results.csv`

| Column | Description |
|---|---|
| `keyword` | Originating query from `keywords.txt` |
| `name` | Resolved full name |
| `headline` | Profile headline / job title |
| `company` | First entry under `worksFor` |
| `location` | `addressLocality` |
| `email` | Best-effort resolved address |
| `email_source` | `profile_structured` \| `profile_text` \| `google_search` \| `hunter (NN% confidence)` |
| `url` | Canonical LinkedIn URL |

### `email_limit.json`

```json
{ "2026-05-25": 18, "2026-05-22": 100 }
```

Keys are ISO-8601 dates in the server's local timezone; values are the number of successful sends that day.

---

## HTTP API

### `POST /send-email`

**Request body**

```json
{
  "to": "advisor@example.com",
  "subject": "Quick question about your SEBI registration",
  "body": "Hello Jane, ...",
  "sender_email": "you@gmail.com",
  "sender_password": "app-password",
  "smtp_server": "smtp.gmail.com",
  "smtp_port": 587
}
```

The last four fields are optional; if omitted, the server falls back to the constants in `email_server.py`.

**Responses**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"message": "Email sent successfully!"}` | Sent; quota incremented |
| `400` | `{"error": "Missing data"}` | One of `to`, `subject`, `body` was missing |
| `429` | `{"error": "Daily email sending limit reached."}` | `DAILY_SEND_LIMIT` reached for the current date |
| `500` | `{"error": "<smtplib exception text>"}` | SMTP authentication or delivery failure |

CORS is wide-open (`flask-cors` default) — do **not** expose this port to the public internet.

---

## Rate Limiting & Quotas

- The server enforces a **hard ceiling of `DAILY_SEND_LIMIT` successful sends per local date**. Failed sends do not count.
- The frontend additionally throttles the UI: it surfaces a "Daily quota remaining" stat from its own count and disables send actions once `DAILY_LIMIT` is reached client-side.
- Quotas reset at local midnight by virtue of the date key changing — there is no scheduled task.
- Gmail's own undocumented limit is approximately **500 messages per rolling 24h** for free accounts and **2,000 per rolling 24h** for Workspace; the default of `100` is deliberately conservative.

---

## Security Considerations

- **SMTP credentials in localStorage.** The SPA stores the sender's App Password in `localStorage`, which is readable by any script running on the same origin. Treat the development server origin as trusted; do not embed third-party scripts.
- **Credentials on the wire.** Credentials are POSTed over plain HTTP to `localhost:5000`. If you bind the Flask server to anything other than the loopback interface, terminate TLS in front of it.
- **CORS is permissive.** `CORS(app)` allows any origin. Restrict to your frontend origin before any non-local deployment.
- **No request authentication.** Anyone who can reach `:5000` can trigger a send using the supplied credentials. Add an API key or session check before exposing.
- **In-browser Babel.** `advisor_app.html` transpiles JSX at runtime via `lib/babel.js`. This is acceptable for local demos but should never be served in production — use the Vite build.
- **Scraper behaviour.** Both scrapers run headless Chromium against third-party sites. Be aware of (and comply with) the relevant ToS — see *Legal & Compliance* below.

---

## Legal & Compliance

- **SEBI register** is published data; redistribution of personally identifying contact details is subject to local data-protection law (DPDPA 2023 in India; GDPR if any EU data subjects are in scope).
- **LinkedIn ToS** prohibits automated scraping of profile data. The `linkedin_scraper.py` flow targets *publicly indexed* profile fragments served without authentication, but you should still consult the current Terms before running at scale.
- **Anti-spam.** Bulk unsolicited commercial email is regulated under CAN-SPAM (US), CASL (Canada), GDPR (EU), and DPDPA (India). Ensure you have a lawful basis, accurate sender identification, and a working unsubscribe path before using this system for outreach.

This software is provided for legitimate B2B research and outreach. The maintainer assumes no liability for misuse.

---

## Troubleshooting

**`playwright._impl._errors.Error: Executable doesn't exist`**
Run `playwright install chromium`.

**SEBI scraper hangs on "Page refresh wait timed out"**
SEBI occasionally rate-limits scraping; the script falls back to a 5-second sleep and retries. If it persists, increase the timeout in `wait_for_function` or run with `headless=False` to diagnose.

**Gmail returns `(535, b'5.7.8 Username and Password not accepted')`**
You are using your account password instead of an App Password. Enable 2FA and generate one at <https://myaccount.google.com/apppasswords>.

**Frontend can't reach backend (`net::ERR_CONNECTION_REFUSED`)**
Confirm `email_server.py` is running on port 5000 and that no other process is bound to that port (`Get-NetTCPConnection -LocalPort 5000`).

**Quota appears stuck after the date changes**
`email_limit.json` is keyed by the server's local timezone. If you run the server in UTC but expect local-day boundaries (or vice versa), edit `get_today_count()` to use `datetime.now(tz)` instead of `date.today()`.

---

## Roadmap

- Replace `email_limit.json` with a Postgres-backed quota table (probe in `test_db_connection.py`).
- Add per-recipient unsubscribe tokens and a webhook for opt-outs.
- Promote `advisor_app.html` to be served by Vite, retiring the in-browser Babel path.
- HTML email bodies (currently plain-text only).
- Background job queue for scrapers (Celery / RQ) so the UI can trigger refreshes.
- Multi-tenant sender accounts with per-account quotas.