import readline from "node:readline";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { Codex } from "@openai/codex-sdk";

const DEFAULT_CONFIG = {
  model: "default",
  reasoning: "default",
  approvalPolicy: "on-request",
  sandbox: "read-only",
  profile: "read_write_with_approval",
  webSearchMode: "cached",
  binary: process.env.ALICIA_CODEX_BIN || "auto",
};

const state = {
  config: { ...DEFAULT_CONFIG },
  nextThreadId: 1,
  threads: new Map(),
};

let codexPathProbe = null;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResponse(id, result) {
  writeMessage({
    type: "response",
    id,
    ok: true,
    result,
  });
}

function writeError(id, error) {
  const message = error instanceof Error ? error.message : String(error);
  writeMessage({
    type: "response",
    id,
    ok: false,
    error: message,
  });
}

function writeEvent(event) {
  writeMessage({
    type: "event",
    event,
  });
}

function normalizeConfigPatch(patch) {
  const normalized = { ...patch };

  if (typeof normalized.model !== "string" || normalized.model.trim().length === 0) {
    normalized.model = state.config.model;
  }

  if (typeof normalized.reasoning !== "string" || normalized.reasoning.trim().length === 0) {
    normalized.reasoning = state.config.reasoning;
  }

  if (
    typeof normalized.approvalPolicy !== "string" ||
    normalized.approvalPolicy.trim().length === 0
  ) {
    normalized.approvalPolicy = state.config.approvalPolicy;
  }

  if (typeof normalized.sandbox !== "string" || normalized.sandbox.trim().length === 0) {
    normalized.sandbox = state.config.sandbox;
  }

  if (typeof normalized.profile !== "string" || normalized.profile.trim().length === 0) {
    normalized.profile = state.config.profile;
  }

  if (
    typeof normalized.webSearchMode !== "string" ||
    normalized.webSearchMode.trim().length === 0
  ) {
    normalized.webSearchMode = state.config.webSearchMode;
  }

  if (typeof normalized.binary !== "string" || normalized.binary.trim().length === 0) {
    normalized.binary = state.config.binary;
  }

  return normalized;
}

function normalizeBinaryOverride(binary) {
  if (typeof binary !== "string") {
    return null;
  }

  const value = binary.trim();
  if (value.length === 0) {
    return null;
  }

  const lowered = value.toLowerCase();
  if (lowered === "auto" || lowered === "default" || lowered === "codex") {
    return null;
  }

  return value;
}

