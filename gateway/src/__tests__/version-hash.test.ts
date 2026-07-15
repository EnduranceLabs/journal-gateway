import { describe, it, expect } from "vitest";
import { computeVersionHash } from "../version-hash.js";
import type { Integration } from "journal-gateway-protocol";

describe("computeVersionHash", () => {
  it("returns null for empty array", () => {
    expect(computeVersionHash([])).toBeNull();
  });

  it("returns 16-char hex string for non-empty array", () => {
    const integrations: Integration[] = [
      {
        id: "test",
        name: "Test",
        description: "Test integration",
        tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object" } }],
      },
    ];
    const hash = computeVersionHash(integrations);
    expect(hash).not.toBeNull();
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const integrations: Integration[] = [
      {
        id: "pg",
        name: "PostgreSQL",
        description: "Query databases",
        tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object" } }],
      },
    ];
    const hash1 = computeVersionHash(integrations);
    const hash2 = computeVersionHash(integrations);
    expect(hash1).toBe(hash2);
  });

  it("different input produces different hash", () => {
    const a: Integration[] = [
      {
        id: "pg",
        name: "PostgreSQL",
        description: "Query databases",
        tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object" } }],
      },
    ];
    const b: Integration[] = [
      {
        id: "pg",
        name: "PostgreSQL",
        description: "Query databases",
        tools: [
          { name: "query", description: "Run SQL", inputSchema: { type: "object" } },
          { name: "execute", description: "Execute SQL", inputSchema: { type: "object" } },
        ],
      },
    ];
    expect(computeVersionHash(a)).not.toBe(computeVersionHash(b));
  });

  it("is insensitive to property order in input objects", () => {
    const a: Integration[] = [
      {
        id: "test",
        name: "Test",
        description: "Desc",
        tools: [{ name: "t", description: "d", inputSchema: {} }],
      },
    ];
    // Create with different property order
    const b: Integration[] = [
      {
        description: "Desc",
        tools: [{ inputSchema: {}, description: "d", name: "t" }],
        name: "Test",
        id: "test",
      } as Integration,
    ];
    expect(computeVersionHash(a)).toBe(computeVersionHash(b));
  });
});
