# Journal Gateway Protocol

Version: `2`

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
  |---- version_changed ------------------>|  (fire-and-forget)
  |                                         |
  |          +-- Steady State --+           |
  |<---------| get_versions ----|---------->|
  |----------| versions --------|---------->|
  |<---------| get_tools -------|---------->|
  |----------| tools -----------|---------->|
  |<---------| get_skills ------|---------->|
  |----------| skills ----------|---------->|
  |<---------| tool_call -------|---------->|
  |----------| tool_result -----|---------->|
  |          | (or tool_error)  |           |
  |<---------| ping ------------|---------->|
  |----------| pong ------------|---------->|
  |----------| version_changed -|---------->|  (on runtime change)
  |          +------------------+           |
```

1. The gateway opens a WebSocket connection to the service endpoint.
2. It sends an `authenticate` message with its token and version info.
3. On success (`authenticated`), the gateway sends a `version_changed` message announcing its current version hashes. The connection is now ready — no registration handshake.
4. The service may pull tools, skills, or versions at any time using `get_tools`, `get_skills`, or `get_versions`. The gateway responds with `tools`, `skills`, or `versions` respectively.
5. The service sends `tool_call` requests and `ping` heartbeats; the gateway responds with `tool_result`/`tool_error` and `pong`.
6. When the gateway detects that its tools or skills have changed at runtime, it sends another `version_changed` message. The service can then decide whether and what to pull.

## Message Reference

All messages are JSON objects with a `type` field used as a discriminator.

### Gateway -> Service

#### `authenticate`

Sent immediately after the WebSocket connection opens.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"authenticate"` | yes | Message discriminator |
| `token` | `string` | yes | Gateway auth token (`gw_*` prefix) |
| `protocolVersion` | `number` | yes | Protocol version (currently `2`) |
| `gatewayVersion` | `string` | yes | Gateway software version (semver) |

```json
{
  "type": "authenticate",
  "token": "gw_abc123",
  "protocolVersion": 2,
  "gatewayVersion": "0.1.0"
}
```

#### `version_changed`

