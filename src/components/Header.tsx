import React, { useState, useEffect, useRef, useCallback } from "react";
import { fetchHealth, headers } from "../lib/api";
import type { HealthResponse } from "../lib/api";

interface HeaderProps {
  onClear: () => void;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
  onDistillSkill: () => void;
  canDistill: boolean;
  conversationTitle?: string | null;
  conversationId?: string | null;
  canExport: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  ok: "bg-green-400",
  degraded: "bg-yellow-400",
  error: "bg-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "All systems operational",
  degraded: "Partial issues detected",
  error: "Service issues detected",
};

function HealthIndicator() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      setHealth(await fetchHealth());
    } catch {
      setHealth({ status: "error", checks: { api: { status: "error", message: "unreachable" } } });
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = health?.status === "ok" ? 60_000 : 15_000;
    const id = setInterval(poll, interval);
    return () => clearInterval(id);
  }, [poll, health?.status]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const status = health?.status ?? "error";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md hover:bg-surface-3 transition-colors flex items-center justify-center"
        aria-label={`System status: ${STATUS_LABELS[status] ?? status}`}
        title={STATUS_LABELS[status] ?? status}
      >
        <span className={`block w-2 h-2 rounded-full ${STATUS_COLORS[status] ?? "bg-gray-500"}`} />
      </button>

      {open && health && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface-2/95 backdrop-blur-xl rounded-lg border border-border-subtle shadow-lg z-50 py-2">
          <div className="px-3 py-1.5 border-b border-border-subtle">
            <span
              className={`text-xs font-medium ${status === "ok" ? "text-green-400" : status === "degraded" ? "text-yellow-400" : "text-red-400"}`}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
          {Object.entries(health.checks).map(([name, check]) => (
            <div key={name} className="px-3 py-1.5 flex items-center gap-2">
              <span
                className={`block w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[check.status] ?? "bg-gray-500"}`}
              />
              <span className="text-xs text-gray-300 capitalize flex-1">{name}</span>
              {check.message && (
                <span className="text-[10px] text-gray-500 truncate max-w-[120px]">
                  {check.message}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header({
  onClear,
  onToggleSidebar,
  onToggleSettings,
  onDistillSkill,
  canDistill,
  conversationTitle,
  conversationId,
  canExport,
}: HeaderProps) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const handleExport = async () => {
    if (!conversationId || exporting) return;
    setExporting(true);
    setExportError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    try {
      const resp = await fetch(`/api/conversations/${conversationId}/export`, {
        headers: headers(),
      });
      if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = resp.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="?([^"]+)"?/);
      a.download = match?.[1] ?? `investigation-${conversationId}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = (err as Error).message || "Export failed";
      setExportError(msg);
      errorTimerRef.current = setTimeout(() => setExportError(null), 4000);
    } finally {
      setExporting(false);
    }
  };

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-1/80 backdrop-blur-md z-40">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 -ml-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-surface-3 transition-colors"
          aria-label="Toggle investigations sidebar"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center shadow-md shadow-orange-500/20">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          >
            <circle cx="10" cy="10" r="8" />
            <line x1="16" y1="16" x2="22" y2="22" strokeWidth="2.5" />
            <path
              d="M10 4C11 5.5 14 8 14 11c0 2.5-2 4.5-4 4.5S6 13.5 6 11c0-2 1-4 2-5 .5 1.5 1 3 1.5 3.5C9.5 8 10 5.5 10 4z"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-100 tracking-tight">
            {conversationTitle ?? "OpsBlaze"}
          </h1>
          <p className="text-xs text-gray-500 -mt-0.5">AI-Powered Narrative Investigation</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <HealthIndicator />
        {exportError && <span className="text-xs text-red-400 mr-1">{exportError}</span>}
        {canExport && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-surface-3 transition-colors disabled:opacity-50"
            aria-label="Export investigation"
            title="Export investigation (open in browser, then Print > Save as PDF)"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        )}
        <button
          onClick={onDistillSkill}
          disabled={!canDistill}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Distill skill from conversation"
          title="Distill Skill"
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
            <line x1="9" y1="18" x2="15" y2="18" />
            <line x1="10" y1="22" x2="14" y2="22" />
            <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
          </svg>
        </button>
        <button
          onClick={onToggleSettings}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-surface-3 transition-colors"
          aria-label="Settings"
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
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-md hover:bg-surface-3 transition-colors"
        >
          New Investigation
        </button>
      </div>
    </header>
  );
}
