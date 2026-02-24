from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from typing import Callable, Awaitable

import websockets
from websockets.asyncio.server import serve

from .types import (
    Integration,
    ToolDefinition,
    Skill,
    ToolResult,
    GatewayError,
    ConnectedGateway,
    TextContent,
    ImageContent,
)

logger = logging.getLogger("journal_gateway_client")


@dataclass
class TokenValidationResult:
    organization_id: str
    organization_name: str | None = None


TokenValidator = Callable[[str], Awaitable[TokenValidationResult | None]]


class _GatewayConn:
    """Internal wrapper for a single gateway WebSocket connection."""

    def __init__(self, ws: websockets.asyncio.server.ServerConnection, info: ConnectedGateway):
        self.ws = ws
        self.info = info
        self.pending: dict[str, asyncio.Future[ToolResult]] = {}
        self.pong_received: asyncio.Event = asyncio.Event()
        self._next_id = 0

    async def call_tool(
        self,
        integration_id: str,
        tool_name: str,
        arguments: dict,
        timeout: float,
    ) -> ToolResult:
        self._next_id += 1
        request_id = f"req_{self._next_id}"

        loop = asyncio.get_running_loop()
        future: asyncio.Future[ToolResult] = loop.create_future()
        self.pending[request_id] = future

        msg = json.dumps({
            "type": "tool_call",
            "requestId": request_id,
            "integrationId": integration_id,
            "toolName": tool_name,
            "arguments": arguments,
        })
        await self.ws.send(msg)

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self.pending.pop(request_id, None)
            raise TimeoutError(f"Tool call timed out after {timeout}s")

    def resolve_result(self, request_id: str, result: ToolResult) -> None:
        future = self.pending.pop(request_id, None)
        if future and not future.done():
            future.set_result(result)

    def resolve_error(self, request_id: str, error: GatewayError) -> None:
        future = self.pending.pop(request_id, None)
        if future and not future.done():
            future.set_exception(
                RuntimeError(f"Tool error [{error.code}]: {error.message}")
            )

    def reject_all(self, reason: str) -> None:
        for future in self.pending.values():
            if not future.done():
                future.set_exception(RuntimeError(reason))
        self.pending.clear()


