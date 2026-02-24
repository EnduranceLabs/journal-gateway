# Journal Gateway Protocol

Version: `1`

## Problem

Organizations need their AI agents to access internal tools — databases, observability platforms, internal APIs — without exposing credentials or opening inbound network ports. The Journal Gateway Protocol solves this by letting a customer-deployed gateway connect **outbound** to the Journal Service over WebSocket. Credentials and data sources never leave the customer's network.

## Transport

- **Protocol:** WebSocket (`wss://`)
- **Endpoint:** `wss://gateway.journal.one/v1`
- **Direction:** Outbound from gateway to service (gateway initiates)
- **Encoding:** JSON (UTF-8)
- **Framing:** Each WebSocket text frame contains exactly one JSON message

## Connection Lifecycle

```
Gateway                                  Service
  |                                         |
  |---- WebSocket Connect ----------------->|
  |                                         |
  |---- authenticate ---------------------->|
  |<--- authenticated / auth_error ---------|
  |                                         |
  |---- register -------------------------->|
  |<--- registered -------------------------|
  |                                         |
  |          +-- Steady State --+           |
  |          |                  |           |
  |<-------- | tool_call -------|----------|
  |--------- | tool_result ----|---------->|
  |          | (or tool_error)  |           |
  |          |                  |           |
  |<-------- | ping ------------|----------|
  |--------- | pong ------------|---------->|
  |          |                  |           |
  |<-------- | refresh_reg... --|----------|
  |--------- | register -------|---------->|
  |<-------- | registered -----|----------|
  |          |                  |           |
  |          +------------------+           |
  |                                         |
```

1. The gateway opens a WebSocket connection to the service endpoint.
2. It sends an `authenticate` message with its token and version info.
3. On success (`authenticated`), it sends a `register` message declaring all available integrations and their tools.
4. The connection enters steady state: the service sends `tool_call` requests and `ping` heartbeats; the gateway responds with `tool_result`/`tool_error` and `pong`.
5. At any time during steady state, the service may send `refresh_registrations` to request the gateway to re-send its integrations. The gateway responds with a standard `register` message. This allows the service to pick up tool/skill changes without a full reconnect.

## Message Reference

All messages are JSON objects with a `type` field used as a discriminator.

### Gateway -> Service

#### `authenticate`

Sent immediately after the WebSocket connection opens.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"authenticate"` | yes | Message discriminator |
| `token` | `string` | yes | Gateway auth token (`gw_*` prefix) |
| `protocolVersion` | `number` | yes | Protocol version (currently `1`) |
| `gatewayVersion` | `string` | yes | Gateway software version (semver) |

```json
{
  "type": "authenticate",
  "token": "gw_abc123",
  "protocolVersion": 1,
  "gatewayVersion": "0.1.0"
}
```

#### `register`

Sent after successful authentication. Declares all available integrations. Each integration can carry tools, skills, or both.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"register"` | yes | Message discriminator |
| `integrations` | `Integration[]` | yes | Array of integration registrations |

```json
{
  "type": "register",
  "integrations": [
    {
      "id": "postgresql",
      "name": "PostgreSQL",
      "description": "Query PostgreSQL databases",
      "tools": [
        {
          "name": "query",
          "description": "Execute a read-only SQL query",
          "inputSchema": {
            "type": "object",
            "properties": {
              "sql": { "type": "string" }
            },
            "required": ["sql"]
          }
        }
      ]
    },
    {
      "id": "skills",
      "name": "Skills",
      "description": "Loaded from /opt/journal/skills",
      "tools": [],
      "skills": [
        {
          "id": "review-pr",
          "content": "You are reviewing a pull request. Follow these steps..."
        }
      ]
    }
  ]
}
```

#### `tool_result`

Sent in response to a `tool_call`. Contains the successful execution result.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tool_result"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the original `tool_call.requestId` |
| `result` | `ToolResult` | yes | Execution result with content blocks |

```json
{
  "type": "tool_result",
  "requestId": "req_001",
  "result": {
    "content": [
      { "type": "text", "text": "Query returned 3 rows." }
    ]
  }
}
```

#### `tool_error`

Sent in response to a `tool_call` when execution fails.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tool_error"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the original `tool_call.requestId` |
| `error` | `GatewayError` | yes | Error code and message |

```json
{
  "type": "tool_error",
  "requestId": "req_001",
  "error": {
    "code": "EXECUTION_FAILED",
    "message": "relation \"users\" does not exist"
  }
}
```

#### `pong`

Sent in response to a `ping`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"pong"` | yes | Message discriminator |

```json
{ "type": "pong" }
```

### Service -> Gateway

#### `authenticated`

Sent after successful authentication.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"authenticated"` | yes | Message discriminator |
| `organizationId` | `string` | yes | Organization ID |
| `organizationName` | `string` | no | Organization display name |

```json
{
  "type": "authenticated",
  "organizationId": "org_abc123",
  "organizationName": "Acme Corp"
}
```

#### `auth_error`

