# journal-gateway-client

[![PyPI](https://img.shields.io/pypi/v/journal-gateway-client)](https://pypi.org/project/journal-gateway-client/)

Python service-side library for the Journal Gateway protocol. Use this package
in the service that accepts gateway WebSocket connections, validates gateway
tokens, receives tool and skill catalogs, and calls tools on connected gateways.

If you want to run the customer-side gateway process, install the npm package
`journal-gateway` instead.

## Install

Requires Python 3.11 or newer.

```bash
pip install journal-gateway-client
```

## Quick Start

```python
import asyncio
import os

from journal_gateway_client import GatewayServer, TokenValidationResult


async def validate_token(token: str) -> TokenValidationResult | None:
    if token == os.environ["JOURNAL_GATEWAY_TOKEN"]:
        return TokenValidationResult(organization_id="org_123")
    return None


async def main() -> None:
    server = GatewayServer(validate_token=validate_token, port=8080)

    server.on_gateway_connected = lambda gateway: print(
        "gateway connected", gateway.id, gateway.organization_id
    )
    server.on_gateway_updated = lambda gateway: print(
        "gateway catalog updated", gateway.id
    )
    server.on_gateway_disconnected = lambda gateway: print(
        "gateway disconnected", gateway.id
    )

    await server.start()

    # After a gateway for org_123 connects and publishes the postgresql integration:
    result = await server.call_tool_for_org(
        "org_123",
        "postgresql",
        "execute_sql",
        {"sql": "SELECT 1"},
    )
    print(result.content)

    await server.stop()


asyncio.run(main())
```

The library never prints to stdout by itself. Route callbacks into your own
logger, metrics, and tracing stack. If `on_socket_error` is not provided,
unexpected connection errors go to the `journal_gateway_client` logger, which is
silent by default unless your application configures logging.

## Key APIs

- `start()` / `stop()`: start or stop the WebSocket server.
- `call_tool(integration_id, tool_name, arguments, timeout=60.0)`: call a tool
  on any connected gateway that exposes the integration.
- `call_tool_for_org(organization_id, integration_id, tool_name, arguments,
  timeout=90.0)`: call a tool for one organization, with candidate gateway
  selection and retry on connection-level failure.
- `get_tools_for_org(organization_id)`: list deduplicated tools for an
  organization.
- `get_versions(gateway_id)`, `get_tools(gateway_id)`, `get_skills(gateway_id)`:
  explicitly pull catalog data from a specific gateway.
- `connected_gateways`: inspect currently connected gateways.

## Callbacks

Set these attributes on the server instance:

- `on_gateway_connected(gateway)`: fired after authentication and initial
  catalog pull.
- `on_gateway_updated(gateway)`: fired when MCP tools or skills change.
- `on_gateway_disconnected(gateway)`: fired after a connected gateway
  disconnects.

Constructor callbacks:

- `get_trace_context`: returns W3C trace context for each tool call.
- `on_socket_error(error, gateway | None)`: receives socket-level failures and
  unexpected connection-handler failures.

## Trace Propagation

```python
from opentelemetry import propagate


def get_trace_context() -> dict[str, str] | None:
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    if "traceparent" not in carrier:
        return None
    return {
        "traceparent": carrier["traceparent"],
        "tracestate": carrier.get("tracestate"),
    }


def on_socket_error(error: Exception, gateway) -> None:
    logger.error(
        "gateway socket error",
        exc_info=error,
        extra={"gateway_id": gateway.id if gateway else None},
    )


server = GatewayServer(
    validate_token=validate_token,
    port=8080,
    get_trace_context=get_trace_context,
    on_socket_error=on_socket_error,
)
```

`get_trace_context` is called for each tool call. The returned W3C trace context
is sent to the gateway and used as the parent for remote tool execution spans.

## Version Compatibility

Journal Gateway packages release in lockstep. Use matching versions of:

- npm `journal-gateway`
- npm `journal-gateway-client` for TypeScript services
- npm `journal-gateway-protocol`
- PyPI `journal-gateway-client` for Python services

## More Documentation

- [Full README](https://github.com/EnduranceLabs/journal-gateway#readme)
- [Protocol spec](https://github.com/EnduranceLabs/journal-gateway/blob/main/spec/protocol.md)
- [Gateway npm package](https://www.npmjs.com/package/journal-gateway)

## License

MIT
