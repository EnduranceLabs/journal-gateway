import { describe, it, expect } from "vitest";
import { SkillSchema } from "../types/skills.js";

describe("SkillSchema", () => {
  it("parses a valid skill", () => {
    const skill = {
      id: "review-pr",
      content: "You are reviewing a pull request. Follow these steps...",
    };
    expect(SkillSchema.parse(skill)).toEqual(skill);
  });

  it("parses a skill with multiline content", () => {
    const skill = {
      id: "deploy",
      content: "# Deploy\n\n1. Build the app\n2. Run tests\n3. Push to prod",
    };
    expect(SkillSchema.parse(skill)).toEqual(skill);
  });

  it("rejects skill missing required id", () => {
    const skill = {
      content: "Some instructions.",
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });

  it("rejects skill missing required content", () => {
    const skill = {
      id: "review-pr",
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });
});
