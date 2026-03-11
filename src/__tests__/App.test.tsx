/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

const mockStartNew = vi.fn();
const mockLoadExisting = vi.fn();
const mockSendMessage = vi.fn();
const mockDeleteConversation = vi.fn().mockResolvedValue(undefined);
const mockStopStreaming = vi.fn();

vi.mock("../hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    isStreaming: false,
    conversationId: null,
    conversationTitle: null,
    sendMessage: mockSendMessage,
    startNewConversation: mockStartNew,
    loadExistingConversation: mockLoadExisting,
    deleteConversation: mockDeleteConversation,
    stopStreaming: mockStopStreaming,
  }),
}));

vi.mock("../lib/settings-api", () => ({
  listSkillsApi: vi.fn().mockResolvedValue([
    { name: "splunk-analyst", description: "Expert Splunk analyst", enabled: true, path: "" },
    { name: "login-investigator", description: "Login investigation", enabled: true, path: "" },
  ]),
}));

vi.mock("../components/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));

vi.mock("../components/SkillExtractor", () => ({
  SkillExtractor: () => null,
}));

vi.mock("../lib/api", () => ({
  headers: () => ({}),
  fetchHealth: vi.fn().mockResolvedValue({ status: "ok", checks: {} }),
  listConversations: vi.fn().mockResolvedValue([
    {
      id: "conv-1",
      title: "Old investigation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 3,
    },
  ]),
  searchConversations: vi.fn().mockResolvedValue([]),
}));

Element.prototype.scrollIntoView = vi.fn();

import { App } from "../App";

beforeEach(() => {
  vi.clearAllMocks();
});

async function selectSkill(name: string) {
  const addInput = await screen.findByPlaceholderText(/Add skills/);
  fireEvent.focus(addInput);
  await screen.findByPlaceholderText("Filter skills...");
  fireEvent.click(screen.getByText(name));
}

describe("App skill reset on investigation switch", () => {
  it("clears selected skills when 'New Investigation' is clicked", async () => {
    await act(async () => {
      render(<App />);
    });

    await selectSkill("splunk-analyst");
    expect(screen.getByText("splunk-analyst")).toBeInTheDocument();

    const newBtn = screen.getByText("New Investigation");
    fireEvent.click(newBtn);

    expect(mockStartNew).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByLabelText("Remove skill splunk-analyst")).not.toBeInTheDocument();
    });
  });

  it("resets allowAdditional to true when starting new investigation", async () => {
    await act(async () => {
      render(<App />);
    });

    await selectSkill("splunk-analyst");
    const toggle = screen.getByLabelText("Restrict to selected skills only");
    fireEvent.click(toggle);

    fireEvent.click(screen.getByText("New Investigation"));

    await waitFor(() => {
      expect(screen.queryByText("Include additional skills")).not.toBeInTheDocument();
    });
  });

  it("clears selected skills when loading an existing conversation from sidebar", async () => {
    await act(async () => {
      render(<App />);
    });

    await selectSkill("splunk-analyst");
    expect(screen.getByText("splunk-analyst")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Toggle investigations sidebar"));

    const conv = await screen.findByText("Old investigation");
    fireEvent.click(conv);

    expect(mockLoadExisting).toHaveBeenCalledWith("conv-1");
    await waitFor(() => {
      expect(screen.queryByLabelText("Remove skill splunk-analyst")).not.toBeInTheDocument();
    });
  });

  it("clears selected skills when deleting the active conversation", async () => {
    await act(async () => {
      render(<App />);
    });

    await selectSkill("splunk-analyst");
    expect(screen.getByText("splunk-analyst")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Toggle investigations sidebar"));
    const deleteBtn = await screen.findByLabelText("Delete investigation: Old investigation");
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(mockDeleteConversation).toHaveBeenCalledWith("conv-1");
    await waitFor(() => {
      expect(screen.queryByLabelText("Remove skill splunk-analyst")).not.toBeInTheDocument();
    });
  });

  it("clears selected skills when '+ New' is clicked in sidebar", async () => {
    await act(async () => {
      render(<App />);
    });

    await selectSkill("login-investigator");
    expect(screen.getByText("login-investigator")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Toggle investigations sidebar"));
    const newBtn = await screen.findByLabelText("New investigation");
    fireEvent.click(newBtn);

    expect(mockStartNew).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByLabelText("Remove skill login-investigator")).not.toBeInTheDocument();
    });
  });
});
