import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { listSkillsApi } from "../lib/settings-api";
import type { SkillInfo } from "../lib/settings-api";

interface SkillPickerProps {
  selectedSkills: string[];
  onSelectedSkillsChange: (skills: string[]) => void;
  allowAdditional: boolean;
  onAllowAdditionalChange: (allow: boolean) => void;
  disabled?: boolean;
}

export function SkillPicker({
  selectedSkills,
  onSelectedSkillsChange,
  allowAdditional,
  onAllowAdditionalChange,
  disabled,
}: SkillPickerProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelSearchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listSkillsApi()
      .then((result) => {
        if (!cancelled) setSkills(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePanelPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelPos({
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 400)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!isDropdownOpen || !triggerRef.current) {
      setPanelPos(null);
      return;
    }

    updatePanelPos();
    window.addEventListener("resize", updatePanelPos);
    window.addEventListener("scroll", updatePanelPos, true);
    return () => {
      window.removeEventListener("resize", updatePanelPos);
      window.removeEventListener("scroll", updatePanelPos, true);
    };
  }, [isDropdownOpen, updatePanelPos]);

  useEffect(() => {
    if (isDropdownOpen && panelPos) {
      requestAnimationFrame(() => panelSearchRef.current?.focus());
    }
  }, [isDropdownOpen, panelPos]);

  const enabledSkills = skills.filter((s) => s.enabled);
  const disabledSkills = skills.filter((s) => !s.enabled);
  const selectedSet = new Set(selectedSkills);
  const q = searchQuery.toLowerCase();

  const matchingEnabled = enabledSkills.filter(
    (s) =>
      !selectedSet.has(s.name) &&
      (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  );

  const matchingDisabled = disabledSkills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  );

  const totalAvailable =
    enabledSkills.filter((s) => !selectedSet.has(s.name)).length + disabledSkills.length;

  useEffect(() => {
    setActiveIndex(matchingEnabled.length > 0 ? 0 : -1);
  }, [searchQuery, matchingEnabled.length]);

  const addSkill = useCallback(
    (name: string) => {
      onSelectedSkillsChange([...selectedSkills, name]);
      setSearchQuery("");
      setIsDropdownOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [selectedSkills, onSelectedSkillsChange]
  );

  const removeSkill = useCallback(
    (name: string) => {
      onSelectedSkillsChange(selectedSkills.filter((s) => s !== name));
    },
    [selectedSkills, onSelectedSkillsChange]
  );

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setSearchQuery("");
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>("[data-skill-item]");
    items[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDropdown();
      inputRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        return;
      }
      setActiveIndex((prev) => (prev < matchingEnabled.length - 1 ? prev + 1 : prev));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
      return;
    }
    if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < matchingEnabled.length) {
        e.preventDefault();
        addSkill(matchingEnabled[activeIndex].name);
      }
      return;
    }
    if (e.key === "Backspace" && searchQuery === "" && selectedSkills.length > 0) {
      removeSkill(selectedSkills[selectedSkills.length - 1]);
    }
  };

  if (loading && skills.length === 0) return null;
  if (!loading && skills.length === 0) return null;

  const hasResults = matchingEnabled.length > 0 || matchingDisabled.length > 0;

  return (
    <div className="relative mt-1.5 flex items-center gap-2 min-h-[28px]">
      <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
        {selectedSkills.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent/15 text-accent-light border border-accent/20"
          >
            <span className="truncate max-w-[120px]">{name}</span>
            <button
              onClick={() => removeSkill(name)}
              disabled={disabled}
              className="hover:text-red-400 transition-colors leading-none"
              aria-label={`Remove skill ${name}`}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}

        <div ref={triggerRef} className="flex-1 min-w-[80px]">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={selectedSkills.length === 0 ? "Add skills..." : "Add more..."}
            className="w-full bg-transparent text-xs text-gray-300 placeholder-gray-600 outline-none disabled:opacity-50"
          />
        </div>
      </div>

      {selectedSkills.length > 0 && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-gray-500 whitespace-nowrap select-none">
            Include additional skills
          </span>
          <button
            onClick={() => onAllowAdditionalChange(!allowAdditional)}
            disabled={disabled}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0 ${
              allowAdditional ? "bg-accent" : "bg-gray-700"
            }`}
            aria-label={
              allowAdditional ? "Restrict to selected skills only" : "Allow additional skills"
            }
            title={allowAdditional ? "Additional skills allowed" : "Only selected skills"}
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
                allowAdditional ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}

      {isDropdownOpen &&
        panelPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={closeDropdown} aria-hidden="true" />

            <div
              className="fixed z-[9999] w-96 max-w-[calc(100vw-2rem)] flex flex-col bg-surface-2/95 backdrop-blur-xl rounded-lg border border-border-subtle shadow-2xl"
              style={{
                bottom: panelPos.bottom,
                left: panelPos.left,
                maxHeight: "60vh",
              }}
            >
              <div className="px-3 pt-3 pb-2 border-b border-border-subtle/50 shrink-0">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-3/60 border border-border-subtle/40">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-gray-500 shrink-0"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    ref={panelSearchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Filter skills..."
                    className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        panelSearchRef.current?.focus();
                      }}
                      className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5 px-0.5">
                  {searchQuery
                    ? `${matchingEnabled.length + matchingDisabled.length} of ${totalAvailable} skills`
                    : `${totalAvailable} skill${totalAvailable !== 1 ? "s" : ""}`}
                </p>
              </div>

              <div ref={listRef} className="overflow-y-auto overscroll-contain flex-1 py-1">
                {hasResults ? (
                  <>
                    {matchingEnabled.map((skill, idx) => (
                      <button
                        key={skill.name}
                        data-skill-item
                        onClick={() => addSkill(skill.name)}
                        className={`w-full text-left px-3 py-2 transition-colors cursor-pointer ${
                          idx === activeIndex ? "bg-accent/15" : "hover:bg-surface-3"
                        }`}
                      >
                        <p
                          className={`text-sm ${idx === activeIndex ? "text-accent-light" : "text-gray-200"}`}
                        >
                          {skill.name}
                        </p>
                        {skill.description && (
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                            {skill.description}
                          </p>
                        )}
                      </button>
                    ))}
                    {matchingDisabled.length > 0 && matchingEnabled.length > 0 && (
                      <div className="border-t border-border-subtle/30 my-1" />
                    )}
                    {matchingDisabled.map((skill) => (
                      <div
                        key={skill.name}
                        className="w-full text-left px-3 py-2 opacity-40 cursor-not-allowed"
                      >
                        <p className="text-sm text-gray-200">
                          {skill.name}
                          <span className="text-[10px] text-gray-500 ml-1.5">(disabled)</span>
                        </p>
                        {skill.description && (
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                            {skill.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-gray-500 px-3 py-4 text-center">No matching skills</p>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
