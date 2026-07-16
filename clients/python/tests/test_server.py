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
    if token == "gw_org2":
        return TokenValidationResult(
            organization_id="org_2",
            organization_name="Other Org",
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
        "protocolVersion": 2,
        "gatewayVersion": "0.1.0-test",
    }))
    raw = await ws.recv()
    msg = json.loads(raw)
    if msg["type"] == "auth_error":
        await ws.close()
        raise RuntimeError(f"Auth failed: {msg['error']}")
    assert msg["type"] == "authenticated"
    return ws


async def send_version_changed(
    ws: websockets.asyncio.client.ClientConnection,
    integrations: list | None = None,
    mcp_version: str | None = None,
    skills_version: str | None = None,
    skills: list | None = None,
) -> None:
    """Send version_changed and handle pull requests from the server."""
    integ = integrations or []
    mcp_v = mcp_version if mcp_version is not None else ("abc123" if integ else None)
    skills_v = skills_version
    sk = skills or []

    await ws.send(json.dumps({
        "type": "version_changed",
        "mcpVersion": mcp_v,
        "skillsVersion": skills_v,
    }))

    # Handle pull requests from the server
    pulls_expected = (1 if mcp_v else 0) + (1 if skills_v else 0)
    pulls_done = 0

    while pulls_done < pulls_expected:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
        except asyncio.TimeoutError:
            break
        msg = json.loads(raw)
        if msg["type"] == "get_tools":
            await ws.send(json.dumps({
                "type": "tools",
                "requestId": msg["requestId"],
                "integrations": integ,
                "mcpVersion": mcp_v,
            }))
            pulls_done += 1
        elif msg["type"] == "get_skills":
            await ws.send(json.dumps({
                "type": "skills",
                "requestId": msg["requestId"],
                "skills": sk,
                "skillsVersion": skills_v,
            }))
            pulls_done += 1

    # Give the server time to process (version_changed is fire-and-forget)
    await asyncio.sleep(0.05)


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
    await send_version_changed(ws)
    assert len(server.connected_gateways) == 1
    assert server.connected_gateways[0].organization_id == "org_1"
    assert server.connected_gateways[0].protocol_version == 2
    assert server.connected_gateways[0].gateway_version == "0.1.0-test"
    await ws.close()


@pytest.mark.asyncio
async def test_rejects_invalid_token(server: GatewayServer):
    with pytest.raises(RuntimeError, match="Auth failed"):
        await connect_and_auth(server.url, "gw_invalid")


@pytest.mark.asyncio
async def test_call_tool_returns_result(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION])

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
    await send_version_changed(ws, [TEST_INTEGRATION])

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
    await send_version_changed(ws)
    assert len(server.connected_gateways) == 1

    await ws.close()
    await asyncio.sleep(0.1)
    assert len(disconnected) == 1
    assert len(server.connected_gateways) == 0


@pytest.mark.asyncio
async def test_concurrent_tool_calls(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION])

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


@pytest.mark.asyncio
async def test_available_tools(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION])

    assert server.available_tools == [
        {"integrationId": "test-integration", "name": "echo", "description": "Echo tool"},
        {"integrationId": "test-integration", "name": "fail", "description": "Fail tool"},
    ]
    await ws.close()


@pytest.mark.asyncio
async def test_version_changed_triggers_auto_pull(server: GatewayServer):
    connected: list[ConnectedGateway] = []
    server.on_gateway_connected = lambda gw: connected.append(gw)

    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION], mcp_version="v1")

    assert len(connected) == 1
    assert len(connected[0].integrations) == 1
    assert len(connected[0].integrations[0].tools) == 2
    assert connected[0].mcp_version == "v1"
    await ws.close()


