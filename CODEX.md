# Codex Notes

See [AGENTS.md](./AGENTS.md) for the operational contract (commands, conventions,
lockstep versioning). Codex-specific preferences below.

- Keep changes minimal and readable; favor clarity over cleverness.
- Default to ASCII, concise comments, and explicit error handling.
- Use `rg` for search; avoid destructive Git commands.
- Respect existing patterns; don’t reformat unrelated code.
- When adding docs or examples, be brief and practical.
- Before PRs or publishing, run `pnpm -r build` (or at least `pnpm -r typecheck`) across the workspace to catch TS/build issues.
