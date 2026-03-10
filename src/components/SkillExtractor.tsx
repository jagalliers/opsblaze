import React, { useState, useEffect, useCallback, useRef } from "react";
import { extractSkillApi, refineSkillApi, createSkillApi } from "../lib/settings-api";
import type { SkillDraft } from "../lib/settings-api";

type Phase = "extracting" | "editing" | "refining" | "saving" | "saved" | "error";

interface SkillExtractorProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string | null;
  conversationTitle: string | null;
}

export function SkillExtractor({
  isOpen,
  onClose,
  conversationId,
  conversationTitle,
}: SkillExtractorProps) {
  const [phase, setPhase] = useState<Phase>("extracting");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [refinementInput, setRefinementInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refinementRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const hasExtracted = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setPhase("extracting");
    setName("");
    setDescription("");
    setContent("");
    setRefinementInput("");
    setError(null);
    setSaveError(null);
    hasExtracted.current = false;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      reset();
      return;
    }
    if (!conversationId || hasExtracted.current) return;
    hasExtracted.current = true;

    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        setPhase("extracting");
        setError(null);
        const draft = await extractSkillApi(conversationId, ac.signal);
        if (ac.signal.aborted) return;
        applyDraft(draft);
        setPhase("editing");
      } catch (err) {
        if ((err as Error).name === "AbortError" || ac.signal.aborted) return;
        setError((err as Error).message);
        setPhase("error");
      }
    })();
  }, [isOpen, conversationId, reset]);

  function applyDraft(draft: SkillDraft) {
    setName(draft.name);
    setDescription(draft.description);
    setContent(draft.content);
  }

  const handleRefine = async () => {
    if (!refinementInput.trim()) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("refining");
    setError(null);
    try {
      const draft = await refineSkillApi(
        content,
        refinementInput.trim(),
        conversationTitle ?? "",
        ac.signal
      );
      if (ac.signal.aborted) return;
      applyDraft(draft);
      setRefinementInput("");
      setPhase("editing");
    } catch (err) {
      if ((err as Error).name === "AbortError" || ac.signal.aborted) return;
      setError((err as Error).message);
      setPhase("editing");
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    const safeName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!safeName) {
      setSaveError("Please enter a valid skill name");
      return;
    }
    if (!content.trim()) {
      setSaveError("Skill content cannot be empty");
      return;
    }

    setPhase("saving");
    try {
      await createSkillApi(safeName, content);
      setName(safeName);
      setPhase("saved");
    } catch (err) {
      setSaveError((err as Error).message);
      setPhase("editing");
    }
  };

  const handleRetry = () => {
    hasExtracted.current = false;
    reset();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Modal */}
        <div
          ref={modalRef}
          className="bg-surface-1 border border-border-subtle rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-base font-semibold text-gray-100">Distill Skill</h2>
              {conversationTitle && (
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">
                  From: {conversationTitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-surface-3 transition-colors"
              aria-label="Close"
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Extracting state */}
            {phase === "extracting" && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 rounded-full bg-accent animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full bg-accent animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full bg-accent animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
                <p className="text-sm text-gray-400">
                  Analyzing conversation and extracting methodology...
                </p>
                <p className="text-xs text-gray-600">This may take 15-30 seconds</p>
              </div>
            )}

            {/* Error state */}
            {phase === "error" && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <p className="text-sm text-red-400">{error}</p>
                <button
                  onClick={handleRetry}
                  className="text-xs px-3 py-1.5 rounded border border-border-subtle text-gray-300 hover:bg-surface-3 transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Editing / Refining / Saving / Saved states */}
            {(phase === "editing" ||
              phase === "refining" ||
              phase === "saving" ||
              phase === "saved") && (
              <>
                {/* Name */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Skill Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={phase === "saved"}
                    placeholder="my-investigation-skill"
                    className="w-full text-sm bg-surface-0 border border-border-subtle rounded px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 font-mono disabled:opacity-50"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={phase === "saved"}
                    placeholder="When this skill should activate..."
                    className="w-full text-sm bg-surface-0 border border-border-subtle rounded px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 disabled:opacity-50"
                  />
                </div>

                {/* Content editor */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-500">Skill Content</label>
                    {content &&
                      (() => {
                        const lineCount = content.split("\n").length;
                        const over = lineCount > 500;
                        return (
                          <span className={`text-xs ${over ? "text-amber-400" : "text-gray-600"}`}>
                            {lineCount} lines{over ? " — consider refining to stay under 500" : ""}
                          </span>
                        );
                      })()}
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={phase === "refining" || phase === "saved"}
                    className="w-full h-64 text-xs bg-surface-0 border border-border-subtle rounded px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 font-mono resize-y leading-relaxed disabled:opacity-50"
                    spellCheck={false}
                  />
                </div>

                {/* Refinement input */}
                {phase !== "saved" && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Refine with AI</label>
                    <div className="flex gap-2">
                      <input
                        ref={refinementRef}
                        value={refinementInput}
                        onChange={(e) => setRefinementInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleRefine();
                          }
                        }}
                        disabled={phase === "refining" || phase === "saving"}
                        placeholder="e.g. Focus more on the correlation methodology..."
                        className="flex-1 text-sm bg-surface-0 border border-border-subtle rounded px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 disabled:opacity-50"
                      />
                      <button
                        onClick={handleRefine}
                        disabled={
                          phase === "refining" || phase === "saving" || !refinementInput.trim()
                        }
                        className="text-xs px-4 py-2 rounded bg-surface-3 border border-border-subtle text-gray-300 hover:text-gray-100 hover:bg-surface-3/80 transition-colors disabled:opacity-50 shrink-0"
                      >
                        {phase === "refining" ? "Refining..." : "Refine"}
                      </button>
                    </div>
                    {error && phase === "editing" && (
                      <p className="text-xs text-red-400 mt-1">{error}</p>
                    )}
                  </div>
                )}

                {/* Saved confirmation */}
                {phase === "saved" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded bg-green-500/10 border border-green-500/20">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-green-400"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-xs text-green-400">
                      Skill saved to <span className="font-mono">.claude/skills/{name}/</span>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {(phase === "editing" || phase === "saving" || phase === "saved") && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle shrink-0">
              <div>{saveError && <p className="text-xs text-red-400">{saveError}</p>}</div>
              <div className="flex gap-2">
                {phase === "saved" ? (
                  <button
                    onClick={onClose}
                    className="text-xs px-4 py-2 rounded bg-accent/20 border border-accent/30 text-accent-light hover:bg-accent/30 transition-colors"
                  >
                    Done
                  </button>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      className="text-xs px-4 py-2 rounded border border-border-subtle text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={phase === "saving"}
                      className="text-xs px-4 py-2 rounded bg-accent/20 border border-accent/30 text-accent-light hover:bg-accent/30 transition-colors disabled:opacity-50"
                    >
                      {phase === "saving" ? "Saving..." : "Save Skill"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
