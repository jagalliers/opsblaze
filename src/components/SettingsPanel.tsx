import React, { useEffect, useState, useCallback } from "react";
import {
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  testMcpServer,
  listSkillsApi,
  toggleSkillApi,
  deleteSkillApi,
  getConfigPaths,
  getSettings,
  updateSettings,
} from "../lib/settings-api";
import type {
  McpServerInfo,
  McpServerConfig,
  ProbeResult,
  ToolInfo,
  SkillInfo,
  ConfigPaths,
  AppSettings,
} from "../lib/settings-api";
import { fetchHealth } from "../lib/api";
import type { HealthResponse } from "../lib/api";

type Tab = "general" | "mcp" | "skills";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  ok: "bg-green-400",
  degraded: "bg-yellow-400",
  error: "bg-red-400",
};

// --- Shared small components ---

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    stdio: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    http: "bg-green-500/20 text-green-300 border-green-500/30",
    sse: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono uppercase ${colors[type] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}
    >
      {type}
    </span>
  );
}

function BuiltInBadge() {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-accent/15 text-accent-light border-accent/30 font-medium">
      built-in
    </span>
  );
}

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${enabled ? "bg-green-400" : "bg-gray-600"}`}
    />
  );
}

function ToolList({ tools }: { tools: ToolInfo[] }) {
  if (tools.length === 0) return <p className="text-xs text-gray-600 italic">No tools</p>;
  return (
    <div className="space-y-1">
      {tools.map((t) => (
        <div key={t.name} className="flex items-start gap-2">
          <span className="text-xs font-mono text-accent-light shrink-0">{t.name}</span>
          {t.description && (
            <span className="text-xs text-gray-500 line-clamp-1">{t.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function PathHint({ label, path }: { label: string; path: string | null }) {
  if (!path) return null;
  return (
    <div className="px-4 py-3 border-t border-border-subtle">
      <p className="text-[11px] text-gray-600">
        {label} <span className="font-mono break-all">{path}</span>
      </p>
    </div>
  );
}

const inputClass =
  "w-full text-sm bg-surface-0 border border-border-subtle rounded px-2.5 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50";
const monoInputClass = `${inputClass} font-mono`;

// --- Key-Value Editor ---

interface KVEntry {
  key: string;
  value: string;
}

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
  addLabel = "+ Add",
}: {
  entries: KVEntry[];
  onChange: (entries: KVEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}) {
  const update = (idx: number, field: "key" | "value", val: string) => {
    const next = entries.map((e, i) => (i === idx ? { ...e, [field]: val } : e));
    onChange(next);
  };

  const remove = (idx: number) => onChange(entries.filter((_, i) => i !== idx));

  const add = () => onChange([...entries, { key: "", value: "" }]);

  return (
    <div className="space-y-1.5">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input
            value={entry.key}
            onChange={(e) => update(i, "key", e.target.value)}
            placeholder={keyPlaceholder}
            className={`flex-1 text-xs bg-surface-0 border border-border-subtle rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 font-mono`}
          />
          <input
            value={entry.value}
            onChange={(e) => update(i, "value", e.target.value)}
            onFocus={(e) => {
              if (e.target.value === "••••••") {
                update(i, "value", "");
              }
            }}
            placeholder={valuePlaceholder}
            className={`flex-1 text-xs bg-surface-0 border border-border-subtle rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 font-mono`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-gray-600 hover:text-red-400 transition-colors px-1"
            aria-label="Remove entry"
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
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-[11px] text-accent hover:text-accent-light transition-colors"
      >
        {addLabel}
      </button>
    </div>
  );
}

function kvToRecord(entries: KVEntry[]): Record<string, string> | undefined {
  const filtered = entries.filter((e) => e.key.trim());
  if (filtered.length === 0) return undefined;
  const rec: Record<string, string> = {};
  for (const { key, value } of filtered) rec[key.trim()] = value;
  return rec;
}

function recordToKv(rec: Record<string, string> | undefined): KVEntry[] {
  if (!rec) return [];
  return Object.entries(rec).map(([key, value]) => ({ key, value }));
}

// --- General Tab ---

function GeneralTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setModel(s.runtime.claudeModel);
        setEffort(s.runtime.claudeEffort);
      })
      .catch(() => {});
    fetchHealth()
      .then(setHealth)
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const partial: Record<string, unknown> = {};
      if (model !== settings?.runtime.claudeModel) partial.claudeModel = model;
      if (effort !== settings?.runtime.claudeEffort) partial.claudeEffort = effort;
      if (Object.keys(partial).length === 0) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setSaving(false);
        return;
      }
      const updated = await updateSettings(partial);
      setSettings((prev) => (prev ? { ...prev, runtime: updated.runtime } : prev));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const splunkCheck = health?.checks?.splunk;
  const claudeCheck = health?.checks?.claude;

  return (
    <div className="divide-y divide-border-subtle">
      {/* System Status */}
      <div className="px-4 py-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          System Status
        </h3>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`block w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[splunkCheck?.status ?? "error"] ?? "bg-gray-500"}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300">
                Splunk{" "}
                {settings && (
                  <span className="text-gray-500 font-mono">
                    {settings.system.splunkHost}:{settings.system.splunkPort}
                  </span>
                )}
              </p>
              {splunkCheck?.message && (
                <p className="text-[11px] text-gray-500">{splunkCheck.message}</p>
              )}
            </div>
            {settings && (
              <span className="text-[10px] text-gray-600">
                {settings.system.splunkAuthMethod} auth
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className={`block w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[claudeCheck?.status ?? "error"] ?? "bg-gray-500"}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300">Claude</p>
            </div>
            <span className="text-[10px] text-gray-600">
              {claudeCheck?.message ?? settings?.system.claudeAuthMethod}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="block w-2 h-2 rounded-full shrink-0 bg-green-400" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300">
                Server{" "}
                {settings && (
                  <span className="text-gray-500 font-mono">
                    {settings.system.bindAddress}:{settings.system.serverPort}
                  </span>
                )}
              </p>
            </div>
            {settings && (
              <span className="text-[10px] text-gray-600">{settings.system.serverMode}</span>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-600 mt-2.5">
          To change Splunk connection settings, edit <span className="font-mono">.env</span> and run{" "}
          <span className="font-mono">node bin/opsblaze.cjs restart</span>, or re-run{" "}
          <span className="font-mono">node bin/setup.cjs</span>.
        </p>
      </div>

      {/* Runtime Settings */}
      <div className="px-4 py-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Runtime Settings
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Claude Model</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-4-6"
              className={monoInputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Thinking Effort</label>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              className={inputClass}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/30 text-accent-light hover:bg-accent/30 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-xs text-green-400">Saved</span>}
          </div>

          <p className="text-[11px] text-gray-600">
            Changes take effect on the next query. No restart required.
          </p>
        </div>
      </div>
    </div>
  );
}

// --- MCP Server row ---

function McpServerRow({
  server,
  onToggle,
  onDelete,
  onEdit,
}: {
  server: McpServerInfo;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  onEdit: (name: string, config: McpServerConfig) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTesting(true);
    setProbeResult(null);
    try {
      const result = await testMcpServer(server.name);
      setProbeResult(result);
      if (!expanded) setExpanded(true);
    } catch {
      setProbeResult({ status: "failed", tools: [], error: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  const type = server.config.type ?? "stdio";

  return (
    <div className="border-b border-border-subtle">
      <div
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-surface-3 transition-colors"
      >
        <StatusDot enabled={server.config.enabled} />
        <span className="text-sm text-gray-200 font-medium flex-1 truncate">{server.name}</span>
        <TypeBadge type={type} />
        {server.builtIn && <BuiltInBadge />}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {editing && !server.builtIn ? (
            <EditServerForm
              server={server}
              onSave={async (config) => {
                await onEdit(server.name, config);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="text-xs space-y-1 bg-surface-0 rounded-md p-2.5">
                {type === "stdio" && (
                  <>
                    <div>
                      <span className="text-gray-500">Command: </span>
                      <span className="text-gray-300 font-mono">
                        {server.config.command} {server.config.args?.join(" ")}
                      </span>
                    </div>
                    {server.config.env && Object.keys(server.config.env).length > 0 && (
                      <div>
                        <span className="text-gray-500">Env: </span>
                        <span className="text-gray-400">
                          {Object.keys(server.config.env).join(", ")}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {(type === "http" || type === "sse") && (
                  <>
                    <div>
                      <span className="text-gray-500">URL: </span>
                      <span className="text-gray-300 font-mono break-all">{server.config.url}</span>
                    </div>
                    {server.config.headers && Object.keys(server.config.headers).length > 0 && (
                      <div>
                        <span className="text-gray-500">Headers: </span>
                        <span className="text-gray-400">
                          {Object.keys(server.config.headers).join(", ")}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {probeResult && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium ${probeResult.status === "connected" ? "text-green-400" : "text-red-400"}`}
                    >
                      {probeResult.status === "connected" ? "Connected" : "Failed"}
                    </span>
                    {probeResult.serverInfo && (
                      <span className="text-xs text-gray-500">
                        {probeResult.serverInfo.name} v{probeResult.serverInfo.version}
                      </span>
                    )}
                  </div>
                  {probeResult.error && (
                    <p className="text-xs text-red-400/80">{probeResult.error}</p>
                  )}
                  {probeResult.tools.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">
                        {probeResult.tools.length} tool{probeResult.tools.length !== 1 ? "s" : ""}:
                      </p>
                      <ToolList tools={probeResult.tools} />
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="text-xs px-2.5 py-1 rounded border border-border-subtle text-gray-300 hover:bg-surface-3 hover:text-gray-100 transition-colors disabled:opacity-50"
                >
                  {testing ? "Testing..." : "Test Connection"}
                </button>
                {!server.builtIn && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(true);
                      }}
                      className="text-xs px-2.5 py-1 rounded border border-border-subtle text-gray-300 hover:bg-surface-3 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(server.name, !server.config.enabled);
                      }}
                      className="text-xs px-2.5 py-1 rounded border border-border-subtle text-gray-300 hover:bg-surface-3 transition-colors"
                    >
                      {server.config.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(server.name);
                      }}
                      className="text-xs px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Edit Server Form ---

