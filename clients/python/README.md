# journal-gateway-client

[![PyPI](https://img.shields.io/pypi/v/journal-gateway-client)](https://pypi.org/project/journal-gateway-client/)

Python client library for the Journal Gateway protocol. Runs a WebSocket server that gateways connect to, authenticates them, auto-pulls their tools and skills, and lets you call tools.

## Install

```bash
pip install journal-gateway-client
```

## Usage

```python
import asyncio
from journal_gateway_client import GatewayServer, TokenValidationResult


async def validate_token(token: str) -> TokenValidationResult | None:
    # Return a TokenValidationResult on success, None on failure
    if token == "gw_valid":
        return TokenValidationResult(organization_id="org_123")
    return None


async def main() -> None:
    server = GatewayServer(validate_token=validate_token, port=8080)

    server.on_gateway_connected = lambda gw: print("connected:", gw.id, gw.integrations)
    server.on_gateway_updated = lambda gw: print("tools/skills changed:", gw.id)
    server.on_gateway_disconnected = lambda gw: print("disconnected:", gw.id)

    await server.start()

    # Call a tool on a connected gateway
    result = await server.call_tool("postgresql", "execute_sql", {"sql": "SELECT 1"})
    print(result.content)

    await server.stop()


asyncio.run(main())
```

## Key APIs

- **`start()` / `stop()`** — lifecycle
- **`call_tool(integration_id, tool_name, arguments, timeout=60.0)`** — execute a tool call on any gateway that provides the integration
- **`call_tool_for_org(organization_id, integration_id, tool_name, arguments, timeout=90.0)`** — same, scoped to an organization with automatic load balancing and retry on a different gateway
- **`get_tools_for_org(organization_id)`** — list deduplicated tools across all gateways for an org
- **`get_versions(gateway_id)` / `get_tools(gateway_id)` / `get_skills(gateway_id)`** — explicit pulls from a specific gateway
- **`connected_gateways`** — all currently connected gateways

## Callbacks

Set these attributes on the server instance:

- **`on_gateway_connected(gateway)`** — fired after a gateway authenticates and its initial tools/skills are pulled
- **`on_gateway_updated(gateway)`** — fired when a gateway's tools or skills change at runtime
- **`on_gateway_disconnected(gateway)`** — fired when a gateway disconnects

## Telemetry

The library has no telemetry dependency of its own. Two constructor arguments let you
wire it into your logging/tracing stack:

- **`get_trace_context`** — called on every `call_tool`. Return the active W3C trace
  context as `{"traceparent": ..., "tracestate": ...}` and it is propagated on the
  `tool_call` message; the gateway parents its `gateway.tool_call` span onto it, so the
  remote tool execution appears in your distributed trace. Return `None` when there is
  no active span.
- **`on_socket_error(error, gateway)`** — called when a gateway socket drops abnormally
  (e.g. a connection reset). `gateway` is `None` if the socket errored before completing
  the handshake. If the gateway had connected, `on_gateway_disconnected` fires as usual.
  When not provided, unexpected connection errors fall back to the `journal_gateway_client`
  logger — bind this callback if you want to route them into your own error tracking.

Example wiring with OpenTelemetry and a logger:

```python
from opentelemetry import propagate

def trace_context():
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    if "traceparent" not in carrier:
        return None
    return {"traceparent": carrier["traceparent"], "tracestate": carrier.get("tracestate")}

server = GatewayServer(
    validate_token=validate_token,
    port=8080,
    get_trace_context=trace_context,
    on_socket_error=lambda err, gw: logger.error(
        "gateway socket error", exc_info=err, extra={"gateway_id": gw.id if gw else None}
    ),
)
```

## Full documentation

See the [root README](https://github.com/EnduranceLabs/journal-gateway#readme) for protocol details, gateway configuration, and architecture.

## License

MIT
