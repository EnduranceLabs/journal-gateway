"""Minimal Journal Gateway client server (Python).

    pip install journal-gateway-client
    python client_server.py

Then point a gateway at ws://localhost:8080 with token "gw_demo":

    JOURNAL_GATEWAY_TOKEN=gw_demo \\
    JOURNAL_GATEWAY_URL=ws://localhost:8080 \\
    journal-gateway --config gateway.json
"""

import asyncio

from journal_gateway_client import GatewayServer, TokenValidationResult


async def validate_token(token: str) -> TokenValidationResult | None:
    if token == "gw_demo":
        return TokenValidationResult(organization_id="org_demo")
    return None


def on_connected(gateway) -> None:
    print(f"gateway {gateway.id} connected")
    for integration in gateway.integrations:
        print(f"  {integration.id}: {len(integration.tools)} tools")


async def main() -> None:
    server = GatewayServer(validate_token=validate_token, port=8080)
    server.on_gateway_connected = on_connected
    server.on_gateway_disconnected = lambda gw: print(f"gateway {gw.id} disconnected")

    await server.start()
    print("listening on ws://localhost:8080")
    await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
