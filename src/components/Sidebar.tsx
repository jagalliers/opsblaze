import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  listConversations,
  searchConversations,
  type ConversationSummary,
  type SearchResult,
} from "../lib/api";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onNew: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

type DisplayItem = ConversationSummary & { snippet?: string };

export function Sidebar({
  isOpen,
  onClose,
  activeConversationId,
  onSelect,
  onDelete,
  onNew,
}: SidebarProps) {
  const [conversations, setConversations] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listConversations();
      setConversations(list);
    } catch (err) {
      setError((err as Error).message || "Failed to load investigations");
    } finally {
      setLoading(false);
    }
  }, []);

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      refresh();
      focusTimerRef.current = setTimeout(() => searchInputRef.current?.focus(), 200);
    } else {
      setQuery("");
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    }
  }, [isOpen, refresh]);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        refresh();
        return;
      }
      setSearching(true);
      setError(null);
      try {
        const results = await searchConversations(q.trim());
        setConversations(results);
      } catch (err) {
        setError((err as Error).message || "Search failed");
      } finally {
        setSearching(false);
      }
    },
    [refresh]
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleClearSearch = () => {
    setQuery("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    refresh();
    searchInputRef.current?.focus();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await onDelete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(`Delete failed: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const isSearchMode = query.trim().length > 0;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 top-[49px] bg-black/40 z-20 transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-[49px] left-0 bottom-0 w-80 bg-surface-1 border-r border-border-subtle z-30 transform transition-transform duration-200 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-[18px] pb-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-gray-200">Investigations</h2>
          <button
            onClick={() => {
              onNew();
              onClose();
            }}
            className="text-xs text-accent hover:text-accent-light px-2 py-1 rounded hover:bg-surface-3 transition-colors"
            aria-label="New investigation"
          >
            + New
          </button>
        </div>

        {/* Search input */}
        <div className="px-3 py-2 border-b border-border-subtle">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search investigations..."
              className="w-full text-xs bg-surface-0 border border-border-subtle rounded-md pl-8 pr-7 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/40 transition-colors"
              aria-label="Search investigations"
            />
            {query && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"
                aria-label="Clear search"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto h-[calc(100%-96px)]">
          {error && (
            <div className="mx-4 mt-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
              {error}
            </div>
          )}

          {(loading || searching) && conversations.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-600 text-sm">
              {searching ? "Searching..." : "Loading..."}
            </div>
          )}

          {!loading && !searching && conversations.length === 0 && !error && (
            <div className="px-4 py-8 text-center text-gray-600 text-sm">
              {isSearchMode ? "No matching investigations" : "No investigations yet"}
            </div>
          )}

          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => {
                onSelect(conv.id);
                onClose();
              }}
              className={`group px-4 py-3 cursor-pointer border-b border-border-subtle transition-colors ${
                conv.id === activeConversationId
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-surface-3"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200 truncate font-medium">{conv.title}</p>
                  {conv.snippet && isSearchMode && (
                    <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
                      {conv.snippet}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    {conv.messageCount} messages &middot; {timeAgo(conv.updatedAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDelete(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 p-1 rounded transition-all"
                  aria-label={`Delete investigation: ${conv.title}`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
