# Claude Code Monitor

Team-locked dashboard for monitoring Claude Code usage on a small (≤6 people) team. Built for the Cynergy team to coordinate a single shared Claude Code seat.

## What it does

- Each teammate signs in via Google. Whitelisted emails only.
- One person at a time gets the active "slot" (60 min, soft-warning only — never auto-killed).
- Other teammates queue up; the active user and the next-in-queue both get a 10-minute heads-up email.
- The team lead sees live presence ("is Vedant's Claude Code currently running?"), the active slot, the queue, and per-teammate 7-day usage bars.
- The team lead can hard-kill any active session: a kill flag is set on the server, the teammate's VS Code extension writes a local flag file, and the next Claude Code tool call gets refused by a `PreToolUse` hook.

## Architecture

```
Next.js app on Vercel  ──── Neon Postgres
       ▲    ▲
       │    │ POST /api/extension/status (every 10s)
       │    │ POST /api/ingest (every Claude Code event)
       │    │
   Google   ├── VS Code extension "Claude Monitor"
   OAuth    │       (status bar, modal, hook installer)
            │
            └── ~/.claude/settings.json hook
                  → POSTs telemetry, refuses tool calls when blocked
```

The VS Code extension is a thin client. The real teeth are the Claude Code hook in `~/.claude/settings.json` — it fires for every tool call regardless of whether Claude Code is invoked from the terminal, the official VS Code extension panel, or any other surface, and exit-code-2 there means the tool call gets refused.

## Repo layout

- `src/` — Next.js 16 app (App Router, Drizzle, NextAuth v5, Tailwind v4)
- `extension/` — VS Code extension (`Claude Monitor`)
- `drizzle/` — generated SQL migrations

## Required env vars

- `DATABASE_URL` (auto-provisioned by Vercel ↔ Neon)
- `AUTH_SECRET` / `NEXTAUTH_SECRET`
- `AUTH_TRUST_HOST=true`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `TL_EMAILS` (comma-separated; team lead accounts)
- `MEMBER_EMAILS` (comma-separated; everyone else allowed)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `CRON_SECRET`

A Vercel cron at `* * * * *` hits `/api/cron/warnings` to send 10-minute reminder emails.

## Local dev

```bash
npm install
npx drizzle-kit push
npm run dev
```

## Extension build + install

```bash
cd extension
npm install
npm run build
npm run package
code --install-extension claude-monitor-0.1.0.vsix
```

Then run **Claude Monitor: Sign in (paste API token)** from the command palette and paste the dashboard URL + the API token shown on your dashboard.
