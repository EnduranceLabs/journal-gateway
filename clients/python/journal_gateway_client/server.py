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
logger.addHandler(logging.NullHandler())


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
        self.pending_pulls: dict[str, asyncio.Future] = {}
        self.pong_received: asyncio.Event = asyncio.Event()
        self._next_id = 0
        self._next_pull_id = 0

    async def call_tool(
        self,
        integration_id: str,
        tool_name: str,
        arguments: dict,
        timeout: float,
        trace: dict | None = None,
    ) -> ToolResult:
        self._next_id += 1
        request_id = f"req_{self._next_id}"

        loop = asyncio.get_running_loop()
        future: asyncio.Future[ToolResult] = loop.create_future()
        self.pending[request_id] = future

        payload: dict = {
            "type": "tool_call",
            "requestId": request_id,
            "integrationId": integration_id,
            "toolName": tool_name,
            "arguments": arguments,
        }
        if trace:
            if trace.get("traceparent"):
                payload["traceparent"] = trace["traceparent"]
            if trace.get("tracestate"):
                payload["tracestate"] = trace["tracestate"]
        await self.ws.send(json.dumps(payload))

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self.pending.pop(request_id, None)
            raise TimeoutError(f"Tool call timed out after {timeout}s")

    async def send_pull(self, pull_type: str, timeout: float = 30.0) -> dict:
        self._next_pull_id += 1
        request_id = f"pull_{self._next_pull_id}"

        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self.pending_pulls[request_id] = future

        await self.ws.send(json.dumps({
            "type": pull_type,
            "requestId": request_id,
        }))

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self.pending_pulls.pop(request_id, None)
            raise TimeoutError(f"Pull {pull_type} timed out after {timeout}s")

    def resolve_pull(self, request_id: str, data: dict) -> None:
        future = self.pending_pulls.pop(request_id, None)
        if future and not future.done():
            future.set_result(data)

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
        for future in self.pending_pulls.values():
            if not future.done():
                future.set_exception(RuntimeError(reason))
        self.pending_pulls.clear()


