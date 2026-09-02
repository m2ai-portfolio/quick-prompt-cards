import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  handlePromptRun,
  type PromptRunRequestBody,
} from "./prompt-run-handler.js";
import { QueryClaimStore } from "./query-claim-store.js";

const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_READ_TIMEOUT_MS = 10_000;
const PROMPT_RUN_PATH = "/api/prompt-run";

/**
 * Minimal dependency-free HTTP transport for the prompt-run-v1 contract.
 * Bounded body size and read timeout so a slow/oversized request cannot
 * hang a handler; a bad or unparseable payload always returns the same
 * safe rejected shape, never a raw parser error or stack trace.
 */
export function createPromptRunServer(botToken: string): Server {
  const claimStore = new QueryClaimStore();

  return createServer((req, res) => {
    if (req.method !== "POST" || req.url !== PROMPT_RUN_PATH) {
      respond(res, 404, { status: "not_found" });
      return;
    }
    void handleRequest(req, res, botToken, claimStore);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  botToken: string,
  claimStore: QueryClaimStore,
): Promise<void> {
  let body: PromptRunRequestBody;
  try {
    body = (await readJsonBody(
      req,
      MAX_BODY_BYTES,
      REQUEST_READ_TIMEOUT_MS,
    )) as PromptRunRequestBody;
  } catch {
    respond(res, 400, { status: "rejected", error: "invalid_init_data" });
    return;
  }

  const result = await handlePromptRun(body, { botToken, claimStore });
  respond(res, result.httpStatus, result.body);
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("request_timeout"));
    }, timeoutMs);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        clearTimeout(timer);
        req.removeAllListeners("data");
        req.pause();
        reject(new Error("payload_too_large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
