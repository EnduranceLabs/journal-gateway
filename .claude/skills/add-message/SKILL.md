---
name: add-message
description: Add a new message type to the gateway protocol
disable-model-invocation: true
argument-hint: "[message-name] [direction: gateway|service]"
---

# Add a Protocol Message Type

Follow these steps to add a new message to the Journal Gateway Protocol.

The first argument is the message name (e.g., `heartbeat_ack`). The second argument is the direction: `gateway` (gateway -> service) or `service` (service -> gateway).

## 1. Add the JSON Schema definition

Open `protocol/schemas/messages.schema.json` and add a new entry under `$defs`.

Follow the existing pattern:

```json
"MyNewMessage": {
  "type": "object",
  "description": "Description of when/why this message is sent",
  "properties": {
    "type": { "const": "my_new" },
    "field1": {
      "type": "string",
      "description": "Field description"
    }
  },
  "required": ["type", "field1"],
  "additionalProperties": false
}
```

Then add a `$ref` to the appropriate discriminated union (`GatewayMessage` or `ServiceMessage`) in the same file:

```json
{ "$ref": "#/$defs/MyNewMessage" }
```

## 2. Add the Zod schema and TypeScript type

Open `packages/types/src/messages.ts` and add the Zod schema + type export.

Place it in the correct section based on direction:
- **Gateway -> Service:** after the existing gateway messages (before `GatewayMessageSchema`)
- **Service -> Gateway:** after the existing service messages (before `ServiceMessageSchema`)

```ts
export const MyNewMessageSchema = z.object({
  type: z.literal("my_new"),
  field1: z.string(),
});

export type MyNewMessage = z.infer<typeof MyNewMessageSchema>;
```

## 3. Add to the discriminated union

In the same file (`packages/types/src/messages.ts`), add the new schema to the appropriate `z.discriminatedUnion("type", [...])`:

- **Gateway -> Service:** add to `GatewayMessageSchema`
- **Service -> Gateway:** add to `ServiceMessageSchema`

## 4. Re-export from index.ts

Open `packages/types/src/index.ts` and add the schema and type to the re-exports from `"./messages.js"`:

```ts
export {
  // ... existing exports ...
  MyNewMessageSchema,
  type MyNewMessage,
} from "./messages.js";
```

## 5. Update the protocol README

Open `protocol/README.md` and add documentation for the new message type.

Add it under the appropriate section ("Gateway -> Service" or "Service -> Gateway"):

```markdown
#### `my_new`

Description of the message.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"my_new"` | yes | Message discriminator |
| `field1` | `string` | yes | Field description |
```

If the message changes the connection lifecycle, update the ASCII diagram at the top.

## 6. Add tests

Open `packages/types/src/__tests__/messages.test.ts` and add tests.

Add in the appropriate `describe` block ("Gateway -> Service messages" or "Service -> Gateway messages"):

```ts
it("parses my_new message", () => {
  const msg = {
    type: "my_new",
    field1: "value",
  };
  expect(MyNewMessageSchema.parse(msg)).toEqual(msg);
});
```

Also verify it works through the discriminated union by adding the message to the array in the "parses all gateway/service message types via discriminated union" test.

Add rejection tests for any required fields or validation constraints:

```ts
it("rejects my_new with missing field1", () => {
  const msg = { type: "my_new" };
  expect(() => MyNewMessageSchema.parse(msg)).toThrow();
});
```

## 7. Run checks

```bash
pnpm build         # Types package must build before gateway
pnpm test          # Run all tests
pnpm typecheck     # Verify types compile
```

## Key files

- `protocol/schemas/messages.schema.json` — JSON Schema definitions
- `protocol/README.md` — protocol documentation
- `packages/types/src/messages.ts` — Zod schemas and discriminated unions
- `packages/types/src/index.ts` — re-exports
- `packages/types/src/__tests__/messages.test.ts` — message parsing tests
