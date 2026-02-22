import { describe, it, expect } from "vitest";
import {
  BUILT_IN_SKILLS,
  postgresql,
  railway,
  sentry,
  langfuse,
  clickhouse,
} from "../skills/index.js";

describe("BUILT_IN_SKILLS catalog", () => {
  it("has all expected built-in skills", () => {
    const expectedSkills = [
      "postgresql",
      "railway",
      "sentry",
      "langfuse",
      "clickhouse",
    ];
    expect(Object.keys(BUILT_IN_SKILLS).sort()).toEqual(expectedSkills.sort());
  });

  it("has ids matching their keys", () => {
    for (const [key, skill] of Object.entries(BUILT_IN_SKILLS)) {
      expect(skill.id).toBe(key);
    }
  });

  it("individual exports match catalog entries", () => {
    expect(BUILT_IN_SKILLS.postgresql).toBe(postgresql);
    expect(BUILT_IN_SKILLS.railway).toBe(railway);
    expect(BUILT_IN_SKILLS.sentry).toBe(sentry);
    expect(BUILT_IN_SKILLS.langfuse).toBe(langfuse);
    expect(BUILT_IN_SKILLS.clickhouse).toBe(clickhouse);
  });

  it("all skills have type mcp_server", () => {
    for (const skill of Object.values(BUILT_IN_SKILLS)) {
      expect(skill.type).toBe("mcp_server");
    }
  });
});
