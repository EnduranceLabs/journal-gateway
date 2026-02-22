# Journal Gateway Skills

## What Are Skills?

Skills are prompt/workflow templates that guide agent behavior. They are bundled inside integrations alongside tools:

| | Tools | Skills |
|---|---|---|
| **Purpose** | Provide callable actions (query a DB, call an API) | Provide instructions that shape agent behavior |
| **Mechanism** | Tool calls routed through `IntegrationProvider` | Prompt templates sent at registration, used by the service |
| **Runtime** | Invoked on each `tool_call` message | Read once at startup, sent during `register` |

Both tools and skills travel inside `Integration` objects. An integration can carry tools, skills, or both. Skills are useful for encoding organizational workflows, code review standards, deployment checklists, and other repeatable patterns that agents should follow.

## Skill Schema

The canonical definition is the `SkillSchema` Zod type in `gateway/src/types/skills.ts`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier (derived from filename) |
| `content` | `string` | yes | Raw Markdown content |

## Skill File Format

Skills are authored as Markdown files. Each `.md` file in the skills directory becomes one skill. The `id` is derived from the filename (without `.md` extension), and the `content` is the raw file contents.

```markdown
# Review PR

You are reviewing a pull request. Follow these steps:

1. Read the diff carefully
2. Check for correctness, security, and readability
3. Leave inline comments on specific lines
4. Summarize your review with an overall assessment
```

The gateway does not parse or interpret skill content — it passes the raw Markdown to the service, which makes skills available to agents.

## Configuration

Set the `SKILLS_DIR` environment variable to a directory containing skill files:

```bash
SKILLS_DIR=/opt/journal/skills journal-gateway
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILLS_DIR` | no | — | Path to directory containing `.md` skill files |

At least one of `MCP_SERVERS` or `SKILLS_DIR` must be set. The gateway can run with only skills (no MCP servers) or with both.

## How Skills Flow

```
Skill files (.md)
      │
      ▼
 SkillClient.load()         ← reads directory, returns { id, content }[]
      │
      ▼
 SkillClient.getIntegrations()  ← returns Integration[] with skills inside
      │
      ▼
 Runtime                     ← merges skill integrations with MCP integrations
      │
      ▼
 GatewayConnection           ← sends unified `register` message
      │
      ▼
 Journal Service             ← makes skills available to agents
```

1. At startup, `SkillClient` reads all `.md` files from `SKILLS_DIR`
2. Each file becomes a `{ id, content }` skill (id from filename, content is raw file)
3. `getIntegrations()` wraps the skills into an `Integration` object (with `tools: []` and `skills: [...]`)
4. The `Runtime` merges MCP integrations with skill integrations
5. During connection, `GatewayConnection` calls `getRegistrations()` and sends all integrations in the `register` message
6. The service makes these skills available to agents in the organization
