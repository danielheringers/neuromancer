import readline from "node:readline";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

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
  appServer: null,
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

function resolveCodexBinary(config) {
  const configuredBinary = normalizeBinaryOverride(config.binary);
  const envBinary = normalizeBinaryOverride(process.env.ALICIA_CODEX_BIN || "");

  if (configuredBinary) {
    return configuredBinary;
  }
  if (envBinary) {
    return envBinary;
  }
  if (codexIsAvailableOnPath()) {
    return "codex";
  }

  return "codex";
}

function resolveCodexLaunch(binary) {
  const trimmed = String(binary || "codex").trim();
  const lowered = trimmed.toLowerCase();

  if (lowered.endsWith(".mjs") || lowered.endsWith(".cjs") || lowered.endsWith(".js")) {
    return {
      command: process.execPath,
      args: [trimmed, "app-server"],
    };
  }

  if (process.platform === "win32" && (lowered.endsWith(".cmd") || lowered.endsWith(".bat"))) {
    return {
      command: "cmd",
      args: ["/C", trimmed, "app-server"],
    };
  }

  return {
    command: trimmed,
    args: ["app-server"],
  };
}

function createRuntime(child) {
  return {
    child,
    stdin: child.stdin,
    pending: new Map(),
    nextRequestId: 1,
    startPromise: null,
    started: false,
    closed: false,
    turnTrackers: new Map(),
    agentBuffers: new Map(),
  };
}

function normalizeStatus(status) {
  const value = String(status || "");
  if (value === "inProgress") return "in_progress";
  if (value === "in_progress") return "in_progress";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "declined") return "declined";
  return value || "in_progress";
}

function convertThreadItemToLegacy(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const type = String(item.type || "");

  if (type === "agentMessage") {
    return {
      type: "agent_message",
      id: item.id,
      text: typeof item.text === "string" ? item.text : "",
    };
  }

  if (type === "commandExecution") {
    return {
      type: "command_execution",
      id: item.id,
      command: typeof item.command === "string" ? item.command : "",
      status: normalizeStatus(item.status),
      aggregated_output:
        typeof item.aggregatedOutput === "string"
          ? item.aggregatedOutput
          : typeof item.aggregated_output === "string"
            ? item.aggregated_output
            : "",
      exit_code: typeof item.exitCode === "number" ? item.exitCode : item.exit_code,
    };
  }

  if (type === "mcpToolCall") {
    return {
      type: "mcp_tool_call",
      id: item.id,
      server: typeof item.server === "string" ? item.server : "",
      tool: typeof item.tool === "string" ? item.tool : "",
      status: normalizeStatus(item.status),
      arguments: item.arguments ?? {},
      result: item.result ?? null,
      error: item.error ?? null,
    };
  }

  if (type === "fileChange") {
    return {
      type: "file_change",
      id: item.id,
      status: normalizeStatus(item.status),
      changes: Array.isArray(item.changes) ? item.changes : [],
    };
  }

  if (type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
    const content = Array.isArray(item.content) ? item.content.join("\n") : "";
    const text = [summary, content].filter(Boolean).join("\n");
    return {
      type: "reasoning",
      id: item.id,
      text,
    };
  }

  if (type === "plan") {
    return {
      type: "reasoning",
      id: item.id,
      text: typeof item.text === "string" ? item.text : "",
    };
  }

  if (type === "webSearch") {
    return {
      type: "web_search",
      id: item.id,
      query: item.query,
      action: item.action,
    };
  }

  return {
    ...item,
    type: String(item.type || "unknown"),
  };
}

function ensureTurnTracker(runtime, turnId) {
  const key = String(turnId || "");
  if (!key) {
    return null;
  }

  let tracker = runtime.turnTrackers.get(key);
  if (!tracker) {
    tracker = {
      turnId: key,
      finalResponse: "",
      usage: null,
      status: "in_progress",
      error: null,
      completed: false,
      waiters: [],
    };
    runtime.turnTrackers.set(key, tracker);
  }
  return tracker;
}