@pytest.mark.asyncio
async def test_subsequent_version_changed_fires_updated(server: GatewayServer):
    updated_gateways: list[ConnectedGateway] = []
    server.on_gateway_updated = lambda gw: updated_gateways.append(gw)

    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION], mcp_version="v1")

    # Send another version_changed with updated tools
    updated_integration = {
        **TEST_INTEGRATION,
        "tools": TEST_INTEGRATION["tools"] + [
            {"name": "new_tool", "description": "New tool", "inputSchema": {}},
        ],
    }
    await send_version_changed(ws, [updated_integration], mcp_version="v2")

    assert len(updated_gateways) == 1
    gw = server.connected_gateways[0]
    assert len(gw.integrations[0].tools) == 3
    assert gw.mcp_version == "v2"
    await ws.close()


@pytest.mark.asyncio
async def test_has_gateway_for_org(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws)

    assert server.has_gateway_for_org("org_1") is True
    assert server.has_gateway_for_org("org_nonexistent") is False
    await ws.close()


@pytest.mark.asyncio
async def test_get_gateways_for_org(server: GatewayServer):
    ws1 = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws1, [TEST_INTEGRATION])

    ws2 = await connect_and_auth(server.url, "gw_org2")
    await send_version_changed(ws2, [TEST_INTEGRATION])

    org1_gateways = server.get_gateways_for_org("org_1")
    assert len(org1_gateways) == 1
    assert org1_gateways[0].organization_id == "org_1"

    org2_gateways = server.get_gateways_for_org("org_2")
    assert len(org2_gateways) == 1
    assert org2_gateways[0].organization_id == "org_2"

    assert server.get_gateways_for_org("org_nonexistent") == []

    await ws1.close()
    await ws2.close()


@pytest.mark.asyncio
async def test_get_tools_for_org(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION])

    tools = server.get_tools_for_org("org_1")
    assert len(tools) == 2
    assert tools[0]["integrationId"] == "test-integration"
    assert tools[0]["tool"].name == "echo"
    assert tools[1]["tool"].name == "fail"

    assert server.get_tools_for_org("org_nonexistent") == []
    await ws.close()


@pytest.mark.asyncio
async def test_get_tools_for_org_deduplicates(server: GatewayServer):
    """Two gateways for the same org with the same integration should deduplicate tools."""
    ws1 = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws1, [TEST_INTEGRATION])

    ws2 = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws2, [TEST_INTEGRATION])

    tools = server.get_tools_for_org("org_1")
    assert len(tools) == 2  # deduplicated, not 4
    await ws1.close()
    await ws2.close()


@pytest.mark.asyncio
async def test_call_tool_for_org(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION])

    async def handle_calls():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "tool_call":
                await ws.send(json.dumps({
                    "type": "tool_result",
                    "requestId": msg["requestId"],
                    "result": {
                        "content": [{"type": "text", "text": "org-result"}],
                    },
                }))

    handler = asyncio.create_task(handle_calls())

    result = await server.call_tool_for_org("org_1", "test-integration", "echo", {})
    assert result.content[0].text == "org-result"

    handler.cancel()
    await ws.close()


@pytest.mark.asyncio
async def test_call_tool_for_org_no_match(server: GatewayServer):
    with pytest.raises(LookupError, match="No gateway for org"):
        await server.call_tool_for_org("org_nonexistent", "test-integration", "echo", {})


@pytest.mark.asyncio
async def test_connected_gateway_has_version_fields(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION], mcp_version="abc123", skills_version="def456",
                               skills=[{"id": "review", "content": "Review PR..."}])

    gw = server.connected_gateways[0]
    assert gw.mcp_version == "abc123"
    assert gw.skills_version == "def456"
    await ws.close()


@pytest.mark.asyncio
async def test_connected_gateway_null_versions_by_default(server: GatewayServer):
    ws = await connect_and_auth(server.url, "gw_valid")
    await send_version_changed(ws)
    gw = server.connected_gateways[0]
    assert gw.mcp_version is None
    assert gw.skills_version is None
    await ws.close()


