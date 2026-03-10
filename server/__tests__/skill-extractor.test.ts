import { describe, it, expect } from "vitest";
import { parseSkillDraft } from "../skill-extractor.js";

describe("parseSkillDraft", () => {
  it("parses valid YAML frontmatter", () => {
    const raw = `---
name: investigating-login-anomalies
description: Investigates login anomalies and auth patterns.
---

# Login Investigation

When investigating login anomalies, start by...`;

    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("investigating-login-anomalies");
    expect(draft.description).toBe("Investigates login anomalies and auth patterns.");
    expect(draft.content).toContain("# Login Investigation");
  });

  it("strips code fences around content", () => {
    const raw =
      "```markdown\n---\nname: my-skill\ndescription: A skill.\n---\n\n# Title\n\nBody.\n```";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("my-skill");
    expect(draft.content).toContain("# Title");
    expect(draft.content).not.toContain("```");
  });

  it("strips ```md fences", () => {
    const raw = "```md\n---\nname: test\ndescription: test desc\n---\n\n# Test\n```";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("test");
  });

  it("handles preamble text before frontmatter", () => {
    const raw =
      "Here is the skill:\n\n---\nname: extracted\ndescription: Extracted skill.\n---\n\n# Body";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("extracted");
    expect(draft.content.startsWith("---")).toBe(true);
  });

  it("normalizes name to kebab-case lowercase", () => {
    const raw = "---\nname: My Cool Skill!\ndescription: test\n---\n\n# Content";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("my-cool-skill");
  });

  it("strips consecutive hyphens from name", () => {
    const raw = "---\nname: bad---name---here\ndescription: test\n---\n\n# Content";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("bad-name-here");
  });

  it("strips leading/trailing hyphens from name", () => {
    const raw = "---\nname: -leading-trailing-\ndescription: test\n---\n\n# Content";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("leading-trailing");
  });

  it("defaults to 'untitled-skill' when name is empty", () => {
    const raw = "---\nname: \ndescription: test\n---\n\n# Content";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("untitled-skill");
  });

  it("defaults to 'untitled-skill' when no frontmatter", () => {
    const raw = "# Just a title\n\nSome content without frontmatter.";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("untitled-skill");
    expect(draft.description).toBe("");
  });

  it("strips quotes from name and description", () => {
    const raw = "---\nname: \"quoted-name\"\ndescription: 'quoted desc'\n---\n\n# Content";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("quoted-name");
    expect(draft.description).toBe("quoted desc");
  });

  it("preserves full content including frontmatter", () => {
    const raw =
      "---\nname: full\ndescription: test\n---\n\n# Title\n\nParagraph one.\n\n## Section\n\nParagraph two.";
    const draft = parseSkillDraft(raw);
    expect(draft.content).toContain("---\nname: full");
    expect(draft.content).toContain("# Title");
    expect(draft.content).toContain("## Section");
  });

  it("handles stray dashes before code fence", () => {
    const raw =
      "---\n```markdown\n---\nname: fence-after-dash\ndescription: test\n---\n\n# Content\n```";
    const draft = parseSkillDraft(raw);
    expect(draft.name).toBe("fence-after-dash");
  });
});
