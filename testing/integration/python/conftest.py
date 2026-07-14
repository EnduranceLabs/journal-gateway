import asyncio
import os
import subprocess

import pytest_asyncio

from journal_gateway_client import GatewayServer, TokenValidationResult

GATEWAY_BIN = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "gateway", "dist", "main.js"
)


async def _validate_token(token: str) -> TokenValidationResult | None:
    if token == "gw_test":
        return TokenValidationResult(organization_id="org_1")
    return None


@pytest_asyncio.fixture
async def server_and_gateway():
    """Start Python client server + real TS gateway."""
    server = GatewayServer(validate_token=_validate_token, port=0, ping_interval=0)
    await server.start()

    proc = subprocess.Popen(
        ["node", GATEWAY_BIN],
        env={
            **os.environ,
            "JOURNAL_GATEWAY_TOKEN": "gw_test",
            "JOURNAL_GATEWAY_URL": server.url,
            "JOURNAL_GATEWAY_CONFIG": "{}",
            "LOG_LEVEL": "error",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for gateway to connect (up to 10s)
    for _ in range(100):
        if server.connected_gateways:
            break
        await asyncio.sleep(0.1)

    yield server

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    await server.stop()