class GatewayServer:
    """WebSocket server that accepts gateway connections and provides a tool-calling API."""

    def __init__(
        self,
        validate_token: TokenValidator,
        host: str = "0.0.0.0",
        port: int = 0,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        pull_timeout: float = 30.0,
        get_trace_context: Callable[[], dict | None] | None = None,
        on_socket_error: Callable[[Exception, ConnectedGateway | None], None] | None = None,
    ):
        self._validate_token = validate_token
        self._host = host
        self._port = port
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._pull_timeout = pull_timeout
        self._get_trace_context = get_trace_context
        self._on_socket_error = on_socket_error
        self._server: websockets.asyncio.server.Server | None = None
        self._gateways: dict[str, _GatewayConn] = {}
        self._next_id = 0
        self.on_gateway_connected: Callable[[ConnectedGateway], None] | None = None
        self.on_gateway_updated: Callable[[ConnectedGateway], None] | None = None
        self.on_gateway_disconnected: Callable[[ConnectedGateway], None] | None = None

    def _report_socket_error(
        self, error: Exception, gateway: ConnectedGateway | None
    ) -> None:
        if not self._on_socket_error:
            logger.error(
                "Gateway connection error",
                exc_info=(type(error), error, error.__traceback__),
            )
            return
        try:
            self._on_socket_error(error, gateway)
        except Exception:
            pass

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
        return await gw.call_tool(
            integration_id, tool_name, arguments, timeout, self._trace_context()
        )

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

        trace = self._trace_context()
        last_error: Exception | None = None
        for gw in candidates:
            try:
                return await gw.call_tool(
                    integration_id, tool_name, arguments, timeout, trace
                )
            except Exception as err:
                last_error = err
                # Only retry on connection-level errors
                if "Gateway disconnected" not in str(err):
                    raise
        raise last_error  # type: ignore[misc]

    async def get_versions(self, gateway_id: str) -> dict:
        """Pull current versions from a gateway."""
        gw = self._gateways.get(gateway_id)
        if not gw:
            raise LookupError(f"Gateway '{gateway_id}' not found")
        return await gw.send_pull("get_versions", timeout=self._pull_timeout)

    async def get_tools(self, gateway_id: str) -> dict:
        """Pull tools from a gateway."""
        gw = self._gateways.get(gateway_id)
        if not gw:
            raise LookupError(f"Gateway '{gateway_id}' not found")
        return await gw.send_pull("get_tools", timeout=self._pull_timeout)

    async def get_skills(self, gateway_id: str) -> dict:
        """Pull skills from a gateway."""
        gw = self._gateways.get(gateway_id)
        if not gw:
            raise LookupError(f"Gateway '{gateway_id}' not found")
        return await gw.send_pull("get_skills", timeout=self._pull_timeout)

    async def _handle_connection(self, ws: websockets.asyncio.server.ServerConnection) -> None:
        self._next_id += 1
        conn_id = f"gw_{self._next_id}"
        gw_conn: _GatewayConn | None = None
        background_tasks: set[asyncio.Task[None]] = set()

        def start_background(coro: Awaitable[None]) -> asyncio.Task[None]:
            task = asyncio.create_task(coro)
            background_tasks.add(task)
            task.add_done_callback(background_tasks.discard)
            return task

        try:
            # Phase 1: Authentication (10s timeout)
            raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.close()
                return

            if msg.get("type") != "authenticate":
                await ws.close()
                return

            protocol_version = msg.get("protocolVersion", 0)
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

            # Phase 2: Wait for version_changed (30s timeout)
            raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.close()
                return

            if msg.get("type") != "version_changed":
                await ws.close()
                return

            mcp_version = msg.get("mcpVersion")
            skills_version = msg.get("skillsVersion")

            info = ConnectedGateway(
                id=conn_id,
                organization_id=result.organization_id,
                protocol_version=protocol_version,
                gateway_version=gateway_version,
                integrations=[],
                mcp_version=mcp_version,
                skills_version=skills_version,
            )
            gw_conn = _GatewayConn(ws, info)
            self._gateways[conn_id] = gw_conn

            # Phase 3: Steady state - start message loop first so pull
            # responses can be processed, then auto-pull concurrently.
            ping_task = None
            if self._ping_interval > 0:
                ping_task = asyncio.create_task(self._ping_loop(ws, conn_id))
            start_background(self._run_initial_pull(gw_conn))

            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        await ws.close()
                        break
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
                    elif msg_type == "version_changed":
                        new_mcp = msg.get("mcpVersion")
                        new_skills = msg.get("skillsVersion")
                        mcp_changed = new_mcp != gw_conn.info.mcp_version
                        skills_changed = new_skills != gw_conn.info.skills_version
                        gw_conn.info.mcp_version = new_mcp
                        gw_conn.info.skills_version = new_skills

                        start_background(self._handle_version_update(
                            gw_conn,
                            mcp_changed,
                            skills_changed,
                            new_mcp,
                            new_skills,
                        ))
                    elif msg_type == "versions":
                        gw_conn.resolve_pull(msg["requestId"], {
                            "mcpVersion": msg.get("mcpVersion"),
                            "skillsVersion": msg.get("skillsVersion"),
                        })
                    elif msg_type == "tools":
                        gw_conn.resolve_pull(msg["requestId"], {
                            "integrations": self._parse_integrations(msg.get("integrations", [])),
                            "mcpVersion": msg.get("mcpVersion"),
                        })
                    elif msg_type == "skills":
                        gw_conn.resolve_pull(msg["requestId"], {
                            "skills": [
                                Skill(id=s["id"], content=s["content"])
                                for s in msg.get("skills", [])
                            ],
                            "skillsVersion": msg.get("skillsVersion"),
                        })

            finally:
                for task in list(background_tasks):
                    task.cancel()
                if background_tasks:
                    await asyncio.gather(*background_tasks, return_exceptions=True)
                if ping_task:
                    ping_task.cancel()
                    try:
                        await ping_task
                    except asyncio.CancelledError:
                        pass

        except asyncio.TimeoutError:
            pass
        except websockets.exceptions.ConnectionClosed as e:
            if not isinstance(
                e, websockets.exceptions.ConnectionClosedOK
            ):
                self._report_socket_error(e, gw_conn.info if gw_conn else None)
        except Exception as e:
            self._report_socket_error(e, gw_conn.info if gw_conn else None)
        finally:
            if gw_conn:
                gw_conn.reject_all("Gateway disconnected")
                self._gateways.pop(conn_id, None)
                if self.on_gateway_disconnected:
                    self.on_gateway_disconnected(gw_conn.info)

    async def _run_initial_pull(self, gw_conn: _GatewayConn) -> None:
        try:
            await self._auto_pull(gw_conn)
            if self.on_gateway_connected:
                self.on_gateway_connected(gw_conn.info)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._report_socket_error(e, gw_conn.info)
            await gw_conn.ws.close()

    async def _handle_version_update(
        self,
        gw_conn: _GatewayConn,
        mcp_changed: bool,
        skills_changed: bool,
        new_mcp: str | None,
        new_skills: str | None,
    ) -> None:
        try:
            if mcp_changed and new_mcp is not None:
                await self._pull_tools(gw_conn)
            elif mcp_changed and new_mcp is None:
                gw_conn.info.integrations = [
                    i for i in gw_conn.info.integrations if i.id == "skills"
                ]
            if skills_changed and new_skills is not None:
                await self._pull_skills(gw_conn)
            elif skills_changed and new_skills is None:
                gw_conn.info.integrations = [
                    i for i in gw_conn.info.integrations if i.id != "skills"
                ]
            if self.on_gateway_updated:
                self.on_gateway_updated(gw_conn.info)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._report_socket_error(e, gw_conn.info)
            await gw_conn.ws.close()

    async def _auto_pull(self, gw_conn: _GatewayConn) -> None:
        """Pull tools and/or skills based on versions."""
        tasks = []
        if gw_conn.info.mcp_version is not None:
            tasks.append(self._pull_tools(gw_conn))
        if gw_conn.info.skills_version is not None:
            tasks.append(self._pull_skills(gw_conn))
        if tasks:
            await asyncio.gather(*tasks)

    async def _pull_tools(self, gw_conn: _GatewayConn) -> None:
        """Pull tools from a gateway and update its integrations."""
        data = await gw_conn.send_pull("get_tools", timeout=self._pull_timeout)
        integrations = data.get("integrations", [])
        # Keep skills, replace tool integrations
        skills_integrations = [i for i in gw_conn.info.integrations if i.id == "skills"]
        gw_conn.info.integrations = list(integrations) + skills_integrations
        gw_conn.info.mcp_version = data.get("mcpVersion")

    async def _pull_skills(self, gw_conn: _GatewayConn) -> None:
        """Pull skills from a gateway and update its integrations."""
        data = await gw_conn.send_pull("get_skills", timeout=self._pull_timeout)
        skills = data.get("skills", [])
        # Keep non-skills integrations, replace skills integration
        non_skills = [i for i in gw_conn.info.integrations if i.id != "skills"]
        if skills:
            non_skills.append(Integration(
                id="skills",
                name="Skills",
                description="Gateway skills",
                tools=[],
                skills=list(skills),
            ))
        gw_conn.info.integrations = non_skills
        gw_conn.info.skills_version = data.get("skillsVersion")

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

    def _trace_context(self) -> dict | None:
        return self._get_trace_context() if self._get_trace_context else None

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
