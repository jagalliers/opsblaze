import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import { logger } from "./logger.js";

/**
 * Wraps an async iterable of SDK messages, yielding each message unchanged
 * while appending a JSON-serialized copy to a JSONL file. Writes
 * incrementally so partial runs are preserved if the process crashes.
 */
export async function* recordMessages(
  source: AsyncIterable<Record<string, unknown>>,
  outputPath: string
): AsyncGenerator<Record<string, unknown>> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const stream = createWriteStream(outputPath, { flags: "w" });
  let writeError = false;

  stream.on("error", (err) => {
    if (!writeError) {
      writeError = true;
      logger.error({ err, path: outputPath }, "recorder write stream error");
    }
  });

  try {
    for await (const message of source) {
      if (!writeError) {
        const ok = stream.write(JSON.stringify(message) + "\n");
        if (!ok && !writeError) {
          await new Promise<void>((resolve) => {
            stream.once("drain", resolve);
            stream.once("error", () => resolve());
          });
        }
      }
      yield message;
    }
  } finally {
    if (!writeError) {
      stream.end();
      await new Promise<void>((resolve) => {
        stream.on("finish", resolve);
        stream.on("error", () => resolve());
      });
    } else {
      stream.destroy();
    }
  }
}
