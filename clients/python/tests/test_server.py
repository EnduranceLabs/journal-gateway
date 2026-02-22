from __future__ import annotations

import asyncio
import json

import pytest
import pytest_asyncio
import websockets

from journal_gateway_client import (
    GatewayServer,
    TokenValidationResult,
    ConnectedGateway,
)


async def _validate_token(token: str) -> TokenValidationResult | None:
    if token == "gw_valid":
        return TokenValidationResult(
            organization_id="org_1",
            organization_name="Test Org",
        )
    return None


@pytest_asyncio.fixture
async def server():
    srv = GatewayServer(
        validate_token=_validate_token,
        port=0,
        ping_interval=0,
    )
    await srv.start()
    yield srv
    await srv.stop()


async def connect_and_auth(url: str, token: str) -> websockets.asyncio.client.ClientConnection:
    """Connect a mock gateway and authenticate."""
    ws = await websockets.connect(url, ping_interval=None, ping_timeout=None)
    await ws.send(json.dumps({
        "type": "authenticate",
        "token": token,
        "protocolVersion": 1,
        "gatewayVersion": "0.1.0-test",
    }))
    raw = await ws.recv()
    msg = json.loads(raw)
    if msg["type"] == "auth_error":
        await ws.close()
        raise RuntimeError(f"Auth failed: {msg['error']}")
    assert msg["type"] == "authenticated"
    return ws


async def register(ws: websockets.asyncio.client.ClientConnection, integrations: list | None = None) -> None:
    """Register integrations on a mock gateway."""
    await ws.send(json.dumps({
        "type": "register",
        "integrations": integrations or [],
    }))
    raw = await ws.recv()
    msg = json.loads(raw)
    assert msg["type"] == "registered"


TEST_INTEGRATION = {
    "id": "test-integration",
    "name": "Test",
    "description": "Test integration",
    "tools": [
        {"name": "echo", "description": "Echo tool", "inputSchema": {}},
        {"name": "fail", "description": "Fail tool", "inputSchema": {}},
    ],
}


@pytest.mark.asyncio
async def test_accepts_valid_token(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await register(ws)
    assert len(server.connected_gateways) == 1
    assert server.connected_gateways[0].protocol_version == 1
    assert server.connected_gateways[0].gateway_version == "0.1.0-test"
    await ws.close()


@pytest.mark.asyncio
async def test_rejects_invalid_token(server: GatewayServer):
    with pytest.raises(RuntimeError, match="Auth failed"):
        await connect_and_auth(server.url, "gw_invalid")


@pytest.mark.asyncio
async def test_call_tool_returns_result(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await register(ws, [TEST_INTEGRATION])

    async def handle_calls():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "tool_call":
                await ws.send(json.dumps({
                    "type": "tool_result",
                    "requestId": msg["requestId"],
                    "result": {
                        "content": [{
                            "type": "text",
                            "text": f"echo: {json.dumps(msg['arguments'])}",
                        }],
                    },
                }))

    handler = asyncio.create_task(handle_calls())

    result = await server.call_tool("test-integration", "echo", {"hello": "world"})
    assert len(result.content) == 1
    assert result.content[0].text == 'echo: {"hello": "world"}'

    handler.cancel()
    await ws.close()


@pytest.mark.asyncio
async def test_call_tool_returns_error(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await register(ws, [TEST_INTEGRATION])

    async def handle_calls():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "tool_call":
                await ws.send(json.dumps({
                    "type": "tool_error",
                    "requestId": msg["requestId"],
                    "error": {
                        "code": "EXECUTION_FAILED",
                        "message": "Something went wrong",
                    },
                }))

    handler = asyncio.create_task(handle_calls())

    with pytest.raises(RuntimeError, match="EXECUTION_FAILED.*Something went wrong"):
        await server.call_tool("test-integration", "fail", {})

    handler.cancel()
    await ws.close()


@pytest.mark.asyncio
async def test_call_tool_no_gateway(server: GatewayServer):
    with pytest.raises(LookupError, match="No gateway has integration"):
        await server.call_tool("nonexistent", "tool", {})


@pytest.mark.asyncio
async def test_disconnection_fires_callback(server: GatewayServer):
    disconnected: list[ConnectedGateway] = []
    server.on_gateway_disconnected = lambda gw: disconnected.append(gw)

    ws = await connect_and_auth(server.url, "gw_valid")
    await register(ws)
    assert len(server.connected_gateways) == 1

    await ws.close()
    await asyncio.sleep(0.1)
    assert len(disconnected) == 1
    assert len(server.connected_gateways) == 0


@pytest.mark.asyncio
async def test_concurrent_tool_calls(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await register(ws, [TEST_INTEGRATION])

    async def handle_calls():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "tool_call":
                await asyncio.sleep(0.01)
                await ws.send(json.dumps({
                    "type": "tool_result",
                    "requestId": msg["requestId"],
                    "result": {
                        "content": [{
                            "type": "text",
                            "text": f"result-{msg['arguments']['id']}",
                        }],
                    },
                }))

    handler = asyncio.create_task(handle_calls())

    r1, r2, r3 = await asyncio.gather(
        server.call_tool("test-integration", "echo", {"id": 1}),
        server.call_tool("test-integration", "echo", {"id": 2}),
        server.call_tool("test-integration", "echo", {"id": 3}),
    )

    assert r1.content[0].text == "result-1"
    assert r2.content[0].text == "result-2"
    assert r3.content[0].text == "result-3"

    handler.cancel()
    await ws.close()
