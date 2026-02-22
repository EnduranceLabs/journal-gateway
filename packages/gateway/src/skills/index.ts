import type { SkillDefinition } from "../config.js";
import { postgresql } from "./postgresql.js";
import { railway } from "./railway.js";
import { sentry } from "./sentry.js";
import { langfuse } from "./langfuse.js";
import { clickhouse } from "./clickhouse.js";

export { postgresql } from "./postgresql.js";
export { railway } from "./railway.js";
export { sentry } from "./sentry.js";
export { langfuse } from "./langfuse.js";
export { clickhouse } from "./clickhouse.js";

export const BUILT_IN_SKILLS: Record<string, SkillDefinition> = {
  postgresql,
  railway,
  sentry,
  langfuse,
  clickhouse,
};
