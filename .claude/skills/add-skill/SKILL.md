---
name: add-skill
description: Add a new built-in MCP skill to the gateway runtime
disable-model-invocation: true
argument-hint: "[skill-id]"
---

# Add a Built-in Gateway Skill

Follow these steps to add a new MCP skill to the gateway.

## 1. Create a skill definition file in `src/skills/`

Create a new file at `packages/gateway/src/skills/<skill-id>.ts` with a single exported `SkillDefinition`.

Each entry must conform to the `SkillDefinition` interface (defined in `packages/gateway/src/config.ts`):

```ts
export interface SkillDefinition {
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

Example file (`packages/gateway/src/skills/myservice.ts`):

```ts
import type { SkillDefinition } from "../config.js";

export const myservice: SkillDefinition = {
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

Open `packages/gateway/src/skills/index.ts` and:

1. Import and re-export the new skill module
2. Add the skill to the `BUILT_IN_SKILLS` record

## 3. Validate env var resolution

The `parseConfig` function already handles env var validation generically. When a skill is listed in `SKILLS`, `parseConfig` iterates over `definition.envVars` and throws if any required env var is missing. No additional validation code is needed unless the skill has special requirements.

Verify the error message reads correctly by mentally running through:
`Skill "<skill-id>" requires environment variable <ENV_VAR_NAME>`

## 4. Add tests

Open `packages/gateway/src/__tests__/skills.test.ts` and add the new skill ID to the `expectedSkills` array.

Open `packages/gateway/src/__tests__/config.test.ts` and add:

1. **An env var resolution test** (if the skill has env vars). Follow the pattern of existing tests like the `langfuse` test:

```ts
it("resolves <skill-id> env vars", () => {
  const config = parseConfig(
    BUILT_IN_SKILLS,
    makeEnv({
      SKILLS: "<skill-id>",
      ENV_VAR_1: "value1",
      ENV_VAR_2: "value2",
    })
  );
  const env = config.skillEnvVars.get("<skill-id>");
  expect(env).toEqual({
    CHILD_VAR_1: "value1",
    CHILD_VAR_2: "value2",
  });
});
```

2. **A missing env var test** (if the skill has env vars):

```ts
it("throws when <skill-id> is missing a required key", () => {
  expect(() =>
    parseConfig(
      BUILT_IN_SKILLS,
      makeEnv({
        SKILLS: "<skill-id>",
        // provide all but one required env var
      })
    )
  ).toThrow("<MISSING_ENV_VAR>");
});
```

## 5. Update the README skills table

Open `README.md` and add a row to the "Available Skills" table:

```
| `<skill-id>` | <description> | `ENV_VAR_1`, `ENV_VAR_2` |
```

Keep the table sorted alphabetically by skill ID.

## 6. Run checks

```bash
pnpm test          # Run all tests
pnpm typecheck     # Verify types compile
```

## Key files

- `packages/gateway/src/skills/` — Individual skill definitions and barrel export
- `packages/gateway/src/config.ts` — `SkillDefinition` interface and `parseConfig`
- `packages/gateway/src/__tests__/config.test.ts` — config validation tests (uses `makeEnv` helper)
- `packages/gateway/src/__tests__/skills.test.ts` — skill catalog tests
- `README.md` — Available Skills table
