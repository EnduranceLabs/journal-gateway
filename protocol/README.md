# Journal Gateway Protocol Specification

Version: `1`

## Overview

The Journal Gateway Protocol defines communication between a customer-deployed **Gateway** and the **Journal Service** over WebSocket. The gateway connects outbound to Journal — customer credentials and data sources never leave the customer's network.

## Transport

- **Protocol:** WebSocket (`wss://`)
- **Endpoint:** `wss://gateway.journal.one/v1`
- **Direction:** Outbound from gateway to service (gateway initiates)
- **Encoding:** JSON (UTF-8)
- **Framing:** Each WebSocket text frame contains exactly one JSON message

## Connection Lifecycle

```
Gateway                                  Service
  │                                         │
  │──── WebSocket Connect ─────────────────>│
  │                                         │
  │──── authenticate ──────────────────────>│
  │<─── authenticated / auth_error ────────│
  │                                         │
  │──── register ──────────────────────────>│
  │<─── registered ────────────────────────│
  │                                         │
  │          ┌── Steady State ──┐           │
  │          │                  │           │
  │<──────── │ tool_call ───────│──────────│
  │──────── │ tool_result ─────│─────────>│
  │          │ (or tool_error)  │           │
  │          │                  │           │
  │<──────── │ ping ────────────│──────────│
  │──────── │ pong ────────────│─────────>│
  │          │                  │           │
  │          └──────────────────┘           │
  │                                         │
```

## Message Types

All messages are JSON objects with a `type` field used as a discriminator.

### Gateway → Service

#### `authenticate`

Sent immediately after WebSocket connection opens.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"authenticate"` | yes | Message discriminator |
| `token` | `string` | yes | Gateway auth token (`gw_*` prefix) |
| `protocolVersion` | `number` | yes | Protocol version (currently `1`) |
| `gatewayVersion` | `string` | yes | Gateway software version (semver) |

#### `register`

Sent after successful authentication. Declares all available skills and their tools.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"register"` | yes | Message discriminator |
| `skills` | `SkillRegistration[]` | yes | Array of skill registrations |

See [skills.schema.json](./schemas/skills.schema.json) for `SkillRegistration` definition.

#### `tool_result`

Sent in response to a `tool_call`. Contains the successful execution result.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tool_result"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the original `tool_call.requestId` |
| `result` | `ToolResult` | yes | Execution result with content blocks |

#### `tool_error`

Sent in response to a `tool_call` when execution fails.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tool_error"` | yes | Message discriminator |
| `requestId` | `string` | yes | Correlates with the original `tool_call.requestId` |
| `error` | `GatewayError` | yes | Error code and message |

#### `pong`

Sent in response to a `ping`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"pong"` | yes | Message discriminator |

### Service → Gateway

#### `authenticated`

Sent after successful authentication.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"authenticated"` | yes | Message discriminator |
| `organizationId` | `string` | yes | Organization ID |
| `organizationName` | `string` | no | Organization display name |

#### `auth_error`

Sent when authentication fails.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"auth_error"` | yes | Message discriminator |
| `error` | `string` | yes | Error description |

#### `registered`

Sent after successful skill registration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"registered"` | yes | Message discriminator |
| `skillCount` | `number` | yes | Number of registered skills |
| `toolCount` | `number` | yes | Total number of registered tools |

#### `tool_call`

Sent to invoke a tool on a registered skill.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"tool_call"` | yes | Message discriminator |
| `requestId` | `string` | yes | Unique request ID for correlation |
| `skillId` | `string` | yes | Target skill identifier |
| `toolName` | `string` | yes | Tool name within the skill |
| `arguments` | `object` | yes | Tool input arguments |

#### `ping`

Heartbeat sent by the service.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"ping"` | yes | Message discriminator |

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
- **Jitter:** ±25% randomization on each delay
- **Reset:** Backoff resets to initial delay after a successful connection (authenticated + registered)

## Concurrent Tool Calls

Multiple `tool_call` messages may be in flight simultaneously. Each has a unique `requestId` that must be echoed in the corresponding `tool_result` or `tool_error` response. The gateway must handle concurrent calls and may process them in any order.

## Error Codes

| Code | Description |
|------|-------------|
| `SKILL_NOT_FOUND` | The requested `skillId` is not registered |
| `TOOL_NOT_FOUND` | The requested `toolName` does not exist on the skill |
| `EXECUTION_FAILED` | Tool execution threw an error |
| `TIMEOUT` | Tool execution exceeded the timeout |

See [errors.schema.json](./schemas/errors.schema.json) for the full error type definition.

## Security Invariants

1. **Outbound-only connections:** The gateway initiates all connections. No inbound ports required.
2. **Credentials stay local:** Database passwords, API tokens, and other secrets are configured on the gateway and never transmitted to Journal.
3. **Read-only default:** Skills should default to read-only access where possible.
4. **Token-based auth:** Gateway tokens (`gw_*`) are scoped to a single organization.
5. **TLS required:** Production connections must use `wss://`.
