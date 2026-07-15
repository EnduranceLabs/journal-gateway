import asyncio
import subprocess
import os

import pytest

from journal_gateway_client import GatewayServer, TokenValidationResult


GATEWAY_BIN = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "gateway", "dist", "main.js"
)


@pytest.mark.asyncio
async def test_gateway_connects(server_and_gateway):
    server = server_and_gateway
    assert len(server.connected_gateways) == 1
    assert len(server.connected_gateways[0].integrations) == 0


@pytest.mark.asyncio
async def test_gateway_version_info(server_and_gateway):
    server = server_and_gateway
    gw = server.connected_gateways[0]
    assert gw.protocol_version == 2
    assert gw.gateway_version  # should be non-empty


@pytest.mark.asyncio
async def test_gateway_versions_null_with_no_config(server_and_gateway):
    server = server_and_gateway
    gw = server.connected_gateways[0]
    assert gw.mcp_version is None
    assert gw.skills_version is None


@pytest.mark.asyncio
async def test_pull_versions(server_and_gateway):
    server = server_and_gateway
    gw = server.connected_gateways[0]
    versions = await server.get_versions(gw.id)
    assert versions["mcpVersion"] is None
    assert versions["skillsVersion"] is None


@pytest.mark.asyncio
async def test_rejects_invalid_token():
    async def validate(token: str) -> TokenValidationResult | None:
        if token == "gw_test":
            return TokenValidationResult(organization_id="org_1")
        return None

    server = GatewayServer(validate_token=validate, port=0, ping_interval=0)
    await server.start()

    proc = subprocess.Popen(
        ["node", GATEWAY_BIN],
        env={
            **os.environ,
            "JOURNAL_GATEWAY_TOKEN": "gw_wrong",
            "JOURNAL_GATEWAY_URL": server.url,
            "JOURNAL_GATEWAY_CONFIG": "{}",
            "LOG_LEVEL": "error",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Poll without blocking the event loop, so the in-process server can
    # process the connection and reject the token.
    try:
        code = None
        for _ in range(100):
            code = proc.poll()
            if code is not None:
                break
            await asyncio.sleep(0.1)
        if code is None:
            proc.kill()
            pytest.fail("Gateway did not exit after invalid token")
        assert code != 0
    finally:
        await server.stop()


@pytest.mark.asyncio
async def test_detects_disconnect():
    async def validate(token: str) -> TokenValidationResult | None:
        return TokenValidationResult(organization_id="org_1") if token == "gw_test" else None

    server = GatewayServer(validate_token=validate, port=0, ping_interval=0)
    disconnected = asyncio.Event()
    server.on_gateway_disconnected = lambda _gw: disconnected.set()
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
    try:
        for _ in range(100):
            if server.connected_gateways:
                break
            await asyncio.sleep(0.1)
        assert len(server.connected_gateways) == 1

        proc.terminate()
        await asyncio.wait_for(disconnected.wait(), timeout=10)
        assert len(server.connected_gateways) == 0
    finally:
        if proc.poll() is None:
            proc.kill()
        await server.stop()