function completeTurnTracker(runtime, turnId, patch = {}) {
  const tracker = ensureTurnTracker(runtime, turnId);
  if (!tracker) return;

  if (typeof patch.finalResponse === "string") {
    tracker.finalResponse = patch.finalResponse;
  }
  if (patch.usage !== undefined) {
    tracker.usage = patch.usage;
  }
  if (patch.status) {
    tracker.status = patch.status;
  }
  if (patch.error !== undefined) {
    tracker.error = patch.error;
  }

  tracker.completed = true;
  const waiters = tracker.waiters.splice(0, tracker.waiters.length);
  for (const waiter of waiters) {
    waiter({
      finalResponse: tracker.finalResponse,
      usage: tracker.usage,
      status: tracker.status,
      error: tracker.error,
    });
  }
}

function waitForTurnCompletion(runtime, turnId, timeoutMs = 600_000) {
  const tracker = ensureTurnTracker(runtime, turnId);
  if (!tracker) {
    return Promise.reject(new Error("turn id is required"));
  }

  if (tracker.completed) {
    return Promise.resolve({
      finalResponse: tracker.finalResponse,
      usage: tracker.usage,
      status: tracker.status,
      error: tracker.error,
    });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      tracker.waiters = tracker.waiters.filter((waiter) => waiter !== onDone);
      reject(new Error("timed out waiting for turn completion"));
    }, timeoutMs);

    const onDone = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };

    tracker.waiters.push(onDone);
  });
}