@pytest.mark.asyncio
async def test_pong_timeout_disconnects_gateway():
    """Gateway that doesn't respond to pings should be disconnected."""
    srv = GatewayServer(
        validate_token=_validate_token,
        port=0,
        ping_interval=0.1,
        pong_timeout=0.15,
    )
    await srv.start()

    disconnected: list[ConnectedGateway] = []
    srv.on_gateway_disconnected = lambda gw: disconnected.append(gw)

    # Connect but never respond to pings
    ws = await websockets.connect(srv.url, ping_interval=None, ping_timeout=None)
    await ws.send(json.dumps({
        "type": "authenticate",
        "token": "gw_valid",
        "protocolVersion": 2,
        "gatewayVersion": "0.1.0-test",
    }))
    msg = json.loads(await ws.recv())
    assert msg["type"] == "authenticated"

    await ws.send(json.dumps({
        "type": "version_changed",
        "mcpVersion": None,
        "skillsVersion": None,
    }))

    # Wait for the gateway to be connected
    await asyncio.sleep(0.1)
    assert len(srv.connected_gateways) == 1

    # Wait for ping + pong timeout to fire
    await asyncio.sleep(0.5)

    assert len(srv.connected_gateways) == 0
    assert len(disconnected) == 1

    await srv.stop()


@pytest.mark.asyncio
async def test_get_trace_context_propagates_to_tool_call():
    """traceparent/tracestate from get_trace_context ride on the tool_call."""
    srv = GatewayServer(
        validate_token=_validate_token,
        port=0,
        ping_interval=0,
        get_trace_context=lambda: {
            "traceparent": "00-abc-def-01",
            "tracestate": "vendor=1",
        },
    )
    await srv.start()

    ws = await connect_and_auth(srv.url, "gw_valid")
    await send_version_changed(ws, [TEST_INTEGRATION])

    seen: dict = {}

    async def handle_calls():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "tool_call":
                seen.update(msg)
                await ws.send(json.dumps({
                    "type": "tool_result",
                    "requestId": msg["requestId"],
                    "result": {"content": [{"type": "text", "text": "ok"}]},
                }))

    handler = asyncio.create_task(handle_calls())
    await srv.call_tool("test-integration", "echo", {})

    assert seen["traceparent"] == "00-abc-def-01"
    assert seen["tracestate"] == "vendor=1"

    handler.cancel()
    await ws.close()
    await srv.stop()


@pytest.mark.asyncio
async def test_on_socket_error_fires_on_abnormal_close():
    """A gateway socket that drops abruptly surfaces via on_socket_error."""
    errors: list[tuple] = []
    srv = GatewayServer(
        validate_token=_validate_token,
        port=0,
        ping_interval=0,
        on_socket_error=lambda err, gw: errors.append((err, gw)),
    )
    await srv.start()

    ws = await connect_and_auth(srv.url, "gw_valid")
    await send_version_changed(ws)
    assert len(srv.connected_gateways) == 1

    # Abrupt transport failure (not a clean close handshake).
    ws.transport.close()
    await asyncio.sleep(0.1)

    assert len(errors) == 1
    err, gw = errors[0]
    assert gw is not None and gw.organization_id == "org_1"

    await srv.stop()


@pytest.mark.asyncio
async def test_on_socket_error_ignores_protocol_handler_errors():
    """Protocol/handler bugs should not be reported as socket failures."""
    errors: list[tuple] = []
    disconnected: list[ConnectedGateway] = []
    srv = GatewayServer(
        validate_token=_validate_token,
        port=0,
        ping_interval=0,
        on_socket_error=lambda err, gw: errors.append((err, gw)),
    )
    srv.on_gateway_disconnected = lambda gw: disconnected.append(gw)
    await srv.start()

    ws = await connect_and_auth(srv.url, "gw_valid")
    await send_version_changed(ws)
    assert len(srv.connected_gateways) == 1

    await ws.send("not-json")
    await asyncio.sleep(0.1)

    assert errors == []
    assert len(disconnected) == 1
    assert len(srv.connected_gateways) == 0

    await srv.stop()
