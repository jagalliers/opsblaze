export function headers(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StoredConversation {
  id: string;
  title: string;
  messages: unknown[];
  createdAt: string;
  updatedAt: string;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations", { headers: headers() });
  if (!res.ok) throw new Error(`Failed to list conversations: ${res.status}`);
  return res.json();
}

export async function loadConversation(id: string): Promise<StoredConversation> {
  const res = await fetch(`/api/conversations/${id}`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`);
  return res.json();
}

export async function createConversation(id: string, title: string): Promise<StoredConversation> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ id, title, messages: [] }),
  });
  if (!res.ok) throw new Error(`Failed to create conversation: ${res.status}`);
  return res.json();
}

export async function updateConversation(
  id: string,
  data: { title?: string; messages?: unknown[] }
): Promise<StoredConversation> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update conversation: ${res.status}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to delete conversation: ${res.status}`);
}

export interface HealthCheck {
  status: string;
  message?: string;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  checks: Record<string, HealthCheck>;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health", { headers: headers() });
  return res.json();
}

export interface SearchResult extends ConversationSummary {
  snippet?: string;
}

export async function searchConversations(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}
