import { createHash } from "node:crypto";
import type { Integration } from "@journal/gateway-protocol";

/**
 * Compute a stable content hash for a list of integrations.
 * Returns null for an empty array, otherwise the first 16 hex chars of a SHA-256 digest.
 * Uses sorted-key JSON serialization for determinism.
 */
export function computeVersionHash(integrations: Integration[]): string | null {
  if (integrations.length === 0) return null;
  const canonical = JSON.stringify(integrations, stableReplacer);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