function runtimeSandboxToPolicy(sandbox) {
  const value = String(sandbox || "read-only").toLowerCase();
  if (value === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (value === "workspace-write") {
    return { type: "workspaceWrite" };
  }
  return { type: "readOnly" };
}

function buildThreadStartParams(runtimeConfig, workspace) {
  const params = {
    cwd: workspace,
  };

  if (runtimeConfig.model && runtimeConfig.model !== "default") {
    params.model = runtimeConfig.model;
  }

  if (runtimeConfig.approvalPolicy) {
    params.approvalPolicy = runtimeConfig.approvalPolicy;
  }

  if (runtimeConfig.sandbox) {
    params.sandbox = runtimeConfig.sandbox;
  }

  const configOverrides = {};
  if (runtimeConfig.reasoning && runtimeConfig.reasoning !== "default") {
    configOverrides.model_reasoning_effort = runtimeConfig.reasoning;
  }
  if (runtimeConfig.webSearchMode) {
    configOverrides.web_search = runtimeConfig.webSearchMode;
  }
  if (Object.keys(configOverrides).length > 0) {
    params.config = configOverrides;
  }

  return params;
}

function buildTurnStartParams({ threadId, input, runtimeConfig, workspace, outputSchema }) {
  const params = {
    threadId,
    input,
    cwd: workspace,
  };

  if (runtimeConfig.model && runtimeConfig.model !== "default") {
    params.model = runtimeConfig.model;
  }

  if (runtimeConfig.reasoning && runtimeConfig.reasoning !== "default") {
    params.effort = runtimeConfig.reasoning;
  }

  if (runtimeConfig.approvalPolicy) {
    params.approvalPolicy = runtimeConfig.approvalPolicy;
  }

  if (runtimeConfig.sandbox) {
    params.sandboxPolicy = runtimeSandboxToPolicy(runtimeConfig.sandbox);
  }

  if (outputSchema !== undefined) {
    params.outputSchema = outputSchema;
  }

  return params;
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
    if (type === "text" && typeof item.text === "string") {
      normalized.push({
        type: "text",
        text: item.text,
      });
      continue;
    }

    if (type === "local_image" && typeof item.path === "string" && item.path.length > 0) {
      normalized.push({
        type: "localImage",
        path: item.path,
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

    if (type === "image" && typeof item.imageUrl === "string" && item.imageUrl.length > 0) {
      normalized.push({
        type: "text",
        text: `Image URL: ${item.imageUrl}`,
      });
      continue;
    }
  }

  if (normalized.length === 0) {
    return [{ type: "text", text: "" }];
  }

  return normalized;
}

function parseResponseId(id) {
  if (typeof id === "number" && Number.isFinite(id)) {
    return id;
  }
  if (typeof id === "string") {
    const parsed = Number(id);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function runtimeWrite(runtime, payload) {
  if (!runtime?.stdin || runtime.closed) {
    throw new Error("app-server stdin is not available");
  }
  runtime.stdin.write(`${JSON.stringify(payload)}\n`);
}

function sendRuntimeNotification(runtime, method, params = {}) {
  runtimeWrite(runtime, {
    method,
    params,
  });
}

function sendRuntimeResponse(runtime, id, result) {
  runtimeWrite(runtime, {
    id,
    result,
  });
}

function sendRuntimeError(runtime, id, code, message) {
  runtimeWrite(runtime, {
    id,
    error: {
      code,
      message,
    },
  });
}

function sendRuntimeRequest(runtime, method, params = {}, timeoutMs = 600_000) {
  const requestId = runtime.nextRequestId++;

  return new Promise((resolve, reject) => {
    if (runtime.closed) {
      reject(new Error("app-server is closed"));
      return;
    }

    const timeout = setTimeout(() => {
      runtime.pending.delete(requestId);
      reject(new Error(`request timed out: ${method}`));
    }, timeoutMs);

    runtime.pending.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    try {
      runtimeWrite(runtime, {
        id: requestId,
        method,
        params,
      });
    } catch (error) {
      clearTimeout(timeout);
      runtime.pending.delete(requestId);
      reject(error);
    }
  });
}

function rejectPendingRequests(runtime, message) {
  for (const [id, pending] of runtime.pending) {
    runtime.pending.delete(id);
    pending.reject(new Error(message));
  }

  for (const [turnId, tracker] of runtime.turnTrackers) {
    runtime.turnTrackers.delete(turnId);
    const waiters = tracker.waiters.splice(0, tracker.waiters.length);
    for (const waiter of waiters) {
      waiter({
        finalResponse: tracker.finalResponse,
        usage: tracker.usage,
        status: "failed",
        error: { message },
      });
    }
  }
}

function asPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function handleServerRequest(runtime, message) {
  const method = String(message.method || "");
  const params = asPlainObject(message.params) ? message.params : {};

  try {
    if (method === "item/commandExecution/requestApproval") {
      sendRuntimeResponse(runtime, message.id, { decision: "decline" });
      return;
    }

    if (method === "item/fileChange/requestApproval") {
      sendRuntimeResponse(runtime, message.id, { decision: "decline" });
      return;
    }

    if (method === "item/tool/requestUserInput") {
      const answers = {};
      const questions = Array.isArray(params.questions) ? params.questions : [];
      for (const question of questions) {
        const id = String(question?.id || "");
        if (!id) continue;
        const options = Array.isArray(question.options) ? question.options : [];
        const firstLabel = typeof options[0]?.label === "string" ? options[0].label : "";
        answers[id] = { answers: firstLabel ? [firstLabel] : [] };
      }
      sendRuntimeResponse(runtime, message.id, { answers });
      return;
    }

    if (method === "item/tool/call") {
      sendRuntimeResponse(runtime, message.id, {
        contentItems: [
          {
            type: "inputText",
            text: "Dynamic tool call is not supported by Alicia bridge",
          },
        ],
        success: false,
      });
      return;
    }

    if (method === "account/chatgptAuthTokens/refresh") {
      sendRuntimeError(runtime, message.id, -32000, "chatgpt auth refresh is not supported");
      return;
    }

    sendRuntimeError(runtime, message.id, -32601, `unsupported server request: ${method}`);
  } catch (error) {
    sendRuntimeError(
      runtime,
      message.id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function handleNotification(runtime, method, params) {
  const payload = asPlainObject(params) ? params : {};

  if (method === "thread/started") {
    const threadId = String(payload.thread?.id || "");
    if (threadId) {
      writeEvent({
        type: "thread.started",
        thread_id: threadId,
      });
    }
    return;
  }

  if (method === "turn/started") {
    const turnId = String(payload.turn?.id || "");
    ensureTurnTracker(runtime, turnId);
    writeEvent({ type: "turn.started" });
    return;
  }

  if (method === "turn/completed") {
    const turn = asPlainObject(payload.turn) ? payload.turn : {};
    const turnId = String(turn.id || "");
    const status = String(turn.status || "completed");

    if (status === "failed" || status === "interrupted") {
      const error = asPlainObject(turn.error)
        ? turn.error
        : { message: status === "interrupted" ? "turn interrupted" : "turn failed" };
      writeEvent({ type: "turn.failed", error });
      completeTurnTracker(runtime, turnId, { status: "failed", error });
      return;
    }

    writeEvent({ type: "turn.completed" });
    completeTurnTracker(runtime, turnId, { status: "completed" });
    return;
  }

  if (method === "item/started") {
    const item = convertThreadItemToLegacy(payload.item);
    if (item) {
      writeEvent({ type: "item.started", item });
    }
    return;
  }

  if (method === "item/completed") {
    const turnId = String(payload.turnId || payload.turn_id || "");
    const item = convertThreadItemToLegacy(payload.item);
    if (item) {
      if (item.type === "agent_message") {
        const itemId = String(item.id || "");
        if (itemId) {
          runtime.agentBuffers.delete(itemId);
        }
        if (turnId) {
          const tracker = ensureTurnTracker(runtime, turnId);
          if (tracker && typeof item.text === "string") {
            tracker.finalResponse = item.text;
          }
        }
      }
      writeEvent({ type: "item.completed", item });
    }
    return;
  }

  if (method === "item/agentMessage/delta") {
    const itemId = String(payload.itemId || payload.item_id || "");
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (!itemId) {
      return;
    }
    const previous = runtime.agentBuffers.get(itemId) || "";
    const next = `${previous}${delta}`;
    runtime.agentBuffers.set(itemId, next);

    writeEvent({
      type: "item.updated",
      item: {
        type: "agent_message",
        id: itemId,
        text: next,
      },
    });
    return;
  }

  if (method === "error") {
    const error = asPlainObject(payload.error)
      ? payload.error
      : { message: "unknown app-server error" };
    writeEvent({ type: "turn.failed", error });

    const turnId = String(payload.turnId || payload.turn_id || "");
    const willRetry = Boolean(payload.willRetry || payload.will_retry);
    if (turnId && !willRetry) {
      completeTurnTracker(runtime, turnId, { status: "failed", error });
    }
  }
}

async function handleRuntimeStdoutLine(runtime, rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) return;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    console.error(`[app-server] invalid json message: ${String(error)}`);
    return;
  }

  if (!asPlainObject(parsed)) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "id") &&
      (Object.prototype.hasOwnProperty.call(parsed, "result") ||
        Object.prototype.hasOwnProperty.call(parsed, "error"))) {
    const responseId = parseResponseId(parsed.id);
    if (responseId == null) {
      return;
    }

    const pending = runtime.pending.get(responseId);
    if (!pending) {
      return;
    }
    runtime.pending.delete(responseId);

    if (Object.prototype.hasOwnProperty.call(parsed, "error") && parsed.error != null) {
      const message =
        typeof parsed.error?.message === "string"
          ? parsed.error.message
          : typeof parsed.error === "string"
            ? parsed.error
            : "app-server request failed";
      pending.reject(new Error(message));
    } else {
      pending.resolve(parsed.result);
    }
    return;
  }

  if (typeof parsed.method === "string") {
    if (Object.prototype.hasOwnProperty.call(parsed, "id")) {
      await handleServerRequest(runtime, parsed);
      return;
    }

    handleNotification(runtime, parsed.method, parsed.params);
  }
}

async function ensureAppServer() {
  if (state.appServer?.started && !state.appServer.closed) {
    return state.appServer;
  }

  if (state.appServer?.startPromise) {
    try {
      await state.appServer.startPromise;
    } catch {
      if (state.appServer && state.appServer.closed) {
        state.appServer = null;
      }
    }
    if (state.appServer?.started && !state.appServer.closed) {
      return state.appServer;
    }
  }

  const binary = resolveCodexBinary(state.config);
  const launch = resolveCodexLaunch(binary);

  const child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("failed to capture app-server stdio");
  }

  const runtime = createRuntime(child);
  state.appServer = runtime;

  const stdoutRl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const stderrRl = readline.createInterface({
    input: child.stderr,
    crlfDelay: Infinity,
  });

  (async () => {
    for await (const line of stdoutRl) {
      await handleRuntimeStdoutLine(runtime, line);
    }
  })()
    .catch((error) => {
      console.error(`[app-server] stdout processing failed: ${String(error)}`);
    })
    .finally(() => {
      runtime.closed = true;
      if (state.appServer === runtime) {
        state.appServer = null;
      }
      rejectPendingRequests(runtime, "app-server stdout closed");
    });

  (async () => {
    for await (const line of stderrRl) {
      const trimmed = String(line || "").trim();
      if (trimmed) {
        console.error(`[app-server] ${trimmed}`);
      }
    }
  })().catch(() => undefined);

  child.once("error", (error) => {
    runtime.closed = true;
    if (state.appServer === runtime) {
      state.appServer = null;
    }
    const message = error instanceof Error ? error.message : String(error);
    rejectPendingRequests(runtime, `app-server failed to start: ${message}`);
  });

  child.once("exit", () => {
    runtime.closed = true;
    if (state.appServer === runtime) {
      state.appServer = null;
    }
    rejectPendingRequests(runtime, "app-server exited");
  });

  runtime.startPromise = (async () => {
    await sendRuntimeRequest(runtime, "initialize", {
      clientInfo: {
        name: "alicia-bridge",
        title: "Alicia Bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    }, 60_000);

    sendRuntimeNotification(runtime, "initialized", {});
    runtime.started = true;
  })();

  try {
    await runtime.startPromise;
  } catch (error) {
    runtime.closed = true;
    if (state.appServer === runtime) {
      state.appServer = null;
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
    throw error;
  }

  return runtime;
}

async function shutdownAppServer() {
  const runtime = state.appServer;
  if (!runtime) {
    return;
  }

  state.appServer = null;

  try {
    if (runtime.started && !runtime.closed) {
      await sendRuntimeRequest(runtime, "shutdown", {}, 5_000).catch(() => undefined);
    }
  } catch {
    // best effort
  }

  runtime.closed = true;
  try {
    runtime.child.kill();
  } catch {
    // best effort
  }
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

async function createOrResumeCodexThread(runtime, runtimeConfig, workspace, codexThreadId) {
  if (codexThreadId) {
    const resumed = await sendRuntimeRequest(runtime, "thread/resume", {
      threadId: codexThreadId,
      ...buildThreadStartParams(runtimeConfig, workspace),
    });
    const resumedThreadId = String(resumed?.thread?.id || "");
    if (!resumedThreadId) {
      throw new Error("thread/resume returned no thread id");
    }
    return resumedThreadId;
  }

  const created = await sendRuntimeRequest(runtime, "thread/start", buildThreadStartParams(runtimeConfig, workspace));
  const createdThreadId = String(created?.thread?.id || "");
  if (!createdThreadId) {
    throw new Error("thread/start returned no thread id");
  }

  return createdThreadId;
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

  const runtimeConfig = normalizeConfigPatch({
    ...state.config,
    ...(params.runtimeConfig || {}),
  });

  const runtime = await ensureAppServer();

  const codexThreadIdHint =
    typeof params.codexThreadId === "string" && params.codexThreadId.length > 0
      ? params.codexThreadId
      : null;

  const codexThreadId = await createOrResumeCodexThread(
    runtime,
    runtimeConfig,
    workspace,
    codexThreadIdHint,
  );

  const threadState = {
    threadId: requestedThreadId,
    codexThreadId,
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

function isPlainJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  const runtime = await ensureAppServer();
  const inputItems = normalizeInputItems(params.inputItems);

  if (!threadState.codexThreadId) {
    threadState.codexThreadId = await createOrResumeCodexThread(runtime, runtimeConfig, workspace, null);
  }

  const turnParams = buildTurnStartParams({
    threadId: threadState.codexThreadId,
    input: inputItems,
    runtimeConfig,
    workspace,
    outputSchema: params.outputSchema,
  });

  if (params.outputSchema !== undefined && !isPlainJsonObject(params.outputSchema)) {
    throw new Error("outputSchema must be a plain JSON object");
  }

  const turnStart = await sendRuntimeRequest(runtime, "turn/start", turnParams);
  const turnId = String(turnStart?.turn?.id || "");
  if (!turnId) {
    throw new Error("turn/start returned no turn id");
  }

  const completion = await waitForTurnCompletion(runtime, turnId);

  return {
    threadId: threadState.threadId,
    codexThreadId: threadState.codexThreadId,
    finalResponse: completion.finalResponse || "",
    usage: completion.usage,
  };
}

function normalizeMcpServerIdBase(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "server";
}

function makeUniqueMcpServerId(baseId, seenIds) {
  const count = seenIds.get(baseId) || 0;
  seenIds.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

function normalizeMcpTransport(value) {
  const transport = String(value || "").trim().toLowerCase();
  if (transport === "stdio" || transport === "sse" || transport === "streamable-http") {
    return transport;
  }
  return "stdio";
}

function normalizeMcpStatusFromAuth(authStatus) {
  const normalized = String(authStatus || "").trim();
  if (normalized === "notLoggedIn") {
    return "disconnected";
  }
  return "connected";
}

function extractMcpToolNames(tools) {
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    return [];
  }

  const names = Object.keys(tools)
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return names;
}

async function collectMcpServerStatusEntries(runtime) {
  const entries = [];
  let cursor = null;

  do {
    const result = await sendRuntimeRequest(runtime, "mcpServerStatus/list", {
      limit: 100,
      cursor,
    }, 90_000);

    const data = Array.isArray(result?.data) ? result.data : [];
    for (const entry of data) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        entries.push(entry);
      }
    }

    const nextCursor =
      typeof result?.nextCursor === "string" && result.nextCursor.trim().length > 0
        ? result.nextCursor.trim()
        : null;

    cursor = nextCursor;
  } while (cursor);

  return entries;
}

async function handleMcpWarmup() {
  const runtime = await ensureAppServer();
  const startedAt = Date.now();
  const entries = await collectMcpServerStatusEntries(runtime);
  const readyServers = new Set();

  for (const entry of entries) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (name) {
      readyServers.add(name);
    }
  }

  const sorted = Array.from(readyServers).sort((a, b) => a.localeCompare(b));
  return {
    readyServers: sorted,
    totalReady: sorted.length,
    elapsedMs: Date.now() - startedAt,
  };
}

async function handleMcpList() {
  const runtime = await ensureAppServer();
  const startedAt = Date.now();
  const entries = await collectMcpServerStatusEntries(runtime);
  const seenIds = new Map();
  const servers = [];

  for (const entry of entries) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name) {
      continue;
    }

    const id = makeUniqueMcpServerId(normalizeMcpServerIdBase(name), seenIds);
    const tools = extractMcpToolNames(entry.tools);
    const status = normalizeMcpStatusFromAuth(entry.authStatus);
    const transport = normalizeMcpTransport(entry.transport);
    const url = typeof entry?.url === "string" && entry.url.trim().length > 0
      ? entry.url.trim()
      : undefined;

    servers.push({
      id,
      name,
      transport,
      status,
      tools,
      url,
    });
  }

  servers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    data: servers,
    total: servers.length,
    elapsedMs: Date.now() - startedAt,
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
    case "health": {
      const runtime = await ensureAppServer();
      return { ok: true, version: 2, pid: runtime.child.pid ?? null };
    }
    case "thread.open":
      return handleThreadOpen(params);
    case "thread.close":
      return handleThreadClose(params);
    case "turn.run":
      return handleTurnRun(params);
    case "mcp.warmup":
      return handleMcpWarmup();
    case "mcp.list":
      return handleMcpList();
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
      await shutdownAppServer();
      process.exit(0);
    }
  } catch (error) {
    writeError(id, error);
  }
}

async function main() {
  await ensureAppServer();

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





