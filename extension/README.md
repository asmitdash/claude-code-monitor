# Claude Monitor (VS Code extension)

Reports Claude Code activity from this laptop to your team's Claude Code Monitor dashboard, and enforces the team lead's kill switch via a Claude Code hook installed in `~/.claude/settings.json`.

## Setup

1. Install this VSIX (`code --install-extension claude-monitor-0.1.0.vsix`).
2. Run `Claude Monitor: Sign in (paste API token)` from the command palette.
3. Paste your dashboard URL and the API token shown on your dashboard.

The extension installs a hook script at `~/.claude-monitor/hook.mjs` and registers it in `~/.claude/settings.json` under `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, and `SessionStart`. Every Claude Code event POSTs to your dashboard. If the team lead clicks "Stop their Claude Code", the next tool call gets refused with exit code 2.
