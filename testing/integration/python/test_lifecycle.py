import pytest


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