function EditServerForm({
  server,
  onSave,
  onCancel,
}: {
  server: McpServerInfo;
  onSave: (config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const type = server.config.type ?? "stdio";
  const [command, setCommand] = useState(server.config.command ?? "");
  const [args, setArgs] = useState(server.config.args?.join(" ") ?? "");
  const [url, setUrl] = useState(server.config.url ?? "");
  const [envVars, setEnvVars] = useState<KVEntry[]>(recordToKv(server.config.env));
  const [hdrs, setHdrs] = useState<KVEntry[]>(recordToKv(server.config.headers));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const config: McpServerConfig = { type, enabled: server.config.enabled };
      if (type === "stdio") {
        config.command = command;
        config.args = args
          .split(/\s+/)
          .map((a) => a.trim())
          .filter(Boolean);
        const env = kvToRecord(envVars);
        if (env) config.env = env;
      } else {
        config.url = url;
        const h = kvToRecord(hdrs);
        if (h) config.headers = h;
      }
      await onSave(config);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {type === "stdio" ? (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={monoInputClass}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Arguments (space-separated)</label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className={monoInputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Environment Variables</label>
            <KeyValueEditor
              entries={envVars}
              onChange={setEnvVars}
              keyPlaceholder="VARIABLE_NAME"
              valuePlaceholder="value"
              addLabel="+ Add Variable"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              className={monoInputClass}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Headers</label>
            <KeyValueEditor
              entries={hdrs}
              onChange={setHdrs}
              keyPlaceholder="Header-Name"
              valuePlaceholder="value"
              addLabel="+ Add Header"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/30 text-accent-light hover:bg-accent/30 transition-colors disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-border-subtle text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// --- Add Server Form ---

function AddServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"stdio" | "http" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envVars, setEnvVars] = useState<KVEntry[]>([]);
  const [hdrs, setHdrs] = useState<KVEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const config: McpServerConfig = { enabled: true };
      if (type === "stdio") {
        config.type = "stdio";
        config.command = command;
        config.args = args
          .split(/\s+/)
          .map((a) => a.trim())
          .filter(Boolean);
        const env = kvToRecord(envVars);
        if (env) config.env = env;
      } else {
        config.type = type;
        config.url = url;
        const h = kvToRecord(hdrs);
        if (h) config.headers = h;
      }
      await onAdd(name, config);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="px-4 py-3 space-y-3 border-b border-border-subtle bg-surface-0/50"
    >
      <div>
        <label className="block text-xs text-gray-500 mb-1">Server Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-server"
          className={inputClass}
          required
          pattern="[a-zA-Z0-9_-]+"
          title="Alphanumeric, hyphens, underscores"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Transport</label>
        <div className="flex gap-2">
          {(["stdio", "http", "sse"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                type === t
                  ? "border-accent/50 bg-accent/10 text-accent-light"
                  : "border-border-subtle text-gray-400 hover:text-gray-200"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {type === "stdio" ? (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className={monoInputClass}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Arguments (space-separated)</label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y @my/mcp-server"
              className={monoInputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Environment Variables (optional)
            </label>
            <KeyValueEditor
              entries={envVars}
              onChange={setEnvVars}
              keyPlaceholder="VARIABLE_NAME"
              valuePlaceholder="value"
              addLabel="+ Add Variable"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/server"
              type="url"
              className={monoInputClass}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Headers (optional)</label>
            <KeyValueEditor
              entries={hdrs}
              onChange={setHdrs}
              keyPlaceholder="Header-Name"
              valuePlaceholder="Bearer token..."
              addLabel="+ Add Header"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/30 text-accent-light hover:bg-accent/30 transition-colors disabled:opacity-50"
        >
          {submitting ? "Adding..." : "Add Server"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-border-subtle text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// --- MCP Servers Tab ---

function McpServersTab({ configPath }: { configPath: string | null }) {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setServers(await listMcpServers());
    } catch (err) {
      setError((err as Error).message || "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await toggleMcpServer(name, enabled);
      await refresh();
    } catch (err) {
      setError(`Toggle failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteMcpServer(name);
      await refresh();
    } catch (err) {
      setError(`Delete failed: ${(err as Error).message}`);
    }
  };

  const handleEdit = async (name: string, config: McpServerConfig) => {
    try {
      await updateMcpServer(name, config);
      await refresh();
    } catch (err) {
      setError(`Edit failed: ${(err as Error).message}`);
    }
  };

  const handleAdd = async (name: string, config: McpServerConfig) => {
    await addMcpServer(name, config);
    setShowAdd(false);
    await refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
        <span className="text-xs text-gray-500">
          {servers.length} server{servers.length !== 1 ? "s" : ""} configured
        </span>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs text-accent hover:text-accent-light px-2 py-1 rounded hover:bg-surface-3 transition-colors"
        >
          {showAdd ? "Cancel" : "+ Add Server"}
        </button>
      </div>

      {showAdd && <AddServerForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} />}

      {error && (
        <div className="mx-4 mt-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
          {error}
        </div>
      )}

      {loading && servers.length === 0 && (
        <div className="px-4 py-8 text-center text-gray-600 text-sm">Loading...</div>
      )}

      {!loading && servers.length === 0 && !error && (
        <div className="px-4 py-8 text-center text-gray-600 text-sm">No MCP servers configured</div>
      )}

      {servers.map((s) => (
        <McpServerRow
          key={s.name}
          server={s}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onEdit={handleEdit}
        />
      ))}

      <PathHint label="Config file:" path={configPath} />
    </div>
  );
}

// --- Skills Tab ---

function SkillsTab({ skillsDir }: { skillsDir: string | null }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSkills(await listSkillsApi());
    } catch (err) {
      setError((err as Error).message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await toggleSkillApi(name, enabled);
      await refresh();
    } catch (err) {
      setError(`Toggle failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteSkillApi(name);
      await refresh();
    } catch (err) {
      setError(`Delete failed: ${(err as Error).message}`);
    }
  };

  return (
    <div>
      <div className="px-4 py-2.5 border-b border-border-subtle">
        <span className="text-xs text-gray-500">
          {skills.filter((s) => s.enabled).length} of {skills.length} skill
          {skills.length !== 1 ? "s" : ""} active
        </span>
      </div>

      {error && (
        <div className="mx-4 mt-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
          {error}
        </div>
      )}

      {loading && skills.length === 0 && (
        <div className="px-4 py-8 text-center text-gray-600 text-sm">Loading...</div>
      )}

      {!loading && skills.length === 0 && !error && (
        <div className="px-4 py-8 text-center text-gray-600 text-sm">
          <p>No skills found</p>
          <p className="mt-1 text-gray-700 text-xs">
            Add skills to <span className="font-mono">.claude/skills/</span>
          </p>
        </div>
      )}

      {skills.map((skill) => (
        <SkillRow key={skill.name} skill={skill} onToggle={handleToggle} onDelete={handleDelete} />
      ))}

      <PathHint label="Add skills to:" path={skillsDir} />
    </div>
  );
}

function SkillRow({
  skill,
  onToggle,
  onDelete,
}: {
  skill: SkillInfo;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="border-b border-border-subtle">
      <div
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-3 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-200 font-medium">{skill.name}</p>
          {skill.description && !expanded && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{skill.description}</p>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(skill.name, !skill.enabled);
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
            skill.enabled ? "bg-accent" : "bg-gray-700"
          }`}
          aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              skill.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {skill.description && (
            <p className="text-xs text-gray-400 leading-relaxed">{skill.description}</p>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Remove skill file from disk?</span>
              <button
                onClick={() => {
                  onDelete(skill.name);
                  setConfirmDelete(false);
                }}
                className="text-xs px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2.5 py-1 rounded border border-border-subtle text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main Panel ---

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("general");
  const [paths, setPaths] = useState<ConfigPaths | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    getConfigPaths()
      .then(setPaths)
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 top-[49px] bg-black/40 z-20 transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-[49px] right-0 bottom-0 w-96 bg-surface-1 border-l border-border-subtle z-30 transform transition-transform duration-200 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-[18px] pb-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-surface-3 transition-colors"
            aria-label="Close settings"
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-border-subtle">
          {(["general", "mcp", "skills"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 text-xs py-2.5 text-center transition-colors ${
                tab === t
                  ? "text-accent-light border-b-2 border-accent"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "general" ? "General" : t === "mcp" ? "MCP Servers" : "Skills"}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto h-[calc(100%-95px)]">
          {tab === "general" ? (
            <GeneralTab />
          ) : tab === "mcp" ? (
            <McpServersTab configPath={paths?.mcpConfig ?? null} />
          ) : (
            <SkillsTab skillsDir={paths?.skillsDir ?? null} />
          )}
        </div>
      </div>
    </>
  );
}