function codexIsAvailableOnPath() {
  if (codexPathProbe !== null) {
    return codexPathProbe;
  }

  const probe = spawnSync("codex", ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  codexPathProbe = !probe.error;
  return codexPathProbe;
}

function buildThreadOptions(config, workspace) {
  const options = {
    skipGitRepoCheck: true,
    workingDirectory: workspace,
    sandboxMode: config.sandbox,
    approvalPolicy: config.approvalPolicy,
    webSearchMode: config.webSearchMode,
  };

  if (config.model !== "default") {
    options.model = config.model;
  }

  if (config.reasoning !== "default" && config.reasoning !== "none") {
    options.modelReasoningEffort = config.reasoning;
  }

  return options;
}

function createCodexClient(config) {
  const codexOptions = {};
  const configuredBinary = normalizeBinaryOverride(config.binary);
  const envBinary = normalizeBinaryOverride(process.env.ALICIA_CODEX_BIN || "");

  if (configuredBinary) {
    codexOptions.codexPathOverride = configuredBinary;
  } else if (envBinary) {
    codexOptions.codexPathOverride = envBinary;
  } else if (codexIsAvailableOnPath()) {
    codexOptions.codexPathOverride = "codex";
  }

  return new Codex(codexOptions);
}

function normalizeInputItems(inputItems) {
  if (!Array.isArray(inputItems) || inputItems.length === 0) {
    return [{ type: "text", text: "" }];
  }

  const normalized = [];
  for (const item of inputItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const type = String(item.type || "").toLowerCase();
    if (type === "text" && typeof item.text === "string" && item.text.length > 0) {
      normalized.push({
        type: "text",
        text: item.text,
      });
      continue;
    }

    if (type === "local_image" && typeof item.path === "string" && item.path.length > 0) {
      normalized.push({
        type: "local_image",
        path: item.path,
      });
      continue;
    }

    if (type === "image" && typeof item.imageUrl === "string" && item.imageUrl.length > 0) {
      normalized.push({
        type: "text",
        text: `Image URL: ${item.imageUrl}`,
      });
      continue;
    }

    if (type === "mention" && typeof item.path === "string" && item.path.length > 0) {
      normalized.push({
        type: "text",
        text: `@${item.path}`,
      });
      continue;
    }

    if (type === "skill" && typeof item.name === "string" && item.name.length > 0) {
      normalized.push({
        type: "text",
        text: `$${item.name}`,
      });
      continue;
    }
  }

  if (normalized.length === 0) {
    return [{ type: "text", text: "" }];
  }

  return normalized;
}

function isPlainJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getThreadOrThrow(threadId) {
  const key = String(threadId || "");
  if (!key) {
    throw new Error("threadId is required");
  }

  const threadState = state.threads.get(key);
  if (!threadState) {
    throw new Error(`thread not found: ${key}`);
  }

  return threadState;
}

async function handleThreadOpen(params = {}) {
  const requestedThreadId =
    typeof params.threadId === "string" && params.threadId.length > 0
      ? params.threadId
      : `thread-${state.nextThreadId++}`;

  const workspace =
    typeof params.workspace === "string" && params.workspace.length > 0
      ? params.workspace
      : process.cwd();

  const existing = state.threads.get(requestedThreadId);
  if (existing) {
    return {
      threadId: existing.threadId,
      codexThreadId: existing.codexThreadId,
      workspace: existing.workspace,
    };
  }

  const threadState = {
    threadId: requestedThreadId,
    codexThreadId:
      typeof params.codexThreadId === "string" && params.codexThreadId.length > 0
        ? params.codexThreadId
        : null,
    workspace,
  };
  state.threads.set(requestedThreadId, threadState);

  return {
    threadId: threadState.threadId,
    codexThreadId: threadState.codexThreadId,
    workspace: threadState.workspace,
  };
}

async function handleThreadClose(params = {}) {
  const threadState = getThreadOrThrow(params.threadId);
  state.threads.delete(threadState.threadId);
  return {
    threadId: threadState.threadId,
    removed: true,
  };
}

async function handleTurnRun(params = {}) {
  const threadState = getThreadOrThrow(params.threadId);
  const runtimeConfig = normalizeConfigPatch({
    ...state.config,
    ...(params.runtimeConfig || {}),
  });

  const workspace =
    typeof params.workspace === "string" && params.workspace.length > 0
      ? params.workspace
      : threadState.workspace;

  const codex = createCodexClient(runtimeConfig);
  const threadOptions = buildThreadOptions(runtimeConfig, workspace);
  const thread = threadState.codexThreadId
    ? codex.resumeThread(threadState.codexThreadId, threadOptions)
    : codex.startThread(threadOptions);

  const inputItems = normalizeInputItems(params.inputItems);
  let streamedTurn;
  if (params.outputSchema === undefined) {
    streamedTurn = await thread.runStreamed(inputItems);
  } else {
    if (!isPlainJsonObject(params.outputSchema)) {
      throw new Error("outputSchema must be a plain JSON object");
    }
    streamedTurn = await thread.runStreamed(inputItems, {
      outputSchema: params.outputSchema,
    });
  }

  let finalResponse = "";
  let usage = null;
  for await (const event of streamedTurn.events) {
    writeEvent(event);

    if (event.type === "thread.started") {
      threadState.codexThreadId = event.thread_id;
      continue;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalResponse = event.item.text || finalResponse;
      continue;
    }

    if (event.type === "turn.completed") {
      usage = event.usage;
    }
  }

  return {
    threadId: threadState.threadId,
    codexThreadId: threadState.codexThreadId,
    finalResponse,
    usage,
  };
}

async function handleConfigGet() {
  return { ...state.config };
}

async function handleConfigSet(params = {}) {
  state.config = normalizeConfigPatch({
    ...state.config,
    ...(params.patch || {}),
  });
  return { ...state.config };
}

async function dispatchRequest(method, params) {
  switch (method) {
    case "health":
      return { ok: true, version: 1 };
    case "thread.open":
      return handleThreadOpen(params);
    case "thread.close":
      return handleThreadClose(params);
    case "turn.run":
      return handleTurnRun(params);
    case "config.get":
      return handleConfigGet();
    case "config.set":
      return handleConfigSet(params);
    case "shutdown":
      return { ok: true };
    default:
      throw new Error(`unsupported method: ${method}`);
  }
}

async function handleLine(rawLine) {
  const line = rawLine.trim();
  if (!line) {
    return;
  }

  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    writeEvent({
      type: "error",
      message: `failed to parse bridge request: ${String(error)}`,
    });
    return;
  }

  if (request.type !== "request") {
    writeEvent({
      type: "error",
      message: "invalid bridge message type",
    });
    return;
  }

  const id = Number(request.id);
  const method = String(request.method || "");
  const params = request.params || {};

  if (!Number.isFinite(id) || method.length === 0) {
    writeError(id, "invalid request shape");
    return;
  }

  try {
    const result = await dispatchRequest(method, params);
    writeResponse(id, result);
    if (method === "shutdown") {
      process.exit(0);
    }
  } catch (error) {
    writeError(id, error);
  }
}

async function main() {
  writeEvent({
    type: "bridge.ready",
    timestamp: new Date().toISOString(),
  });

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    await handleLine(line);
  }
}

main().catch((error) => {
  writeEvent({
    type: "error",
    message: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.exit(1);
});
