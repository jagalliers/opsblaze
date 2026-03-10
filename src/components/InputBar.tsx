import React, { useState, useRef, useEffect } from "react";
import { SkillPicker } from "./SkillPicker";

interface InputBarProps {
  onSend: (message: string, skillScope?: { skills: string[]; strict: boolean }) => void;
  onStop: () => void;
  isStreaming: boolean;
  selectedSkills: string[];
  onSelectedSkillsChange: (skills: string[]) => void;
  allowAdditional: boolean;
  onAllowAdditionalChange: (allow: boolean) => void;
}

export function InputBar({
  onSend,
  onStop,
  isStreaming,
  selectedSkills,
  onSelectedSkillsChange,
  allowAdditional,
  onAllowAdditionalChange,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    if (selectedSkills.length > 0) {
      onSend(trimmed, { skills: selectedSkills, strict: !allowAdditional });
    } else {
      onSend(trimmed);
    }
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div className="border-t border-border-subtle bg-surface-1/80 backdrop-blur-md px-4 py-3">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end gap-3 glass rounded-xl px-4 py-2.5 focus-within:border-accent/30 transition-colors">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            aria-label="Ask about your data"
            placeholder={
              isStreaming ? "Waiting for analysis to complete..." : "Ask about your data..."
            }
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 resize-none outline-none min-h-[24px] max-h-[200px] leading-relaxed disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/80 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
              title="Stop generation"
              aria-label="Stop generation"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!value.trim()}
              title="Send message"
              aria-label="Send message"
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent hover:bg-accent-dim disabled:bg-surface-3 disabled:text-gray-600 text-white flex items-center justify-center transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
        <SkillPicker
          selectedSkills={selectedSkills}
          onSelectedSkillsChange={onSelectedSkillsChange}
          allowAdditional={allowAdditional}
          onAllowAdditionalChange={onAllowAdditionalChange}
          disabled={isStreaming}
        />
        <div className="flex items-center justify-center mt-2 h-4">
          <span className={`text-[10px] ${isStreaming ? "fire-text" : "text-gray-600"}`}>
            OpsBlaze
          </span>
        </div>
      </div>
    </div>
  );
}
