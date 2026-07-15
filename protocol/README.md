# @journal.one/gateway-protocol

Shared TypeScript types and [Zod](https://zod.dev) schemas for the Journal
Gateway WebSocket protocol.

Most applications should install `@journal.one/gateway` or
`@journal.one/gateway-client` instead. Install this package directly when you
need to validate protocol messages, share gateway types across packages, or
build custom tooling around the protocol.

## Install

```bash
npm install @journal.one/gateway-protocol
```

## Exports

- WebSocket message schemas for gateway-to-service and service-to-gateway
  messages.
- Integration types: `Integration`, `ToolDefinition`, `ToolResult`, and content
  blocks.
- Skill types for markdown skills published by gateways.
- Typed gateway errors and error codes.
- Provider interfaces used by gateway implementations.

The package has one runtime dependency: `zod`.

## Usage

```ts
import {
  GatewayMessageSchema,
  ServiceMessageSchema,
  type GatewayMessage,
  type ToolResult,
} from "@journal.one/gateway-protocol";

export function parseGatewayMessage(raw: string): GatewayMessage {
  return GatewayMessageSchema.parse(JSON.parse(raw));
}

export function readText(result: ToolResult): string[] {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text);
}

ServiceMessageSchema.parse({
  type: "ping",
});
```

## Version Compatibility

Journal Gateway packages release in lockstep. Use matching versions of:

- `@journal.one/gateway`
- `@journal.one/gateway-client`
- `@journal.one/gateway-protocol`
- `journal-gateway-client` for Python services

## More Documentation

- [Protocol spec](https://github.com/EnduranceLabs/journal-gateway/blob/main/spec/protocol.md)
- [Full README](https://github.com/EnduranceLabs/journal-gateway#readme)

## License

MIT
