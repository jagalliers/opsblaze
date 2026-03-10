export interface SSECallbacks {
  onText: (content: string) => void;
  onChart: (data: {
    vizType: string;
    dataSources: unknown;
    width: number;
    height: number;
    spl?: string;
    earliest?: string;
    latest?: string;
  }) => void;
  onSkill: (skill: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export async function streamChat(
  message: string,
  history: Array<{ role: string; content: string }>,
  callbacks: SSECallbacks,
  signal?: AbortSignal,
  skills?: string[]
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      ...(skills && skills.length > 0 && { skills }),
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7);
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data);

            switch (currentEvent) {
              case "text":
                callbacks.onText(parsed.content ?? "");
                break;
              case "chart":
                callbacks.onChart(parsed);
                break;
              case "skill":
                callbacks.onSkill(parsed.skill ?? "unknown");
                break;
              case "error":
                callbacks.onError(parsed.message ?? "Unknown error");
                break;
              case "done":
                callbacks.onDone();
                return;
            }
          } catch {
            // Skip unparseable data
          }

          currentEvent = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  callbacks.onDone();
}
