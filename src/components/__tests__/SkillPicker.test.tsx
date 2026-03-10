/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { SkillPicker } from "../SkillPicker";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("../../lib/settings-api", () => ({
  listSkillsApi: vi.fn(),
}));

import { listSkillsApi } from "../../lib/settings-api";
const mockListSkills = vi.mocked(listSkillsApi);

const MOCK_SKILLS = [
  { name: "splunk-analyst", description: "Expert Splunk analyst", enabled: true, path: "" },
  {
    name: "login-investigator",
    description: "Login activity investigation",
    enabled: true,
    path: "",
  },
  { name: "network-monitor", description: "Network monitoring skill", enabled: true, path: "" },
  { name: "disabled-skill", description: "This skill is disabled", enabled: false, path: "" },
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof SkillPicker>> = {}) {
  const props = {
    selectedSkills: [] as string[],
    onSelectedSkillsChange: vi.fn(),
    allowAdditional: true,
    onAllowAdditionalChange: vi.fn(),
    disabled: false,
    ...overrides,
  };
  const result = render(<SkillPicker {...props} />);
  return { ...result, props };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListSkills.mockResolvedValue(MOCK_SKILLS);
});

describe("SkillPicker", () => {
  describe("rendering", () => {
    it("shows 'Add skills...' placeholder when skills are loaded", async () => {
      renderPicker();
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Add skills...")).toBeInTheDocument();
      });
    });

    it("returns null while loading", () => {
      mockListSkills.mockReturnValue(new Promise(() => {})); // never resolves
      const { container } = renderPicker();
      expect(container.innerHTML).toBe("");
    });

    it("returns null when no skills exist", async () => {
      mockListSkills.mockResolvedValue([]);
      const { container } = renderPicker();
      await waitFor(() => {
        expect(container.innerHTML).toBe("");
      });
    });
  });

  describe("dropdown interactions", () => {
    it("opens dropdown when input is focused", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Filter skills...")).toBeInTheDocument();
      });
    });

    it("renders dropdown via portal at document.body", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));

      await waitFor(() => {
        const filterInput = screen.getByPlaceholderText("Filter skills...");
        expect(filterInput.closest("[class*='fixed']")).toBeTruthy();
      });
    });

    it("closes dropdown when backdrop is clicked", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      const backdrop = document.querySelector('[aria-hidden="true"]');
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText("Filter skills...")).not.toBeInTheDocument();
      });
    });

    it("Escape clears search query and resets activeIndex", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      const panelInput = screen.getByPlaceholderText("Filter skills...");
      fireEvent.change(panelInput, { target: { value: "splunk" } });
      expect(panelInput).toHaveValue("splunk");

      fireEvent.keyDown(panelInput, { key: "Escape" });

      // closeDropdown clears search; focus returns to inline input
      // (inline input's onFocus re-opens the dropdown, but search is cleared)
      const inlineInput = screen.getByPlaceholderText("Add skills...");
      expect(inlineInput).toHaveValue("");
    });
  });

  describe("search filtering", () => {
    it("filters skills by name (case-insensitive)", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      fireEvent.change(screen.getByPlaceholderText("Filter skills..."), {
        target: { value: "splunk" },
      });

      await waitFor(() => {
        expect(screen.getByText("splunk-analyst")).toBeInTheDocument();
        expect(screen.queryByText("login-investigator")).not.toBeInTheDocument();
        expect(screen.queryByText("network-monitor")).not.toBeInTheDocument();
      });
    });

    it("filters skills by description", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      fireEvent.change(screen.getByPlaceholderText("Filter skills..."), {
        target: { value: "login activity" },
      });

      await waitFor(() => {
        expect(screen.getByText("login-investigator")).toBeInTheDocument();
        expect(screen.queryByText("splunk-analyst")).not.toBeInTheDocument();
      });
    });

    it("shows result count when filtered", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      fireEvent.change(screen.getByPlaceholderText("Filter skills..."), {
        target: { value: "splunk" },
      });

      await waitFor(() => {
        expect(screen.getByText(/1 of 4 skills/)).toBeInTheDocument();
      });
    });

    it("shows total count when unfiltered", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      expect(screen.getByText("4 skills")).toBeInTheDocument();
    });

    it("shows 'No matching skills' when filter matches nothing", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      fireEvent.change(screen.getByPlaceholderText("Filter skills..."), {
        target: { value: "zzzznonexistent" },
      });

      await waitFor(() => {
        expect(screen.getByText("No matching skills")).toBeInTheDocument();
      });
    });
  });

  describe("keyboard navigation", () => {
    it("ArrowDown opens dropdown when closed", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      const input = screen.getByPlaceholderText("Add skills...");
      fireEvent.keyDown(input, { key: "ArrowDown" });

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Filter skills...")).toBeInTheDocument();
      });
    });

    it("Enter selects the first (active) item", async () => {
      const { props } = renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      const panelInput = screen.getByPlaceholderText("Filter skills...");
      fireEvent.keyDown(panelInput, { key: "Enter" });

      expect(props.onSelectedSkillsChange).toHaveBeenCalledWith(["splunk-analyst"]);
    });

    it("ArrowDown then Enter selects second item", async () => {
      const { props } = renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      const panelInput = screen.getByPlaceholderText("Filter skills...");
      fireEvent.keyDown(panelInput, { key: "ArrowDown" });
      fireEvent.keyDown(panelInput, { key: "Enter" });

      expect(props.onSelectedSkillsChange).toHaveBeenCalledWith(["login-investigator"]);
    });
  });

  describe("skill selection", () => {
    it("adds skill when clicked", async () => {
      const { props } = renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByText("splunk-analyst"));

      fireEvent.click(screen.getByText("splunk-analyst"));

      expect(props.onSelectedSkillsChange).toHaveBeenCalledWith(["splunk-analyst"]);
    });

    it("clears search and calls onSelectedSkillsChange on selection", async () => {
      const { props } = renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      fireEvent.change(screen.getByPlaceholderText("Filter skills..."), {
        target: { value: "splunk" },
      });
      fireEvent.click(screen.getByText("splunk-analyst"));

      expect(props.onSelectedSkillsChange).toHaveBeenCalledWith(["splunk-analyst"]);
      // Search query is cleared after selection
      const inlineInput = screen.getByPlaceholderText("Add skills...");
      expect(inlineInput).toHaveValue("");
    });
  });

  describe("skill removal", () => {
    it("removes skill when X button is clicked", async () => {
      const { props } = renderPicker({ selectedSkills: ["splunk-analyst"] });
      await waitFor(() => screen.getByText("splunk-analyst"));

      const removeBtn = screen.getByLabelText("Remove skill splunk-analyst");
      fireEvent.click(removeBtn);

      expect(props.onSelectedSkillsChange).toHaveBeenCalledWith([]);
    });

    it("Backspace on empty search removes last chip", async () => {
      const { props } = renderPicker({
        selectedSkills: ["splunk-analyst", "login-investigator"],
      });
      await waitFor(() => screen.getByPlaceholderText("Add more..."));

      const input = screen.getByPlaceholderText("Add more...");
      fireEvent.keyDown(input, { key: "Backspace" });

      expect(props.onSelectedSkillsChange).toHaveBeenCalledWith(["splunk-analyst"]);
    });
  });

  describe("disabled skills", () => {
    it("shows disabled skills with (disabled) label", async () => {
      renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByText("disabled-skill"));

      expect(screen.getByText("(disabled)")).toBeInTheDocument();
    });

    it("disabled skills are not clickable (rendered as div, not button)", async () => {
      const { props } = renderPicker();
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      fireEvent.focus(screen.getByPlaceholderText("Add skills..."));
      await waitFor(() => screen.getByText("disabled-skill"));

      const disabledEl = screen
        .getByText("disabled-skill")
        .closest("[class*='cursor-not-allowed']");
      expect(disabledEl).toBeTruthy();
      expect(disabledEl?.tagName).toBe("DIV");
    });
  });

  describe("allowAdditional toggle", () => {
    it("does not show toggle when no skills are selected", async () => {
      renderPicker({ selectedSkills: [] });
      await waitFor(() => screen.getByPlaceholderText("Add skills..."));

      expect(screen.queryByText("Include additional skills")).not.toBeInTheDocument();
    });

    it("shows toggle when skills are selected", async () => {
      renderPicker({ selectedSkills: ["splunk-analyst"] });
      await waitFor(() => screen.getByText("Include additional skills"));

      expect(screen.getByText("Include additional skills")).toBeInTheDocument();
    });

    it("calls onAllowAdditionalChange when toggle is clicked", async () => {
      const { props } = renderPicker({
        selectedSkills: ["splunk-analyst"],
        allowAdditional: true,
      });
      await waitFor(() => screen.getByText("Include additional skills"));

      const toggle = screen.getByLabelText("Restrict to selected skills only");
      fireEvent.click(toggle);

      expect(props.onAllowAdditionalChange).toHaveBeenCalledWith(false);
    });
  });

  describe("already-selected skills", () => {
    it("excludes selected skills from dropdown list", async () => {
      renderPicker({ selectedSkills: ["splunk-analyst"] });
      await waitFor(() => screen.getByPlaceholderText("Add more..."));

      fireEvent.focus(screen.getByPlaceholderText("Add more..."));
      await waitFor(() => screen.getByPlaceholderText("Filter skills..."));

      const enabledButtons = document.querySelectorAll("[data-skill-item]");
      const names = Array.from(enabledButtons).map((b) => b.textContent);
      expect(names.join(" ")).not.toContain("splunk-analyst");
      expect(screen.getByText("login-investigator")).toBeInTheDocument();
    });

    it("shows 'Add more...' placeholder when skills are selected", async () => {
      renderPicker({ selectedSkills: ["splunk-analyst"] });
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Add more...")).toBeInTheDocument();
      });
    });
  });
});
