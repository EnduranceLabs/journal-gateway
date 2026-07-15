# Curated Enterprise MCP Servers

This catalog lists reputable public MCP implementations to consider with
Journal Gateway. It is intentionally not an "awesome list": entries are limited
to official vendor projects, cloud-provider projects, or MCP steering-group
reference servers with clear documentation.

Review each server's permissions before exposing it to Journal. Prefer
read-only or narrowly scoped credentials unless a workflow explicitly requires
write access.

## Gateway-Ready Starting Points

These options have a local `stdio` path or a remote token/header path that can
fit an unattended gateway deployment.

| Integration | Maintainer | Gateway fit | Notes |
|-------------|------------|-------------|-------|
| [MCP Toolbox for Databases](https://github.com/googleapis/mcp-toolbox) | Google | `stdio` via `npx -y @toolbox-sdk/server ... --stdio` | Recommended SQL default. Supports prebuilt configs and custom restricted tools for enterprise databases. |
| [MCP Toolbox prebuilt configs](https://mcp-toolbox.dev/documentation/configuration/prebuilt-configs/) | Google | `stdio` | Prebuilt configs include PostgreSQL, MySQL, SQL Server, Snowflake, BigQuery, Cloud SQL, AlloyDB, Spanner, Oracle, ClickHouse, Elasticsearch, Neo4j, SQLite, Redis, and more. |
| [GitHub MCP Server](https://github.com/github/github-mcp-server) | GitHub | Remote Streamable HTTP with token header, or local Docker/stdio | Official server for repositories, issues, pull requests, Actions, code security, and related GitHub workflows. Scope PATs and toolsets tightly. |
| [Azure DevOps MCP Server](https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview) | Microsoft | Local server | Provides Azure DevOps work items, pull requests, builds, test plans, and project context. |
| [Sentry MCP](https://github.com/getsentry/sentry-mcp) | Sentry | Remote MCP service; stdio is available for some self-hosted workflows | Focused on human-in-the-loop coding and debugging workflows. |
| [Datadog MCP Server](https://github.com/datadog-labs/mcp-server) | Datadog Labs | Managed remote HTTP MCP server | Connects agents to Datadog logs, metrics, traces, incidents, and related observability data. Review site-specific endpoints and auth requirements. |
| [Grafana MCP server](https://grafana.com/docs/grafana/latest/developer-resources/mcp/) | Grafana Labs | Local `stdio`, Docker, binary, Helm, or hosted Grafana Cloud MCP | Provides access to Grafana dashboards, datasources, metrics/logs, alerting, incidents, and related resources. Use service account tokens and Grafana RBAC. |
| [AWS MCP Servers](https://awslabs.github.io/mcp/) | AWS Labs / AWS | Mix of managed remote and local servers | AWS publishes MCP servers for documentation, cloud-native development, infrastructure, data, cost, and operations workflows. Review IAM permissions and CloudTrail audit behavior per server. |
| [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Cloudflare | Managed remote servers | Cloudflare provides managed MCP servers for docs, Workers, observability, audit logs, DNS analytics, AI Gateway, GraphQL, and other Cloudflare product areas. |
| [Stripe MCP server](https://docs.stripe.com/mcp) | Stripe | Hosted remote MCP server | Provides Stripe API tools and Stripe knowledge-base search. Treat as a high-risk write-capable integration unless scoped to read-only or test-mode workflows. |

## Evaluate Vendor Auth Flow

These are official/vendor integrations, but their hosted flows are often built
for IDEs, desktop clients, or interactive OAuth. Verify that the vendor supports
the non-interactive token/header path required for your gateway environment
before planning a deployment.

| Integration | Maintainer | Gateway fit | Notes |
|-------------|------------|-------------|-------|
| [Atlassian Rovo MCP Server](https://github.com/atlassian/atlassian-mcp-server) | Atlassian | Hosted remote server; auth flow depends on deployment mode | Official bridge for Jira, Confluence, Jira Service Management, Bitbucket, and Compass. |
| [Slack MCP and Skills Plugin](https://github.com/slackapi/slack-skills-plugin) | Slack | Hosted remote server; client-specific OAuth | Official Slack-hosted MCP server exposed through Slack's plugin. Useful for Slack search, messaging, Canvas, and users when the target client supports the required OAuth flow. |
| [Linear MCP server](https://linear.app/changelog/2025-05-01-mcp) | Linear | Hosted remote MCP server | Official Linear remote MCP server for Linear workspace data and project workflows. Confirm auth and token flow before server-side gateway deployment. |
| [Notion MCP server](https://developers.notion.com/guides/mcp/get-started-with-mcp) | Notion | Hosted remote MCP server; official local package is also published at [`makenotion/notion-mcp-server`](https://github.com/makenotion/notion-mcp-server) | Gives agents read/write access to Notion workspace content according to the connected user's access and permissions. |

## Reference Implementations

| Integration | Maintainer | Gateway fit | Notes |
|-------------|------------|-------------|-------|
| [Model Context Protocol reference servers](https://github.com/modelcontextprotocol/servers) | MCP steering group | `stdio` for remaining reference servers | Useful for development and protocol examples. The repository explicitly positions these as reference implementations, not production-ready solutions; archived database servers should not be the default customer path. |

## Practical Guidance

- Prefer servers with vendor-owned repositories or docs.
- Prefer static token/header authentication for unattended gateway deployments.
- Use vendor OAuth flows only when they are designed for service-side or
  connector use, not only desktop IDE use.
- Split high-risk integrations into separate gateway config entries and give
  each one a narrow token or role.
- For remote MCP servers, verify whether the vendor supports Streamable HTTP,
  SSE, and non-interactive authorization in the environment where the gateway
  runs.
