/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { InputBar } from "../InputBar";

vi.mock("../../lib/settings-api", () => ({
  listSkillsApi: vi.fn().mockResolvedValue([]),
}));

Element.prototype.scrollIntoView = vi.fn();

async function renderInputBar(overrides: Partial<React.ComponentProps<typeof InputBar>> = {}) {
  const props = {
    onSend: vi.fn(),
    onStop: vi.fn(),
    isStreaming: false,
    selectedSkills: [] as string[],
    onSelectedSkillsChange: vi.fn(),
    allowAdditional: true,
    onAllowAdditionalChange: vi.fn(),
    ...overrides,
  };
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<InputBar {...props} />);
  });
  return { ...result, props };
}

function typeAndSend(text: string) {
  const textarea = screen.getByLabelText("Ask about your data");
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InputBar skill scope passing", () => {
  it("calls onSend with message only when no skills are selected", async () => {
    const { props } = await renderInputBar();
    typeAndSend("Hello world");

    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect(props.onSend).toHaveBeenCalledWith("Hello world");
  });

  it("calls onSend with strict=false when skills selected and allowAdditional=true", async () => {
    const { props } = await renderInputBar({
      selectedSkills: ["splunk-analyst", "login-investigator"],
      allowAdditional: true,
    });
    typeAndSend("Show me logins");

    expect(props.onSend).toHaveBeenCalledWith("Show me logins", {
      skills: ["splunk-analyst", "login-investigator"],
      strict: false,
    });
  });

  it("calls onSend with strict=true when skills selected and allowAdditional=false", async () => {
    const { props } = await renderInputBar({
      selectedSkills: ["splunk-analyst"],
      allowAdditional: false,
    });
    typeAndSend("Analyze this");

    expect(props.onSend).toHaveBeenCalledWith("Analyze this", {
      skills: ["splunk-analyst"],
      strict: true,
    });
  });

  it("does not call onSelectedSkillsChange during submit", async () => {
    const { props } = await renderInputBar({
      selectedSkills: ["splunk-analyst"],
    });
    typeAndSend("Test message");

    expect(props.onSelectedSkillsChange).not.toHaveBeenCalled();
  });

  it("does not send when message is empty", async () => {
    const { props } = await renderInputBar();
    typeAndSend("   ");

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not send when streaming", async () => {
    const { props } = await renderInputBar({ isStreaming: true });
    const textarea = screen.getByLabelText("Ask about your data");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("clears input after sending", async () => {
    await renderInputBar();
    typeAndSend("Hello");

    const textarea = screen.getByLabelText("Ask about your data") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("sends via button click too", async () => {
    const { props } = await renderInputBar({
      selectedSkills: ["splunk-analyst"],
      allowAdditional: false,
    });

    const textarea = screen.getByLabelText("Ask about your data");
    fireEvent.change(textarea, { target: { value: "Via button" } });

    const sendBtn = screen.getByLabelText("Send message");
    fireEvent.click(sendBtn);

    expect(props.onSend).toHaveBeenCalledWith("Via button", {
      skills: ["splunk-analyst"],
      strict: true,
    });
  });

  it("does not send on Shift+Enter (allows newline)", async () => {
    const { props } = await renderInputBar();
    const textarea = screen.getByLabelText("Ask about your data");
    fireEvent.change(textarea, { target: { value: "line 1" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("calls onStop when stop button is clicked", async () => {
    const { props } = await renderInputBar({ isStreaming: true });
    const stopBtn = screen.getByLabelText("Stop generation");
    fireEvent.click(stopBtn);

    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("shows streaming placeholder when streaming", async () => {
    await renderInputBar({ isStreaming: true });
    const textarea = screen.getByLabelText("Ask about your data");
    expect(textarea).toHaveAttribute("placeholder", "Waiting for analysis to complete...");
  });
});