class GatewayServer:
    """WebSocket server that accepts gateway connections and provides a tool-calling API."""

    def __init__(
        self,
        validate_token: TokenValidator,
        host: str = "0.0.0.0",
        port: int = 0,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
    ):
        self._validate_token = validate_token
        self._host = host
        self._port = port
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._server: websockets.asyncio.server.Server | None = None
        self._gateways: dict[str, _GatewayConn] = {}
        self._next_id = 0
        self.on_gateway_connected: Callable[[ConnectedGateway], None] | None = None
        self.on_gateway_updated: Callable[[ConnectedGateway], None] | None = None
        self.on_gateway_disconnected: Callable[[ConnectedGateway], None] | None = None

    @property
    def port(self) -> int:
        return self._port

    @property
    def url(self) -> str:
        return f"ws://localhost:{self._port}"

    @property
    def connected_gateways(self) -> list[ConnectedGateway]:
        return [g.info for g in self._gateways.values()]

    @property
    def available_tools(self) -> list[dict[str, str]]:
        tools: list[dict[str, str]] = []
        for gw in self._gateways.values():
            for integration in gw.info.integrations:
                for tool in integration.tools:
                    tools.append({
                        "integrationId": integration.id,
                        "name": tool.name,
                        "description": tool.description,
                    })
        return tools

    def has_gateway_for_org(self, organization_id: str) -> bool:
        return any(
            gw.info.organization_id == organization_id
            for gw in self._gateways.values()
        )

    def get_gateways_for_org(self, organization_id: str) -> list[ConnectedGateway]:
        return [
            gw.info
            for gw in self._gateways.values()
            if gw.info.organization_id == organization_id
        ]

    def get_tools_for_org(
        self, organization_id: str
    ) -> list[dict]:
        seen: set[str] = set()
        tools: list[dict] = []
        for gw in self._gateways.values():
            if gw.info.organization_id != organization_id:
                continue
            for integration in gw.info.integrations:
                for tool in integration.tools:
                    key = f"{integration.id}.{tool.name}"
                    if key not in seen:
                        seen.add(key)
                        tools.append({
                            "integrationId": integration.id,
                            "tool": tool,
                        })
        return tools

    async def start(self) -> None:
        self._server = await serve(
            self._handle_connection,
            self._host,
            self._port,
            ping_interval=None,
            ping_timeout=None,
        )
        for sock in self._server.sockets:
            self._port = sock.getsockname()[1]
            break

    async def stop(self) -> None:
        for gw in self._gateways.values():
            gw.reject_all("Server shutting down")
        self._gateways.clear()
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def call_tool(
        self,
        integration_id: str,
        tool_name: str,
        arguments: dict,
        timeout: float = 60.0,
    ) -> ToolResult:
        """Call a tool on a connected gateway."""
        gw = self._find_gateway(integration_id)
        if not gw:
            raise LookupError(f"No gateway has integration '{integration_id}'")
        return await gw.call_tool(integration_id, tool_name, arguments, timeout)

    async def call_tool_for_org(
        self,
        organization_id: str,
        integration_id: str,
        tool_name: str,
        arguments: dict,
        timeout: float = 90.0,
    ) -> ToolResult:
        """Call a tool on any gateway for the given org that provides the integration.

        Picks a random candidate for load balancing and retries on a different
        one if the call fails with a connection error.
        """
        candidates = [
            gw
            for gw in self._gateways.values()
            if gw.info.organization_id == organization_id
            and any(i.id == integration_id for i in gw.info.integrations)
        ]

        if not candidates:
            raise LookupError(
                f"No gateway for org '{organization_id}' has integration '{integration_id}'"
            )

        random.shuffle(candidates)

        last_error: Exception | None = None
        for gw in candidates:
            try:
                return await gw.call_tool(integration_id, tool_name, arguments, timeout)
            except Exception as err:
                last_error = err
                # Only retry on connection-level errors
                if "Gateway disconnected" not in str(err):
                    raise
        raise last_error  # type: ignore[misc]

    async def request_refresh_registrations(self, gateway_id: str) -> None:
        """Send refresh_registrations to a specific gateway."""
        gw = self._gateways.get(gateway_id)
        if gw:
            await gw.ws.send(json.dumps({"type": "refresh_registrations"}))

    async def request_refresh_registrations_for_org(self, organization_id: str) -> None:
        """Send refresh_registrations to all gateways for an organization."""
        for gw in self._gateways.values():
            if gw.info.organization_id == organization_id:
                await gw.ws.send(json.dumps({"type": "refresh_registrations"}))

    async def _handle_connection(self, ws: websockets.asyncio.server.ServerConnection) -> None:
        self._next_id += 1
        conn_id = f"gw_{self._next_id}"
        gw_conn: _GatewayConn | None = None

        try:
            # Phase 1: Authentication (10s timeout)
            raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            msg = json.loads(raw)

            if msg.get("type") != "authenticate":
                await ws.close()
                return

            protocol_version = msg.get("protocolVersion", 1)
            gateway_version = msg.get("gatewayVersion", "unknown")

            result = await self._validate_token(msg["token"])
            if result is None:
                await ws.send(json.dumps({
                    "type": "auth_error",
                    "error": "Invalid token",
                }))
                await ws.close()
                return

            auth_resp: dict = {
                "type": "authenticated",
                "organizationId": result.organization_id,
            }
            if result.organization_name:
                auth_resp["organizationName"] = result.organization_name
            await ws.send(json.dumps(auth_resp))

            # Phase 2: Registration (30s timeout)
            raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
            msg = json.loads(raw)

            if msg.get("type") != "register":
                await ws.close()
                return

            integrations = self._parse_integrations(msg.get("integrations", []))
            tool_count = sum(len(i.tools) for i in integrations)
            skill_count = sum(len(i.skills) for i in integrations)

            await ws.send(json.dumps({
                "type": "registered",
                "integrationCount": len(integrations),
                "toolCount": tool_count,
                "skillCount": skill_count,
            }))

            info = ConnectedGateway(
                id=conn_id,
                organization_id=result.organization_id,
                protocol_version=protocol_version,
                gateway_version=gateway_version,
                integrations=integrations,
            )
            gw_conn = _GatewayConn(ws, info)
            self._gateways[conn_id] = gw_conn

            if self.on_gateway_connected:
                self.on_gateway_connected(info)

            # Phase 3: Steady state - handle incoming messages
            ping_task = None
            if self._ping_interval > 0:
                ping_task = asyncio.create_task(self._ping_loop(ws, conn_id))

            try:
                async for raw in ws:
                    msg = json.loads(raw)
                    msg_type = msg.get("type")

                    if msg_type == "tool_result":
                        tool_result = self._parse_tool_result(msg["result"])
                        gw_conn.resolve_result(msg["requestId"], tool_result)
                    elif msg_type == "tool_error":
                        error = GatewayError(
                            code=msg["error"]["code"],
                            message=msg["error"]["message"],
                        )
                        gw_conn.resolve_error(msg["requestId"], error)
                    elif msg_type == "pong":
                        gw_conn.pong_received.set()
                    elif msg_type == "register":
                        integrations = self._parse_integrations(msg.get("integrations", []))
                        tool_count = sum(len(i.tools) for i in integrations)
                        skill_count = sum(len(i.skills) for i in integrations)
                        await ws.send(json.dumps({
                            "type": "registered",
                            "integrationCount": len(integrations),
                            "toolCount": tool_count,
                            "skillCount": skill_count,
                        }))
                        gw_conn.info.integrations = integrations
                        if self.on_gateway_updated:
                            self.on_gateway_updated(gw_conn.info)
            finally:
                if ping_task:
                    ping_task.cancel()
                    try:
                        await ping_task
                    except asyncio.CancelledError:
                        pass

        except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            pass
        except Exception:
            logger.exception("Error handling gateway connection %s", conn_id)
        finally:
            if gw_conn:
                gw_conn.reject_all("Gateway disconnected")
                self._gateways.pop(conn_id, None)
                if self.on_gateway_disconnected:
                    self.on_gateway_disconnected(gw_conn.info)

    async def _ping_loop(
        self, ws: websockets.asyncio.server.ServerConnection, conn_id: str
    ) -> None:
        try:
            while True:
                await asyncio.sleep(self._ping_interval)
                gw_conn = self._gateways.get(conn_id)
                if not gw_conn:
                    break
                gw_conn.pong_received.clear()
                await ws.send(json.dumps({"type": "ping"}))
                if self._pong_timeout > 0:
                    try:
                        await asyncio.wait_for(
                            gw_conn.pong_received.wait(), timeout=self._pong_timeout
                        )
                    except asyncio.TimeoutError:
                        await ws.close()
                        break
        except (asyncio.CancelledError, websockets.exceptions.ConnectionClosed):
            pass

    def _find_gateway(self, integration_id: str) -> _GatewayConn | None:
        for gw in self._gateways.values():
            if any(i.id == integration_id for i in gw.info.integrations):
                return gw
        return None

    @staticmethod
    def _parse_integrations(raw: list) -> list[Integration]:
        return [
            Integration(
                id=i["id"],
                name=i["name"],
                description=i["description"],
                tools=[
                    ToolDefinition(
                        name=t["name"],
                        description=t["description"],
                        input_schema=t["inputSchema"],
                    )
                    for t in i.get("tools", [])
                ],
                skills=[
                    Skill(id=s["id"], content=s["content"])
                    for s in i.get("skills", [])
                ],
            )
            for i in raw
        ]

    @staticmethod
    def _parse_tool_result(raw: dict) -> ToolResult:
        content = []
        for block in raw.get("content", []):
            if block["type"] == "text":
                content.append(TextContent(text=block["text"]))
            elif block["type"] == "image":
                content.append(ImageContent(
                    data=block["data"],
                    mime_type=block["mimeType"],
                ))
        return ToolResult(content=content, is_error=raw.get("isError", False))
