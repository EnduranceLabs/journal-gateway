# AGENTS.md

Start here if you're a coding agent working in this repo.

## What this is

Journal Edge connects a customer's own tools to [Journal](https://journal.one). It is
two sides of one WebSocket protocol:

- **Gateway** (`gateway/`) — runs inside the customer's network, connects *outbound* to
  Journal, and exposes their MCP servers and skill files. Credentials never leave their
  infrastructure and no inbound ports are opened.
- **Client libraries** (`clients/typescript`, `clients/python`) — the service side that
  accepts gateway connections, pulls their tools/skills, and calls tools.

Both sides share the schemas in `protocol/`. It is a pnpm workspace; the Python client
is a standalone package.

## Where to look

| To understand… | Read |
|----------------|------|
| The architecture, module by module | [CLAUDE.md](./CLAUDE.md) |
| The wire protocol (messages, flow, timeouts) | [spec/protocol.md](./spec/protocol.md) |
| The gateway config file and its JSON Schema | [README.md](./README.md), [spec/gateway-config.schema.json](./spec/gateway-config.schema.json) |
| How to run the whole thing end to end | [examples/](./examples) |
| The client library APIs | [clients/typescript/README.md](./clients/typescript/README.md), [clients/python/README.md](./clients/python/README.md) |
| Dev setup, build, and test | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| How releases work | [packaging/npm/README.md](./packaging/npm/README.md) |

## Commands

```bash
pnpm install
pnpm build            # build the gateway
pnpm typecheck
pnpm test             # gateway tests
pnpm test:client      # TypeScript client tests
pnpm test:integration # end-to-end (gateway <-> client)
pnpm test:python      # Python client tests (creates the venv on first run)
pnpm test:all         # everything above
```

Run `pnpm -r build` (or at least `pnpm -r typecheck`) before opening a PR.

## Conventions that are easy to get wrong

- **Client libraries never write to the console.** They surface diagnostics only through
  customer-provided callbacks (`onSocketError` / `on_socket_error`, `getTraceContext` /
  `get_trace_context`). No `console.*` / `print`. The Python library's fallback is the
  `journal_gateway_client` logger, silent by default.
- **This code ships to customer datacenters.** Keep diffs minimal and
  security-reviewable; avoid reviewer-facing comments and unrelated reformatting.
- **The gateway must survive a bad MCP server.** A server that fails to start is logged
  and skipped, never fatal (see `Runtime.start` in `gateway/src/runtime.ts`).
- **Keep the TS and Python clients at parity.** A hook or method added to one belongs in
  the other.

## Versioning & releases (lockstep)

All four packages release at the **same** version, always — a customer relies on it to
know they are protocol-compatible. Never edit versions by hand; bump them together so
none drift:

```bash
./packaging/bump-version.sh 0.8.0
```

Full release steps (npm, PyPI, Homebrew, Docker) are in
[packaging/npm/README.md](./packaging/npm/README.md).
