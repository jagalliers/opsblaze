import { useState, useCallback, useRef, useEffect } from "react";
import { streamChat } from "../lib/sse";
import {
  loadConversation,
  createConversation,
  updateConversation,
  deleteConversation as deleteConversationApi,
} from "../lib/api";
import type { Message, ChartBlock, SkillBlock, TextBlock } from "../types";

const ACTIVE_CONV_KEY = "opsblaze_active_conversation";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (plain HTTP from non-localhost)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let messageCounter = 0;
function nextId(): string {
  return `msg_${++messageCounter}_${Date.now()}`;
}

function deriveTitle(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  const truncated = cleaned.slice(0, 57);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

function stripStreamingFlags(msgs: Message[]): Message[] {
  return msgs.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
}

function appendText(msgs: Message[], id: string, text: string): Message[] {
  const updated = [...msgs];
  const msg = updated.find((m) => m.id === id);
  if (!msg) return msgs;

  const blocks = [...msg.blocks];
  const lastBlock = blocks[blocks.length - 1];

  if (lastBlock && lastBlock.type === "text") {
    blocks[blocks.length - 1] = {
      ...lastBlock,
      content: lastBlock.content + text,
    };
  } else {
    blocks.push({ type: "text", content: text });
  }

  const idx = updated.findIndex((m) => m.id === id);
  updated[idx] = { ...msg, blocks };
  return updated;
}

function appendChart(msgs: Message[], id: string, data: Record<string, unknown>): Message[] {
  const updated = [...msgs];
  const msg = updated.find((m) => m.id === id);
  if (!msg) return msgs;

  const chartBlock: ChartBlock = {
    type: "chart",
    vizType: data.vizType as ChartBlock["vizType"],
    dataSources: data.dataSources as ChartBlock["dataSources"],
    width: data.width as number,
    height: data.height as number,
    spl: data.spl as string | undefined,
    earliest: data.earliest as string | undefined,
    latest: data.latest as string | undefined,
  };

  const blocks = [...msg.blocks, chartBlock];
  const idx = updated.findIndex((m) => m.id === id);
  updated[idx] = { ...msg, blocks };
  return updated;
}

function appendSkill(msgs: Message[], id: string, skill: string): Message[] {
  const updated = [...msgs];
  const msg = updated.find((m) => m.id === id);
  if (!msg) return msgs;

  const alreadyHas = msg.blocks.some(
    (b): b is SkillBlock => b.type === "skill" && b.skill === skill
  );
  if (alreadyHas) return msgs;

  const blocks = [...msg.blocks];
  let insertIdx = 0;
  while (insertIdx < blocks.length && blocks[insertIdx].type === "skill") {
    insertIdx++;
  }
  blocks.splice(insertIdx, 0, { type: "skill" as const, skill });

  const idx = updated.findIndex((m) => m.id === id);
  updated[idx] = { ...msg, blocks };
  return updated;
}

function appendError(msgs: Message[], id: string, errorMsg: string): Message[] {
  const updated = [...msgs];
  const msg = updated.find((m) => m.id === id);
  if (!msg) return msgs;

  const blocks = [...msg.blocks];
  blocks.push({ type: "text", content: `\n\n> **Error:** ${errorMsg}\n\n` });

  const idx = updated.findIndex((m) => m.id === id);
  updated[idx] = { ...msg, blocks };
  return updated;
}

function markDone(msgs: Message[], id: string): Message[] {
  const updated = [...msgs];
  const msg = updated.find((m) => m.id === id);
  if (!msg) return msgs;

  const idx = updated.findIndex((m) => m.id === id);
  updated[idx] = { ...msg, isStreaming: false };
  return updated;
}

function saveToDisk(msgs: Message[], convId: string) {
  updateConversation(convId, {
    messages: stripStreamingFlags(msgs),
  }).catch((err) => {
    if (import.meta.env.DEV) console.warn("[OpsBlaze] failed to save conversation:", err);
  });
}

export function buildSkillRequest(
  content: string,
  skillScope?: { skills: string[]; strict: boolean }
): { apiContent: string; apiSkills: string[] | undefined } {
  const hasSkills = skillScope && skillScope.skills.length > 0;
  const apiContent =
    hasSkills && !skillScope.strict
      ? `[Use skills: ${skillScope.skills.join(", ")}]\n\n${content}`
      : content;
  const apiSkills = hasSkills && skillScope.strict ? skillScope.skills : undefined;
  return { apiContent, apiSkills };
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);

  const convIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  // Abort controllers keyed by conversation ID
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    convIdRef.current = conversationId;
  }, [conversationId]);

  // Abort all background streams on unmount
  useEffect(() => {
    const controllers = abortControllers.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);

  const isDisplayed = useCallback((convId: string) => convIdRef.current === convId, []);

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_CONV_KEY);
    if (!stored) return;

    loadConversation(stored)
      .then((conv) => {
        setConversationId(conv.id);
        setConversationTitle(conv.title);
        setMessages(conv.messages as Message[]);
      })
      .catch(() => {
        localStorage.removeItem(ACTIVE_CONV_KEY);
      });
  }, []);

  const startNewConversation = useCallback(() => {
    // Flush whatever is on screen, but do NOT abort background streams
    const convId = convIdRef.current;
    if (convId && messagesRef.current.length > 0) {
      saveToDisk(messagesRef.current, convId);
    }

    setMessages([]);
    setIsStreaming(false);
    setConversationId(null);
    setConversationTitle(null);
    localStorage.removeItem(ACTIVE_CONV_KEY);
  }, []);

  const loadExistingConversation = useCallback(async (id: string) => {
    // Flush current view, but do NOT abort background streams
    const convId = convIdRef.current;
    if (convId && messagesRef.current.length > 0) {
      saveToDisk(messagesRef.current, convId);
    }

    setIsStreaming(false);

    try {
      const conv = await loadConversation(id);
      setConversationId(conv.id);
      setConversationTitle(conv.title);
      setMessages(conv.messages as Message[]);
      localStorage.setItem(ACTIVE_CONV_KEY, conv.id);
    } catch {
      setMessages([]);
      setConversationId(null);
      setConversationTitle(null);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, skillScope?: { skills: string[]; strict: boolean }) => {
      if (isStreaming) return;

      let activeConvId = conversationId;

      if (!activeConvId) {
        const id = generateUUID();
        const title = deriveTitle(content);
        try {
          await createConversation(id, title);
          activeConvId = id;
          setConversationId(id);
          setConversationTitle(title);
          localStorage.setItem(ACTIVE_CONV_KEY, id);
        } catch {
          // Continue without persistence
        }
      }

      const userMessage: Message = {
        id: nextId(),
        role: "user",
        blocks: [{ type: "text", content }],
      };

      const assistantId = nextId();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        blocks: [],
        isStreaming: true,
      };

      const currentMessages = messagesRef.current;

      // Local accumulator — lives in this closure, survives navigation
      let local = [...currentMessages, userMessage, assistantMessage];

      setMessages(local);
      setIsStreaming(true);

      if (activeConvId) {
        saveToDisk(local, activeConvId);
      }

      const abortController = new AbortController();
      if (activeConvId) {
        abortControllers.current.set(activeConvId, abortController);
      }

      const history = currentMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.blocks
            .filter((b): b is TextBlock => b.type === "text")
            .map((b) => b.content)
            .join(""),
        }))
        .filter((m) => m.content.trim());

      const { apiContent, apiSkills } = buildSkillRequest(content, skillScope);

      try {
        await streamChat(
          apiContent,
          history,
          {
            onText: (text) => {
              local = appendText(local, assistantId, text);
              if (activeConvId && isDisplayed(activeConvId)) {
                setMessages(local);
              }
            },
            onChart: (data) => {
              local = appendChart(local, assistantId, data);
              if (activeConvId && isDisplayed(activeConvId)) {
                setMessages(local);
              }
            },
            onSkill: (skill) => {
              local = appendSkill(local, assistantId, skill);
              if (activeConvId && isDisplayed(activeConvId)) {
                setMessages(local);
              }
            },
            onError: (errorMsg) => {
              local = appendError(local, assistantId, errorMsg);
              if (activeConvId && isDisplayed(activeConvId)) {
                setMessages(local);
              }
            },
            onDone: () => {
              local = markDone(local, assistantId);
              if (activeConvId) {
                saveToDisk(local, activeConvId);
                abortControllers.current.delete(activeConvId);
              }
              if (activeConvId && isDisplayed(activeConvId)) {
                setMessages(local);
                setIsStreaming(false);
              }
            },
          },
          abortController.signal,
          apiSkills
        );
      } catch (err) {
        const isAbort = (err as Error).name === "AbortError";

        if (!isAbort) {
          local = appendError(local, assistantId, `Connection error: ${(err as Error).message}`);
        }
        local = markDone(local, assistantId);

        if (activeConvId) {
          saveToDisk(local, activeConvId);
          abortControllers.current.delete(activeConvId);
        }
        if (activeConvId && isDisplayed(activeConvId)) {
          setMessages(local);
          setIsStreaming(false);
        }
      }
    },
    [isStreaming, conversationId, isDisplayed]
  );

  const stopStreaming = useCallback(() => {
    const convId = convIdRef.current;
    if (convId && abortControllers.current.has(convId)) {
      abortControllers.current.get(convId)!.abort();
      abortControllers.current.delete(convId);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    // Abort any running stream for this conversation
    if (abortControllers.current.has(id)) {
      abortControllers.current.get(id)!.abort();
      abortControllers.current.delete(id);
    }
    await deleteConversationApi(id);

    if (convIdRef.current === id) {
      setMessages([]);
      setIsStreaming(false);
      setConversationId(null);
      setConversationTitle(null);
      localStorage.removeItem(ACTIVE_CONV_KEY);
    }
  }, []);

  return {
    messages,
    isStreaming,
    conversationId,
    conversationTitle,
    sendMessage,
    startNewConversation,
    loadExistingConversation,
    deleteConversation,
    stopStreaming,
  };
}
