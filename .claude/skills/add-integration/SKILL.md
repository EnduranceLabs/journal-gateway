---
name: add-integration
description: Add a new built-in MCP integration to the gateway runtime
disable-model-invocation: true
argument-hint: "[integration-id]"
---

# Add a Built-in Gateway Integration

Follow these steps to add a new MCP integration to the gateway.

## 1. Create an MCP server config file in `packages/mcp/src/integrations/`

Create a new file at `packages/mcp/src/integrations/<integration-id>.ts` with a single exported `McpServerConfig`.

Each entry must conform to the `McpServerConfig` interface (defined in `packages/mcp/src/config.ts`):

```ts
export interface McpServerConfig {
  id: string;
  type: "mcp_server";
  name: string;
  description: string;
  command: string;
  args: string[];
  envVars: Record<string, string>;
}
```

The `envVars` object maps **our env var name** (the key the gateway reads from `process.env`) to the **child process env var name** (the key passed to the MCP server subprocess). They are often the same but can differ (e.g., `RAILWAY_TOKEN` -> `RAILWAY_API_TOKEN`).

Example file (`packages/mcp/src/integrations/myservice.ts`):

```ts
import type { McpServerConfig } from "../config.js";

export const myservice: McpServerConfig = {
  id: "myservice",
  type: "mcp_server",
  name: "My Service",
  description: "Query My Service data",
  command: "npx",
  args: ["-y", "@myservice/mcp-server"],
  envVars: { MY_SERVICE_TOKEN: "MY_SERVICE_TOKEN" },
};
```

## 2. Register in the barrel export

Open `packages/mcp/src/integrations/index.ts` and:

1. Import and re-export the new integration module
2. Add the integration to the `BUILT_IN_MCP_SERVERS` record

## 3. Validate env var resolution

The `parseConfig` function already handles env var validation generically. When an integration is listed in `INTEGRATIONS`, `parseConfig` iterates over `definition.envVars` and throws if any required env var is missing. No additional validation code is needed unless the integration has special requirements.

Verify the error message reads correctly by mentally running through:
`Integration "<integration-id>" requires environment variable <ENV_VAR_NAME>`

## 4. Add tests

Open `packages/mcp/src/__tests__/integrations.test.ts` and add the new integration ID to the `expectedIntegrations` array.

Open `packages/mcp/src/__tests__/config.test.ts` and add:

1. **An env var resolution test** (if the integration has env vars). Follow the pattern of existing tests like the `langfuse` test:

```ts
it("resolves <integration-id> env vars", () => {
  const config = parseConfig(
    BUILT_IN_MCP_SERVERS,
    makeEnv({
      INTEGRATIONS: "<integration-id>",
      ENV_VAR_1: "value1",
      ENV_VAR_2: "value2",
    })
  );
  const env = config.mcpEnvVars.get("<integration-id>");
  expect(env).toEqual({
    CHILD_VAR_1: "value1",
    CHILD_VAR_2: "value2",
  });
});
```

2. **A missing env var test** (if the integration has env vars):

```ts
it("throws when <integration-id> is missing a required key", () => {
  expect(() =>
    parseConfig(
      BUILT_IN_MCP_SERVERS,
      makeEnv({
        INTEGRATIONS: "<integration-id>",
        // provide all but one required env var
      })
    )
  ).toThrow("<MISSING_ENV_VAR>");
});
```

## 5. Update the README integrations table

Open `README.md` and add a row to the "Available Integrations" table:

```
| `<integration-id>` | <description> | `ENV_VAR_1`, `ENV_VAR_2` |
```

Keep the table sorted alphabetically by integration ID.

## 6. Run checks

```bash
pnpm test          # Run all tests
pnpm typecheck     # Verify types compile
```

## Key files

- `packages/mcp/src/integrations/` — Individual MCP server configs and barrel export
- `packages/mcp/src/config.ts` — `McpServerConfig` interface and `parseConfig`
- `packages/mcp/src/__tests__/config.test.ts` — config validation tests (uses `makeEnv` helper)
- `packages/mcp/src/__tests__/integrations.test.ts` — MCP server catalog tests
- `README.md` — Available Integrations table