Sent after successful authentication and whenever the gateway detects that its tools or skills have changed at runtime. This is fire-and-forget — the service does not acknowledge it.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"version_changed"` | yes | Message discriminator |
| `mcpVersion` | `string \| null` | yes | Content hash of MCP tool integrations, or null if none |
| `skillsVersion` | `string \| null` | yes | Content hash of skills, or null if none |

```json
{
  "type": "version_changed",
  "mcpVersion": "a1b2c3d4e5f67890",
  "skillsVersion": null
}
```

#### `versions`

Response to a `get_versions` request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"versions"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the `get_versions.requestId` |
| `mcpVersion` | `string \| null` | yes | Current MCP version hash |
| `skillsVersion` | `string \| null` | yes | Current skills version hash |

```json
{
  "type": "versions",
  "requestId": "pull_001",
  "mcpVersion": "a1b2c3d4e5f67890",
  "skillsVersion": null
}
```

#### `tools`

Response to a `get_tools` request. Contains all MCP tool integrations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tools"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the `get_tools.requestId` |
| `integrations` | `Integration[]` | yes | MCP tool integrations |
| `mcpVersion` | `string \| null` | yes | Current MCP version hash |

```json
{
  "type": "tools",
  "requestId": "pull_002",
  "integrations": [
    {
      "id": "postgresql",
      "name": "PostgreSQL",
      "description": "Query PostgreSQL databases",
      "tools": [
        {
          "name": "execute_sql",
          "description": "Execute a read-only SQL query",
          "inputSchema": {
            "type": "object",
            "properties": { "sql": { "type": "string" } },
            "required": ["sql"]
          }
        }
      ]
    }
  ],
  "mcpVersion": "a1b2c3d4e5f67890"
}
```

#### `skills`

Response to a `get_skills` request. Contains all skills.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"skills"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the `get_skills.requestId` |
| `skills` | `Skill[]` | yes | Array of skills |
| `skillsVersion` | `string \| null` | yes | Current skills version hash |

```json
{
  "type": "skills",
  "requestId": "pull_003",
  "skills": [
    {
      "id": "review-pr",
      "content": "You are reviewing a pull request. Follow these steps..."
    }
  ],
  "skillsVersion": "0987654321fedcba"
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

#### `get_versions`

Request current version hashes from the gateway.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"get_versions"` | yes | Message discriminator |
| `requestId` | `string` | yes | Request ID for correlation |

```json
{ "type": "get_versions", "requestId": "pull_001" }
```

#### `get_tools`

Request MCP tool integrations from the gateway.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"get_tools"` | yes | Message discriminator |
| `requestId` | `string` | yes | Request ID for correlation |

```json
{ "type": "get_tools", "requestId": "pull_002" }
```

#### `get_skills`

Request skills from the gateway.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"get_skills"` | yes | Message discriminator |
| `requestId` | `string` | yes | Request ID for correlation |

```json
{ "type": "get_skills", "requestId": "pull_003" }
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
| `traceparent` | `string` | no | W3C trace context; the gateway parents its tool-call span onto it |
| `tracestate` | `string` | no | W3C trace state, sent only alongside `traceparent` |

```json
{
  "type": "tool_call",
  "requestId": "req_001",
  "integrationId": "postgresql",
  "toolName": "execute_sql",
  "arguments": { "sql": "SELECT count(*) FROM users" },
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
}
```

The client libraries populate `traceparent`/`tracestate` from their
`getTraceContext` / `get_trace_context` hook when set.

#### `ping`

Heartbeat sent by the service.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"ping"` | yes | Message discriminator |

```json
{ "type": "ping" }
```

## Data Types

The canonical definitions live in `protocol/src/` as Zod schemas. The tables below are a prose summary for implementors working in other languages.

### Integration

An integration is the umbrella concept for capabilities added to the gateway. It provides tools (callable by the agent).

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
| Pull response | 30s | Time for gateway to respond to a pull request |
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
- **Reset:** Backoff resets to initial delay after a successful connection (authenticated)

## Concurrency

Multiple `tool_call` messages may be in flight simultaneously. Each carries a unique `requestId` that must be echoed in the corresponding `tool_result` or `tool_error` response. The gateway may process calls in any order.

Similarly, multiple pull requests (`get_versions`, `get_tools`, `get_skills`) may be in flight simultaneously, each with a unique `requestId`.

## Error Codes

| Code | Description |
|------|-------------|
| `INTEGRATION_NOT_FOUND` | The requested `integrationId` is not registered |
| `TOOL_NOT_FOUND` | The requested `toolName` does not exist on the integration |
| `EXECUTION_FAILED` | Tool execution threw an error |
| `TIMEOUT` | Tool execution exceeded the timeout |

## Versioning

The `version_changed` message includes `mcpVersion` and `skillsVersion` fields. These are content hashes (first 16 hex characters of a SHA-256 digest) computed over the integrations for each subsystem using stable JSON serialization.

- **`mcpVersion`** covers all MCP tool integrations. Changes when tools are added, removed, or modified.
- **`skillsVersion`** covers skills. Changes when skill files are added, removed, or edited.
- Either field is `null` when the corresponding subsystem has no integrations.

Version hashes are the **primary signal** for change detection. The service uses them to decide whether to pull updated tools or skills. Same content produces the same hash across restarts — there are no false positives from gateway restarts alone.

## Security Invariants

1. **Outbound-only connections.** The gateway initiates all connections. No inbound ports required.
2. **Credentials stay local.** Database passwords, API tokens, and other secrets are configured on the gateway and never transmitted to Journal.
3. **Read-only default.** Integrations should default to read-only access where possible.
4. **Token-based auth.** Gateway tokens (`gw_*`) are scoped to a single organization.
5. **TLS required.** Production connections must use `wss://`.
