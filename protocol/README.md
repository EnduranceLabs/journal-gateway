# @journal.one/gateway-protocol

Shared TypeScript types and [Zod](https://zod.dev) schemas for the Journal Gateway protocol (v2). Used by both the gateway and client libraries — you typically don't install this directly.

## Install

```bash
npm install @journal.one/gateway-protocol
```

## What's inside

- **Message schemas** — every WebSocket message type (`authenticate`, `tool_call`, `version_changed`, pull requests/responses, etc.)
- **Integration types** — `Integration`, `ToolDefinition`, `ToolResult`, and content blocks
- **Skill types** — `Skill` schema
- **Error types** — `GatewayError` with typed error codes
- **Provider interface** — `IntegrationProvider`, `GatewayConfig`, `GatewayVersions`

All exports are pure types and Zod schemas with no runtime dependencies beyond Zod.

## Usage

```ts
import {
  GatewayMessageSchema,
  ServiceMessageSchema,
  type Integration,
  type ToolResult,
} from "@journal.one/gateway-protocol";

// Validate an incoming message
const msg = GatewayMessageSchema.parse(JSON.parse(raw));
```

## Full documentation

See the [root README](https://github.com/EnduranceLabs/journal-edge#readme) for protocol details, architecture, and configuration reference.

## License

MIT
