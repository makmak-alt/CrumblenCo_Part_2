# Crumble & Co — MVI Setup Guide (R0 stack)

This turns the prototype into the MVI: central database, cross-device order tracking,
real AI chatbot, and an owner dashboard — all on permanent free tiers.

**Architecture**
```
index.html / admin.html (GitHub Pages)
        │  HTTPS/JSON
        ▼
Cloudflare Worker (crumble-api)          ← free: 100k requests/day
   ├── Supabase PostgreSQL               ← free: 500 MB
   ├── Workers AI (Llama 3.1 8B)         ← free: 10k neurons/day
   └── Google Apps Script → Sheet+Gmail  ← free
```

You only need to create **two free accounts** (Supabase + Cloudflare) and paste a few keys.
Everything else is already coded in this repo.

---

## Step 1 — Supabase (database, ~5 min)

1. Go to https://supabase.com → **Start your project** → sign up (free, GitHub login works).
2. **New project** → any name (e.g. `crumble-co`), set a database password (save it), region closest to you → **Create**.
3. In the left menu: **SQL Editor** → **New query** → paste the whole contents of
   `supabase/schema.sql` (in this repo) → **Run**. You should see "Success".
4. Left menu: **Project Settings** (gear) → **API**. Copy and save:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **service_role** key (under "Project API keys" — click Reveal). ⚠️ This key is secret; it only goes into Cloudflare, never into the website code.

## Step 2 — Cloudflare Worker (backend + AI, ~10 min)

1. Go to https://dash.cloudflare.com → sign up (free).
2. Install Node.js if you don't have it (https://nodejs.org, LTS version), then in a terminal:
   ```bash
   cd worker
   npm install -g wrangler        # or use: npx wrangler ...
   wrangler login                 # opens the browser to authorise
   ```
3. Set the three secrets (paste each value when prompted):
   ```bash
   wrangler secret put SUPABASE_URL            # https://....supabase.co  (Step 1.4)
   wrangler secret put SUPABASE_SERVICE_KEY    # service_role key         (Step 1.4)
   wrangler secret put OWNER_TOKEN             # invent a long random string — this is your dashboard password. SAVE IT.
   ```
4. Deploy:
   ```bash
   wrangler deploy
   ```
   It prints your Worker URL, e.g. `https://crumble-api.<yours>.workers.dev`. **Copy it.**

   *(No-terminal alternative: Dashboard → Workers & Pages → Create Worker → paste
   `worker/src/index.js` into the editor → add the AI binding (Settings → Bindings → Workers AI)
   and the same 3 secrets + the 2 vars from `wrangler.toml`.)*

## Step 3 — Point the website at the Worker

In **both** `index.html` and `admin.html`, replace:

```js
const API_URL = "https://crumble-api.YOUR-SUBDOMAIN.workers.dev";
```

with your real Worker URL from Step 2.4. Commit and push — GitHub Pages republishes automatically.

## Step 4 — Update the Apps Script (emails + Sheet, ~3 min)

1. Open your existing Apps Script project (the one behind your current webhook URL).
2. Replace **all** code with `apps-script/Code.gs` from this repo. Check `OWNER_EMAIL` at the top.
3. **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy.**
   The URL does not change, so the Worker (and old site) keep working.
4. The Worker already knows this URL (`SHEET_URL` in `wrangler.toml`) — nothing else to do.

## Step 5 — Enable GitHub Pages on this repo

Repo → **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
The MVI goes live at `https://makmak-alt.github.io/CrumblenCo_Part_2/`
(the dashboard is at `.../admin.html`).

## Step 6 — End-to-end test (the fun part)

1. Open the site, place a test order (use your own email).
2. Check: row in Supabase (**Table Editor → orders**), row in the Google Sheet, 2 emails.
3. Open an **incognito window** → Track tab → order number + email → timeline shows.
   (This is the cross-device fix working.)
4. Open `admin.html`, log in with `OWNER_TOKEN` → **✓ Mark as paid** →
   customer gets the "payment confirmed" email and the tracking timeline moves.
5. Ask the chatbot something unscripted, e.g. *"which cookie goes best with rooibos tea?"* —
   that's Llama 3.1 answering (scripted bot still handles menu/orders instantly).

## Costs & quotas (all free)

| Service | Free quota | Enough for |
|---|---|---|
| GitHub Pages | 100 GB bandwidth/mo | unlimited for this site |
| Cloudflare Workers | 100,000 req/day | thousands of orders/day |
| Workers AI | 10,000 neurons/day | hundreds of AI chats/day (scripted bot handles the rest) |
| Supabase | 500 MB Postgres | ~years of cookie orders |
| Apps Script / Gmail | 100 emails/day | dozens of orders/day |

## Security notes

- `SUPABASE_SERVICE_KEY` and `OWNER_TOKEN` exist **only** as Cloudflare secrets — never in the repo or browser code.
- The Supabase table has Row-Level Security on with no public policies; only the Worker can touch it.
- Customer tracking requires the order number **and** the matching email.
- CORS only allows `https://makmak-alt.github.io`.
