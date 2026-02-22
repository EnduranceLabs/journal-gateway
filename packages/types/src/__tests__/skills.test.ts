import { describe, it, expect } from "vitest";
import { SkillSchema } from "../skills.js";

describe("SkillSchema", () => {
  it("parses a valid skill", () => {
    const skill = {
      id: "review-pr",
      name: "Review PR",
      description: "Reviews a pull request for code quality",
      instructions: "You are reviewing a pull request. Follow these steps...",
    };
    expect(SkillSchema.parse(skill)).toEqual(skill);
  });

  it("parses a skill with metadata", () => {
    const skill = {
      id: "review-pr",
      name: "Review PR",
      description: "Reviews a pull request for code quality",
      instructions: "You are reviewing a pull request.",
      metadata: {
        tags: ["code-review", "git"],
        category: "development",
      },
    };
    expect(SkillSchema.parse(skill)).toEqual(skill);
  });

  it("parses a skill with partial metadata", () => {
    const skill = {
      id: "deploy",
      name: "Deploy",
      description: "Deploys the application",
      instructions: "Follow the deployment checklist.",
      metadata: {
        category: "ops",
      },
    };
    expect(SkillSchema.parse(skill)).toEqual(skill);
  });

  it("parses a skill without metadata", () => {
    const skill = {
      id: "debug",
      name: "Debug",
      description: "Debug an issue",
      instructions: "Start by reproducing the issue.",
    };
    const parsed = SkillSchema.parse(skill);
    expect(parsed.metadata).toBeUndefined();
  });

  it("rejects skill missing required id", () => {
    const skill = {
      name: "Review PR",
      description: "Reviews a PR",
      instructions: "Review it.",
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });

  it("rejects skill missing required name", () => {
    const skill = {
      id: "review-pr",
      description: "Reviews a PR",
      instructions: "Review it.",
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });

  it("rejects skill missing required description", () => {
    const skill = {
      id: "review-pr",
      name: "Review PR",
      instructions: "Review it.",
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });

  it("rejects skill missing required instructions", () => {
    const skill = {
      id: "review-pr",
      name: "Review PR",
      description: "Reviews a PR",
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });
});
