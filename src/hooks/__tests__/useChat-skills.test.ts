import { describe, it, expect } from "vitest";
import { buildSkillRequest } from "../useChat";

describe("buildSkillRequest", () => {
  const MESSAGE = "Show me failed logins";

  describe("advisory mode (strict: false)", () => {
    it("prepends skill directive to content", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE, {
        skills: ["splunk-analyst", "login-investigator"],
        strict: false,
      });
      expect(apiContent).toBe("[Use skills: splunk-analyst, login-investigator]\n\n" + MESSAGE);
      expect(apiSkills).toBeUndefined();
    });

    it("formats single skill correctly", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE, {
        skills: ["splunk-analyst"],
        strict: false,
      });
      expect(apiContent).toBe("[Use skills: splunk-analyst]\n\n" + MESSAGE);
      expect(apiSkills).toBeUndefined();
    });
  });

  describe("strict mode (strict: true)", () => {
    it("preserves original content and passes skills array", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE, {
        skills: ["splunk-analyst", "login-investigator"],
        strict: true,
      });
      expect(apiContent).toBe(MESSAGE);
      expect(apiSkills).toEqual(["splunk-analyst", "login-investigator"]);
    });

    it("works with single skill", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE, {
        skills: ["splunk-analyst"],
        strict: true,
      });
      expect(apiContent).toBe(MESSAGE);
      expect(apiSkills).toEqual(["splunk-analyst"]);
    });
  });

  describe("no skills", () => {
    it("returns original content when skillScope is undefined", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE);
      expect(apiContent).toBe(MESSAGE);
      expect(apiSkills).toBeUndefined();
    });

    it("returns original content when skills array is empty (advisory)", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE, {
        skills: [],
        strict: false,
      });
      expect(apiContent).toBe(MESSAGE);
      expect(apiSkills).toBeUndefined();
    });

    it("returns original content when skills array is empty (strict)", () => {
      const { apiContent, apiSkills } = buildSkillRequest(MESSAGE, {
        skills: [],
        strict: true,
      });
      expect(apiContent).toBe(MESSAGE);
      expect(apiSkills).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("handles skills with special characters in names", () => {
      const { apiContent } = buildSkillRequest(MESSAGE, {
        skills: ["my-skill-v2.0", "skill_with_underscores"],
        strict: false,
      });
      expect(apiContent).toBe("[Use skills: my-skill-v2.0, skill_with_underscores]\n\n" + MESSAGE);
    });

    it("handles message content with brackets", () => {
      const bracketMsg = "What is [this] about?";
      const { apiContent } = buildSkillRequest(bracketMsg, {
        skills: ["analyst"],
        strict: false,
      });
      expect(apiContent).toBe("[Use skills: analyst]\n\nWhat is [this] about?");
    });

    it("handles multiline message content", () => {
      const multiline = "Line 1\nLine 2\nLine 3";
      const { apiContent } = buildSkillRequest(multiline, {
        skills: ["analyst"],
        strict: false,
      });
      expect(apiContent).toContain("\n\nLine 1\nLine 2\nLine 3");
    });
  });
});
