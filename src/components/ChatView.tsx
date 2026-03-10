import React, { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { fetchHealth } from "../lib/api";
import type { HealthResponse, HealthCheck } from "../lib/api";
import type { Message } from "../types";

interface ChatViewProps {
  messages: Message[];
  isStreaming: boolean;
  onSend?: (message: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  ok: "bg-green-400",
  degraded: "bg-yellow-400",
  error: "bg-red-400",
};

const HINTS: Record<string, string> = {
  "not configured": "Run node bin/setup.cjs, or set SPLUNK_HOST in .env",
  unreachable: "Check SPLUNK_HOST and network connectivity",
  "auth failed": "Check Splunk credentials in .env or re-run node bin/setup.cjs",
  "CLI not found": "Install Claude CLI: npm install -g @anthropic-ai/claude-code",
  "invalid API key": "Check ANTHROPIC_API_KEY in .env",
};

function getHint(check: HealthCheck): string | null {
  if (check.status === "ok" || !check.message) return null;
  return HINTS[check.message] ?? null;
}

function SystemStatusCard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() =>
        setHealth({ status: "error", checks: { api: { status: "error", message: "unreachable" } } })
      );
  }, []);

  if (!health) return null;

  const allOk = health.status === "ok";

  if (allOk) {
    return (
      <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
        <span className="block w-1.5 h-1.5 rounded-full bg-green-400" />
        <span className="text-xs text-green-400/80">
          {Object.keys(health.checks)
            .map((name) => {
              const label = name.charAt(0).toUpperCase() + name.slice(1);
              return `${label} connected`;
            })
            .join(" \u00b7 ")}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-5 max-w-xs mx-auto px-3 py-2.5 rounded-lg bg-surface-2/60 border border-border-subtle">
      <div className="space-y-1.5">
        {Object.entries(health.checks).map(([name, check]) => {
          const hint = getHint(check);
          return (
            <div key={name} className="flex items-start gap-2">
              <span
                className={`block w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${STATUS_COLORS[check.status] ?? "bg-gray-500"}`}
              />
              <div className="min-w-0">
                <span className="text-xs text-gray-300 capitalize">{name}</span>
                {check.message && (
                  <span className="text-xs text-gray-500 ml-1.5">{check.message}</span>
                )}
                {hint && <p className="text-[11px] text-gray-600">{hint}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChatView({ messages, isStreaming, onSend }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-lg">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-dim/20 border border-accent/20 flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent-light"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-200 mb-2">Start an Investigation</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            Ask a question about your data. I'll build a narrative analysis with live
            visualizations, exploring your data step by step.
          </p>
          <SystemStatusCard />
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              "What does login activity look like?",
              "Show me the top sourcetypes by volume",
              "Are there any error spikes recently?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onSend?.(suggestion)}
                aria-label={`Investigate: ${suggestion}`}
                className="text-xs px-3 py-1.5 rounded-full glass glass-hover text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
