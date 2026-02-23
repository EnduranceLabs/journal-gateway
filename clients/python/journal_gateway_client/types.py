from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ToolDefinition:
    name: str
    description: str
    input_schema: dict


@dataclass
class Skill:
    id: str
    content: str


@dataclass
class Integration:
    id: str
    name: str
    description: str
    tools: list[ToolDefinition]
    skills: list[Skill] = field(default_factory=list)


@dataclass
class TextContent:
    text: str
    type: str = "text"


@dataclass
class ImageContent:
    data: str
    mime_type: str
    type: str = "image"


ContentBlock = TextContent | ImageContent


@dataclass
class ToolResult:
    content: list[ContentBlock]
    is_error: bool = False


@dataclass
class ToolCall:
    request_id: str
    integration_id: str
    tool_name: str
    arguments: dict


@dataclass
class GatewayError:
    code: str
    message: str


@dataclass
class ConnectedGateway:
    id: str
    organization_id: str
    protocol_version: int
    gateway_version: str
    integrations: list[Integration]
