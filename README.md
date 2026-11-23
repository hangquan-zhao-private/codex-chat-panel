# Codex Chat Panel

A clean, modern chat panel for the [Codex CLI](https://github.com/openai/codex) inside VS Code — with conversation history organized **per folder**.

> This is a community project and is not affiliated with or endorsed by OpenAI.

## Features

- **Chat panel** — streaming replies with Markdown, collapsible reasoning, command output and file-change cards.
- **Per-folder history** — conversations are grouped by the folder they ran in. Switch between *This folder* and *All folders*, search, and resume any past session.
- **Model, reasoning effort and access pickers** — right in the composer.
  - Access levels: Read only · Workspace · Workspace + Net · Full (allow all, asks for confirmation).
- **Ask about selection** — right-click selected code → *Ask Codex About Selection*.
- Follows your VS Code theme. Can be moved to the right (Secondary Side Bar) by dragging the icon.

## Requirements

- [Codex CLI](https://github.com/openai/codex) installed and logged in (`codex login`).
- The extension reads sessions from `~/.codex/sessions` and model info from `~/.codex/models_cache.json`. Nothing is sent anywhere except through your local `codex` CLI.

## Settings

| Setting | Description |
| --- | --- |
| `codexStudio.codexPath` | Path to the `codex` executable (default: auto-detect). |
| `codexStudio.model` | Model override (empty = use `~/.codex/config.toml`). |
| `codexStudio.reasoningEffort` | Reasoning effort override. |
| `codexStudio.sandbox` | `read-only`, `workspace-write`, or `danger-full-access`. |
| `codexStudio.networkAccess` | Allow network in `workspace-write`. |
| `codexStudio.sessionsDir` | Custom sessions directory. |

## Notes

Codex runs non-interactively (`codex exec`), so it cannot pause to ask for command approval; access is controlled by the sandbox level.

## Development

```bash
npm install          # Node 18+
npm run build
# press F5 in VS Code to launch an Extension Development Host
```

## License

MIT