Sent when authentication fails.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"auth_error"` | yes | Message discriminator |
| `error` | `string` | yes | Error description |

```json
{
  "type": "auth_error",
  "error": "Invalid or expired gateway token"
}
```

#### `registered`

Sent after successful registration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"registered"` | yes | Message discriminator |
| `integrationCount` | `number` | yes | Number of registered integrations |
| `toolCount` | `number` | yes | Total number of registered tools |
| `skillCount` | `number` | no | Number of registered skills |

```json
{
  "type": "registered",
  "integrationCount": 1,
  "toolCount": 2,
  "skillCount": 1
}
```

#### `tool_call`

Sent to invoke a tool on a registered integration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tool_call"` | yes | Message discriminator |
| `requestId` | `string` | yes | Unique request ID for correlation |
| `integrationId` | `string` | yes | Target integration identifier |
| `toolName` | `string` | yes | Tool name within the integration |
| `arguments` | `object` | yes | Tool input arguments |

```json
{
  "type": "tool_call",
  "requestId": "req_001",
  "integrationId": "postgresql",
  "toolName": "query",
  "arguments": { "sql": "SELECT count(*) FROM users" }
}
```

#### `ping`

Heartbeat sent by the service.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"ping"` | yes | Message discriminator |

```json
{ "type": "ping" }
```

#### `refresh_registrations`

Requests the gateway to re-send its integrations. The gateway responds with a standard `register` message (which the service handles as a re-registration, updating integrations in-place without dropping pending tool calls).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"refresh_registrations"` | yes | Message discriminator |

```json
{ "type": "refresh_registrations" }
```

## Data Types

The canonical definitions live in `gateway/src/types/` as Zod schemas. The tables below are a prose summary for implementors working in other languages.

### Integration

An integration is the umbrella concept for capabilities added to the gateway. It can provide tools (callable by the agent), skills (prompt templates), or both.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier |
| `name` | `string` | yes | Display name |
| `description` | `string` | yes | Human-readable description |
| `tools` | `ToolDefinition[]` | yes | Tools provided by this integration |
| `skills` | `Skill[]` | no | Skills (prompt templates) provided by this integration |

### ToolDefinition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Tool identifier (unique within its integration) |
| `description` | `string` | yes | What the tool does |
| `inputSchema` | `object` | yes | JSON Schema describing the tool's input |

### ToolResult

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | `ContentBlock[]` | yes | Result content blocks |
| `isError` | `boolean` | no | `true` if the result represents an application-level error |

### ContentBlock

Discriminated union on `type`.

**TextContent:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"text"` | yes | Content kind |
| `text` | `string` | yes | Text content |

**ImageContent:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"image"` | yes | Content kind |
| `data` | `string` | yes | Base64-encoded image data |
| `mimeType` | `string` | yes | Image MIME type (e.g. `image/png`) |

### Skill

A prompt/workflow template that guides agent behavior. Skills are raw Markdown content — the gateway does not parse or interpret them.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier (derived from filename) |
| `content` | `string` | yes | Raw Markdown content |

### GatewayError

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | `GatewayErrorCode` | yes | Machine-readable error code |
| `message` | `string` | yes | Human-readable error message |

## Timeouts

| Timeout | Duration | Description |
|---------|----------|-------------|
| Authentication | 10s | Time to complete auth after WebSocket opens |
| Registration | 30s | Time to complete registration after auth |
| Heartbeat interval | 30s | Service sends `ping` every 30s |
| Pong timeout | 10s | Gateway must respond to `ping` within 10s |
| Tool call (gateway) | 60s | Gateway must respond to `tool_call` within 60s |
| Tool call (service) | 90s | Service waits up to 90s for tool result |

## Reconnection

When the WebSocket connection drops, the gateway reconnects with exponential backoff:

- **Initial delay:** 1 second
- **Backoff multiplier:** 2x
- **Maximum delay:** 30 seconds
- **Jitter:** +/-25% randomization on each delay
- **Reset:** Backoff resets to initial delay after a successful connection (authenticated + registered)

## Concurrency

Multiple `tool_call` messages may be in flight simultaneously. Each carries a unique `requestId` that must be echoed in the corresponding `tool_result` or `tool_error` response. The gateway may process calls in any order.

## Error Codes

| Code | Description |
|------|-------------|
| `INTEGRATION_NOT_FOUND` | The requested `integrationId` is not registered |
| `TOOL_NOT_FOUND` | The requested `toolName` does not exist on the integration |
| `EXECUTION_FAILED` | Tool execution threw an error |
| `TIMEOUT` | Tool execution exceeded the timeout |

## Security Invariants

1. **Outbound-only connections.** The gateway initiates all connections. No inbound ports required.
2. **Credentials stay local.** Database passwords, API tokens, and other secrets are configured on the gateway and never transmitted to Journal.
3. **Read-only default.** Integrations should default to read-only access where possible.
4. **Token-based auth.** Gateway tokens (`gw_*`) are scoped to a single organization.
5. **TLS required.** Production connections must use `wss://`.
