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
    nextApprovalId: 1,
    startPromise: null,
    started: false,
    closed: false,
    turnTrackers: new Map(),
    agentBuffers: new Map(),
    rawCollabCalls: new Map(),
    completedCollabCallIds: new Set(),
    pendingApprovals: new Map(),
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

const AGENT_SPAWNER_MESSAGE_PREFIX = "__ALICIA_AGENT_SPAWNER__:";

function normalizeCollabToolName(tool) {
  const normalized = String(tool || "")
    .trim()
    .toLowerCase();

  if (normalized === "spawnagent" || normalized === "spawn_agent") {
    return "spawn_agent";
  }
  if (normalized === "sendinput" || normalized === "send_input") {
    return "send_input";
  }
  if (normalized === "resumeagent" || normalized === "resume_agent") {
    return "resume_agent";
  }
  if (normalized === "closeagent" || normalized === "close_agent") {
    return "close_agent";
  }
  if (normalized === "wait") {
    return "wait";
  }

  return normalized;
}

function isSupportedCollabTool(tool) {
  return (
    tool === "spawn_agent" ||
    tool === "send_input" ||
    tool === "resume_agent" ||
    tool === "wait" ||
    tool === "close_agent"
  );
}

function parseJsonObjectString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return asPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCollabPromptFromArgs(args) {
  if (!asPlainObject(args)) {
    return "";
  }

  if (typeof args.message === "string" && args.message.trim().length > 0) {
    return args.message.trim();
  }

  const items = Array.isArray(args.items) ? args.items : [];
  for (const item of items) {
    if (!asPlainObject(item)) {
      continue;
    }
    const type = String(item.type || "").trim().toLowerCase();
    if ((type === "text" || type === "input_text") && typeof item.text === "string") {
      const text = item.text.trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function uniqueTrimmedStrings(values) {
  const seen = new Set();
  const ordered = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function readCollabReceiverThreadIdsFromArgs(tool, args) {
  if (!asPlainObject(args)) {
    return [];
  }

  if (tool === "wait") {
    const ids = Array.isArray(args.ids) ? args.ids : [];
    return uniqueTrimmedStrings(ids);
  }

  if (typeof args.id === "string" && args.id.trim().length > 0) {
    return [args.id.trim()];
  }

  return [];
}

function parseFunctionCallOutputBody(body) {
  if (asPlainObject(body)) {
    return body;
  }

  if (typeof body === "string") {
    return parseJsonObjectString(body) ?? {};
  }

  if (Array.isArray(body)) {
    const text = body
      .map((entry) => {
        if (!asPlainObject(entry)) {
          return "";
        }
        const type = String(entry.type || "").trim().toLowerCase();
        if ((type === "input_text" || type === "text") && typeof entry.text === "string") {
          return entry.text;
        }
        return "";
      })
      .filter((entry) => entry.trim().length > 0)
      .join("\n");
    return parseJsonObjectString(text) ?? {};
  }

  return {};
}

function parseFunctionCallOutputPayload(output) {
  const success = asPlainObject(output) && typeof output.success === "boolean" ? output.success : null;

  let body = {};
  if (asPlainObject(output)) {
    if (Object.prototype.hasOwnProperty.call(output, "body")) {
      body = parseFunctionCallOutputBody(output.body);
    } else {
      body = parseFunctionCallOutputBody(output);
      if (Object.prototype.hasOwnProperty.call(body, "success")) {
        delete body.success;
      }
    }
  } else {
    body = parseFunctionCallOutputBody(output);
  }

  return { body, success };
}

function isCollabFailureState(value) {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : asPlainObject(value) && typeof value.status === "string"
        ? value.status.trim().toLowerCase()
        : "";

  return (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "errored" ||
    normalized === "notfound" ||
    normalized === "not_found"
  );
}

function deriveCollabReceiverThreadIds(tool, args, outputBody) {
  const receiverIds = readCollabReceiverThreadIdsFromArgs(tool, args);

  if (tool === "spawn_agent") {
    const spawnedAgentId =
      typeof outputBody.agent_id === "string"
        ? outputBody.agent_id.trim()
        : typeof outputBody.agentId === "string"
          ? outputBody.agentId.trim()
          : "";
    if (spawnedAgentId) {
      receiverIds.push(spawnedAgentId);
    }
  }

  if (tool === "wait" && asPlainObject(outputBody.status)) {
    receiverIds.push(...Object.keys(outputBody.status));
  }

  return uniqueTrimmedStrings(receiverIds);
}

function deriveCollabAgentsStates(tool, outputBody, receiverThreadIds) {
  if (!asPlainObject(outputBody)) {
    return {};
  }

  const states = {};

  if (tool === "wait" && asPlainObject(outputBody.status)) {
    for (const [agentId, status] of Object.entries(outputBody.status)) {
      const key = String(agentId || "").trim();
      if (!key) {
        continue;
      }
      states[key] = status;
    }
    return states;
  }

  if (tool === "spawn_agent") {
    const spawnedAgentId =
      typeof outputBody.agent_id === "string"
        ? outputBody.agent_id.trim()
        : typeof outputBody.agentId === "string"
          ? outputBody.agentId.trim()
          : "";
    if (spawnedAgentId) {
      states[spawnedAgentId] = Object.prototype.hasOwnProperty.call(outputBody, "status")
        ? outputBody.status
        : "running";
    }
    return states;
  }

  if (!Object.prototype.hasOwnProperty.call(outputBody, "status")) {
    return states;
  }

  for (const receiverId of receiverThreadIds) {
    states[receiverId] = outputBody.status;
  }

  return states;
}

function deriveCollabToolStatus(tool, outputBody, agentsStates, outputSuccess) {
  if (outputSuccess === false) {
    return "failed";
  }

  const stateValues = Object.values(agentsStates);

  if (tool === "wait") {
    const timedOut = Boolean(outputBody?.timed_out ?? outputBody?.timedOut);
    if (timedOut && stateValues.length === 0) {
      return "in_progress";
    }
  }

  if (stateValues.some((value) => isCollabFailureState(value))) {
    return "failed";
  }

  return "completed";
}

function inferCollabToolFromFunctionCallOutput(item, outputBody) {
  const directTool = normalizeCollabToolName(item?.name || item?.tool);
  if (isSupportedCollabTool(directTool)) {
    return directTool;
  }

  if (!asPlainObject(outputBody)) {
    return "";
  }

  const hasSpawnedAgent =
    (typeof outputBody.agent_id === "string" && outputBody.agent_id.trim().length > 0) ||
    (typeof outputBody.agentId === "string" && outputBody.agentId.trim().length > 0);
  if (hasSpawnedAgent) {
    return "spawn_agent";
  }

  if (
    asPlainObject(outputBody.status) ||
    Array.isArray(outputBody.receivers) ||
    Array.isArray(outputBody.receiverIds) ||
    Array.isArray(outputBody.receiver_ids) ||
    Object.prototype.hasOwnProperty.call(outputBody, "timed_out") ||
    Object.prototype.hasOwnProperty.call(outputBody, "timedOut")
  ) {
    return "wait";
  }

  return "";
}

function rememberCompletedCollabCall(runtime, callId) {
  const key = String(callId || "").trim();
  if (!key || !runtime?.completedCollabCallIds) {
    return;
  }

  runtime.completedCollabCallIds.add(key);
  if (runtime.completedCollabCallIds.size > 4096) {
    const first = runtime.completedCollabCallIds.values().next().value;
    if (first) {
      runtime.completedCollabCallIds.delete(first);
    }
  }
}

function cacheRawCollabCall(runtime, callId, value) {
  const key = String(callId || "").trim();
  if (!key || !runtime?.rawCollabCalls) {
    return;
  }

  runtime.rawCollabCalls.set(key, value);
  if (runtime.rawCollabCalls.size > 4096) {
    const first = runtime.rawCollabCalls.keys().next().value;
    if (first) {
      runtime.rawCollabCalls.delete(first);
    }
  }
}

function convertRawResponseItemToLegacy(runtime, item, context = {}) {
  if (!asPlainObject(item)) {
    return null;
  }

  const itemType = String(item.type || "").trim().toLowerCase();
  if (itemType === "function_call") {
    const tool = normalizeCollabToolName(item.name || item.tool);
    if (!isSupportedCollabTool(tool)) {
      return null;
    }

    const callId = String(item.call_id || item.callId || item.id || "").trim();
    if (!callId) {
      return null;
    }

    const parsedArguments =
      asPlainObject(item.arguments) ? item.arguments : parseJsonObjectString(item.arguments) ?? {};
    const senderThreadId =
      normalizeThreadIdCandidate(context.senderThreadId) ||
      normalizeThreadIdCandidate(context.threadId);
    const receiverThreadIds = readCollabReceiverThreadIdsFromArgs(tool, parsedArguments);
    const prompt = readCollabPromptFromArgs(parsedArguments);

    cacheRawCollabCall(runtime, callId, {
      callId,
      tool,
      senderThreadId,
      receiverThreadIds,
      prompt,
      arguments: parsedArguments,
    });

    return null;
  }

  if (itemType !== "function_call_output") {
    return null;
  }

  const callId = String(item.call_id || item.callId || item.id || "").trim();
  if (!callId) {
    return null;
  }

  if (runtime?.completedCollabCallIds?.has(callId)) {
    runtime.rawCollabCalls?.delete(callId);
    return null;
  }

  const { body: outputBody, success: outputSuccess } = parseFunctionCallOutputPayload(item.output);

  const pending = runtime?.rawCollabCalls?.get(callId);
  if (pending) {
    runtime.rawCollabCalls.delete(callId);
  }

  const resolvedTool = isSupportedCollabTool(pending?.tool)
    ? pending.tool
    : inferCollabToolFromFunctionCallOutput(item, outputBody);
  if (!isSupportedCollabTool(resolvedTool)) {
    return null;
  }

  const receiverThreadIds = deriveCollabReceiverThreadIds(
    resolvedTool,
    pending?.arguments ?? {},
    outputBody,
  );
  const agentsStates = deriveCollabAgentsStates(resolvedTool, outputBody, receiverThreadIds);
  const status = deriveCollabToolStatus(
    resolvedTool,
    outputBody,
    agentsStates,
    outputSuccess,
  );
  const senderThreadId =
    normalizeThreadIdCandidate(pending?.senderThreadId) ||
    normalizeThreadIdCandidate(context.senderThreadId) ||
    normalizeThreadIdCandidate(context.threadId);

  return {
    type: "collab_tool_call",
    id: callId,
    tool: resolvedTool,
    status,
    sender_thread_id: senderThreadId,
    receiver_thread_ids: receiverThreadIds,
    prompt: typeof pending?.prompt === "string" ? pending.prompt : "",
    agents_states: agentsStates,
  };
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

  if (type === "collabAgentToolCall" || type === "collabToolCall") {
    const receiverThreadIds = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds
      : Array.isArray(item.receiver_thread_ids)
        ? item.receiver_thread_ids
        : typeof item.receiverThreadId === "string"
          ? [item.receiverThreadId]
          : typeof item.receiver_thread_id === "string"
            ? [item.receiver_thread_id]
            : typeof item.newThreadId === "string"
              ? [item.newThreadId]
              : typeof item.new_thread_id === "string"
                ? [item.new_thread_id]
                : [];

    return {
      type: "collab_tool_call",
      id: item.id,
      tool: normalizeCollabToolName(item.tool),
      status: normalizeStatus(item.status),
      sender_thread_id:
        typeof item.senderThreadId === "string"
          ? item.senderThreadId
          : typeof item.sender_thread_id === "string"
            ? item.sender_thread_id
            : "",
      receiver_thread_ids: receiverThreadIds
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0),
      prompt: typeof item.prompt === "string" ? item.prompt : "",
      agents_states: asPlainObject(item.agentsStates)
        ? item.agentsStates
        : asPlainObject(item.agents_states)
          ? item.agents_states
          : {},
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

    if ((type === "local_image" || type === "localimage") && typeof item.path === "string" && item.path.length > 0) {
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

    if (type === "image") {
      const imageUrl =
        typeof item.imageUrl === "string" && item.imageUrl.length > 0
          ? item.imageUrl
          : typeof item.url === "string" && item.url.length > 0
            ? item.url
            : "";
      if (imageUrl) {
        normalized.push({
          type: "text",
          text: `Image URL: ${imageUrl}`,
        });
        continue;
      }
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

  for (const [actionId, pendingApproval] of runtime.pendingApprovals) {
    runtime.pendingApprovals.delete(actionId);
    pendingApproval.reject(new Error(message));
  }
}

function asPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeApprovalKind(method) {
  if (method === "item/commandExecution/requestApproval") {
    return "command_execution";
  }
  if (method === "item/fileChange/requestApproval") {
    return "file_change";
  }
  return null;
}

function makeApprovalActionId(runtime) {
  const value = runtime.nextApprovalId;
  runtime.nextApprovalId += 1;
  return `approval-${value}`;
}

function approvalDecisionName(responsePayload) {
  const decision = responsePayload?.decision;
  if (typeof decision === "string") {
    return decision;
  }

  if (asPlainObject(decision) && Object.prototype.hasOwnProperty.call(decision, "acceptWithExecpolicyAmendment")) {
    return "acceptWithExecpolicyAmendment";
  }

  return "decline";
}

function normalizeCommandApprovalResult(decision, execpolicyAmendment) {
  if (decision === "accept") {
    return { decision: "accept" };
  }
  if (decision === "acceptForSession") {
    return { decision: "acceptForSession" };
  }
  if (decision === "decline") {
    return { decision: "decline" };
  }
  if (decision === "cancel") {
    return { decision: "cancel" };
  }
  if (decision === "acceptWithExecpolicyAmendment") {
    if (!Array.isArray(execpolicyAmendment) || execpolicyAmendment.length === 0) {
      throw new Error("acceptWithExecpolicyAmendment requires execpolicyAmendment");
    }
    return {
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: execpolicyAmendment,
        },
      },
    };
  }

  throw new Error(`unsupported command approval decision: ${decision}`);
}

function normalizeFileChangeApprovalResult(decision) {
  if (decision === "accept") {
    return { decision: "accept" };
  }
  if (decision === "acceptForSession") {
    return { decision: "acceptForSession" };
  }
  if (decision === "decline") {
    return { decision: "decline" };
  }
  if (decision === "cancel") {
    return { decision: "cancel" };
  }

  throw new Error(`unsupported file-change approval decision: ${decision}`);
}

function requestApproval(runtime, method, requestId, params, timeoutMs = 900_000) {
  const kind = normalizeApprovalKind(method);
  if (!kind) {
    throw new Error(`approval is not supported for method: ${method}`);
  }

  const actionId = makeApprovalActionId(runtime);
  const threadId = String(params.threadId || params.thread_id || "");
  const turnId = String(params.turnId || params.turn_id || "");
  const itemId = String(params.itemId || params.item_id || "");

  const commandActions = Array.isArray(params.commandActions)
    ? params.commandActions
    : Array.isArray(params.command_actions)
      ? params.command_actions
      : [];

  const proposedExecpolicyAmendment = Array.isArray(params.proposedExecpolicyAmendment)
    ? params.proposedExecpolicyAmendment
    : Array.isArray(params.proposed_execpolicy_amendment)
      ? params.proposed_execpolicy_amendment
      : [];

  writeEvent({
    type: "approval.requested",
    action_id: actionId,
    kind,
    thread_id: threadId,
    turn_id: turnId,
    item_id: itemId,
    reason: typeof params.reason === "string" ? params.reason : "",
    command: typeof params.command === "string" ? params.command : "",
    cwd: typeof params.cwd === "string" ? params.cwd : "",
    command_actions: commandActions,
    proposed_execpolicy_amendment: proposedExecpolicyAmendment,
    grant_root: typeof params.grantRoot === "string"
      ? params.grantRoot
      : typeof params.grant_root === "string"
        ? params.grant_root
        : "",
  });

  return new Promise((resolve, reject) => {
    let completed = false;

    const timeout = setTimeout(() => {
      if (completed) {
        return;
      }
      completed = true;
      runtime.pendingApprovals.delete(actionId);
      reject(new Error("approval response timed out"));
    }, timeoutMs);

    const resolveApproval = (response) => {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timeout);
      runtime.pendingApprovals.delete(actionId);
      resolve({
        actionId,
        kind,
        requestId,
        response,
      });
    };

    const rejectApproval = (error) => {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timeout);
      runtime.pendingApprovals.delete(actionId);
      reject(error);
    };

    runtime.pendingApprovals.set(actionId, {
      actionId,
      kind,
      requestId,
      resolve: resolveApproval,
      reject: rejectApproval,
    });
  });
}

function resolveApprovalResponse(runtime, params = {}) {
  const actionId = typeof params.actionId === "string"
    ? params.actionId.trim()
    : typeof params.action_id === "string"
      ? params.action_id.trim()
      : "";

  if (!actionId) {
    throw new Error("approval actionId is required");
  }

  const pendingApproval = runtime.pendingApprovals.get(actionId);
  if (!pendingApproval) {
    throw new Error(`approval action not found: ${actionId}`);
  }

  const remember = Boolean(params.remember);

  let decision = typeof params.decision === "string" && params.decision.trim().length > 0
    ? params.decision.trim()
    : "decline";

  if (remember && decision === "accept") {
    decision = "acceptForSession";
  }

  const execpolicyAmendmentRaw = Array.isArray(params.execpolicyAmendment)
    ? params.execpolicyAmendment
    : Array.isArray(params.execpolicy_amendment)
      ? params.execpolicy_amendment
      : [];

  const execpolicyAmendment = execpolicyAmendmentRaw
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  const response = pendingApproval.kind === "command_execution"
    ? normalizeCommandApprovalResult(decision, execpolicyAmendment)
    : normalizeFileChangeApprovalResult(decision);

  pendingApproval.resolve(response);

  return {
    ok: true,
    actionId,
    kind: pendingApproval.kind,
    decision: approvalDecisionName(response),
  };
}

async function handleServerRequest(runtime, message) {
  const method = String(message.method || "");
  const params = asPlainObject(message.params) ? message.params : {};

  try {
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      const approval = await requestApproval(runtime, method, message.id, params);
      sendRuntimeResponse(runtime, message.id, approval.response);
      writeEvent({
        type: "approval.resolved",
        action_id: approval.actionId,
        kind: approval.kind,
        decision: approvalDecisionName(approval.response),
      });
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
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      try {
        sendRuntimeResponse(runtime, message.id, { decision: "decline" });
      } catch {
        // best effort
      }
      return;
    }

    sendRuntimeError(
      runtime,
      message.id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeTokenUsageBreakdown(value) {
  if (!asPlainObject(value)) {
    return null;
  }

  const totalTokens = asFiniteNumber(value.totalTokens ?? value.total_tokens);
  const inputTokens = asFiniteNumber(value.inputTokens ?? value.input_tokens);
  const cachedInputTokens = asFiniteNumber(value.cachedInputTokens ?? value.cached_input_tokens);
  const outputTokens = asFiniteNumber(value.outputTokens ?? value.output_tokens);
  const reasoningOutputTokens = asFiniteNumber(value.reasoningOutputTokens ?? value.reasoning_output_tokens);

  if (
    totalTokens == null ||
    inputTokens == null ||
    cachedInputTokens == null ||
    outputTokens == null ||
    reasoningOutputTokens == null
  ) {
    return null;
  }

  return {
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
  };
}

function normalizeTokenUsage(value) {
  if (!asPlainObject(value)) {
    return null;
  }

  const total = normalizeTokenUsageBreakdown(value.total);
  const last = normalizeTokenUsageBreakdown(value.last);
  if (!total || !last) {
    return null;
  }

  const modelContextWindow = asFiniteNumber(value.modelContextWindow ?? value.model_context_window);

  return {
    total,
    last,
    model_context_window: modelContextWindow,
  };
}

function normalizePlanStepStatus(status) {
  const value = String(status || "pending");
  if (value === "pending") {
    return "pending";
  }
  if (value === "inProgress" || value === "in_progress") {
    return "inProgress";
  }
  if (value === "completed") {
    return "completed";
  }
  return "pending";
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

  if (method === "thread/tokenUsage/updated") {
    const threadId = String(payload.threadId || payload.thread_id || "");
    const turnId = String(payload.turnId || payload.turn_id || "");
    const tokenUsage = normalizeTokenUsage(payload.tokenUsage ?? payload.token_usage);

    if (turnId && tokenUsage) {
      const tracker = ensureTurnTracker(runtime, turnId);
      if (tracker) {
        tracker.usage = tokenUsage;
      }
    }

    writeEvent({
      type: "thread.token_usage.updated",
      thread_id: threadId,
      turn_id: turnId,
      token_usage: tokenUsage,
    });
    return;
  }

  if (method === "turn/started") {
    const turnId = String(payload.turn?.id || "");
    const threadId = String(
      payload.threadId || payload.thread_id || payload.turn?.threadId || payload.turn?.thread_id || "",
    );
    ensureTurnTracker(runtime, turnId);
    writeEvent({
      type: "turn.started",
      thread_id: threadId,
      turn_id: turnId,
    });
    return;
  }

  if (method === "turn/diff/updated") {
    const threadId = String(payload.threadId || payload.thread_id || "");
    const turnId = String(payload.turnId || payload.turn_id || "");
    const diff = typeof payload.diff === "string" ? payload.diff : "";

    writeEvent({
      type: "turn.diff.updated",
      thread_id: threadId,
      turn_id: turnId,
      diff,
    });
    return;
  }

  if (method === "turn/plan/updated") {
    const threadId = String(payload.threadId || payload.thread_id || "");
    const turnId = String(payload.turnId || payload.turn_id || "");
    const explanation = typeof payload.explanation === "string" ? payload.explanation : null;
    const rawPlan = Array.isArray(payload.plan) ? payload.plan : [];
    const plan = rawPlan
      .map((entry) => ({
        step: typeof entry?.step === "string" ? entry.step : "",
        status: normalizePlanStepStatus(entry?.status),
      }))
      .filter((entry) => entry.step.length > 0);

    writeEvent({
      type: "turn.plan.updated",
      thread_id: threadId,
      turn_id: turnId,
      explanation,
      plan,
    });
    return;
  }

  if (method === "turn/completed") {
    const turn = asPlainObject(payload.turn) ? payload.turn : {};
    const turnId = String(turn.id || "");
    const threadId = String(
      payload.threadId || payload.thread_id || turn.threadId || turn.thread_id || "",
    );
    const status = String(turn.status || "completed");
    const usage = normalizeTokenUsage(turn.tokenUsage ?? turn.token_usage ?? turn.usage);

    if (status === "failed" || status === "interrupted") {
      const error = asPlainObject(turn.error)
        ? turn.error
        : { message: status === "interrupted" ? "turn interrupted" : "turn failed" };
      writeEvent({
        type: "turn.failed",
        thread_id: threadId,
        turn_id: turnId,
        error,
      });
      completeTurnTracker(runtime, turnId, { status: "failed", usage, error });
      return;
    }

    writeEvent({
      type: "turn.completed",
      thread_id: threadId,
      turn_id: turnId,
    });
    completeTurnTracker(runtime, turnId, { status: "completed", usage });
    return;
  }

  if (method === "rawResponseItem/completed" || method === "codex/event/raw_response_item") {
    const responseItem = payload.item ?? payload.responseItem ?? payload.response_item;
    const rawItem = convertRawResponseItemToLegacy(runtime, responseItem, {
      threadId: payload.threadId || payload.thread_id || payload.conversationId || payload.conversation_id,
      senderThreadId: payload.senderThreadId || payload.sender_thread_id,
    });
    if (rawItem) {
      rememberCompletedCollabCall(runtime, rawItem.id);
      writeEvent({ type: "item.completed", item: rawItem });
    }
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
      if (item.type === "collab_tool_call") {
        const collabCallId = String(item.id || "").trim();
        if (collabCallId) {
          rememberCompletedCollabCall(runtime, collabCallId);
          runtime.rawCollabCalls.delete(collabCallId);
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

function normalizeThreadIdCandidate(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function findThreadStateByCodexThreadId(codexThreadId) {
  const key = normalizeThreadIdCandidate(codexThreadId);
  if (!key) {
    return null;
  }

  for (const threadState of state.threads.values()) {
    if (!threadState || typeof threadState !== "object") {
      continue;
    }

    if (normalizeThreadIdCandidate(threadState.codexThreadId) === key) {
      return threadState;
    }
  }

  return null;
}

function resolveThreadStateByAnyId(threadId) {
  const key = normalizeThreadIdCandidate(threadId);
  if (!key) {
    return null;
  }

  const byLocalId = state.threads.get(key);
  if (byLocalId) {
    return byLocalId;
  }

  return findThreadStateByCodexThreadId(key);
}

function resolveThreadRef(threadId, workspace, allowRaw = false) {
  const requestedThreadId = normalizeThreadIdCandidate(threadId);
  if (!requestedThreadId) {
    throw new Error("threadId is required");
  }

  const threadState = resolveThreadStateByAnyId(requestedThreadId);
  if (threadState) {
    return {
      threadState,
      threadId: threadState.threadId,
      codexThreadId:
        normalizeThreadIdCandidate(threadState.codexThreadId) || requestedThreadId,
      workspace:
        typeof threadState.workspace === "string" && threadState.workspace.length > 0
          ? threadState.workspace
          : typeof workspace === "string" && workspace.length > 0
            ? workspace
            : process.cwd(),
    };
  }

  if (!allowRaw) {
    throw new Error(`thread not found: ${requestedThreadId}`);
  }

  return {
    threadState: null,
    threadId: requestedThreadId,
    codexThreadId: requestedThreadId,
    workspace:
      typeof workspace === "string" && workspace.length > 0 ? workspace : process.cwd(),
  };
}

function normalizeThreadSource(source) {
  if (typeof source === "string" && source.trim().length > 0) {
    return source.trim();
  }

  if (!asPlainObject(source)) {
    return "unknown";
  }

  const subAgent = source.subAgent ?? source.sub_agent;
  if (typeof subAgent === "string" && subAgent.trim().length > 0) {
    return `subAgent:${subAgent.trim()}`;
  }

  if (asPlainObject(subAgent)) {
    if (asPlainObject(subAgent.threadSpawn ?? subAgent.thread_spawn)) {
      return "subAgent:threadSpawn";
    }

    if (typeof subAgent.other === "string" && subAgent.other.trim().length > 0) {
      return `subAgent:other:${subAgent.other.trim()}`;
    }

    return "subAgent";
  }

  return "unknown";
}

function normalizeHistoryRole(role) {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  if (normalized === "user") {
    return "user";
  }
  if (normalized === "assistant" || normalized === "agent") {
    return "agent";
  }
  if (normalized === "system") {
    return "system";
  }
  return null;
}

function normalizeUserInputToText(input) {
  if (!asPlainObject(input)) {
    return "";
  }

  const inputType = String(input.type || "").trim();
  if (inputType === "text") {
    return typeof input.text === "string" ? input.text : "";
  }

  if (inputType === "mention") {
    const path = typeof input.path === "string" ? input.path.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (path) {
      return `@${path}`;
    }
    if (name) {
      return `@${name}`;
    }
    return "@mention";
  }

  if (inputType === "skill") {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    return name ? `[skill] ${name}` : "[skill]";
  }

  if (inputType === "localImage" || inputType === "local_image") {
    const path = typeof input.path === "string" ? input.path.trim() : "";
    return path ? `[local_image] ${path}` : "[local_image]";
  }

  if (inputType === "image") {
    const url = typeof input.url === "string" ? input.url.trim() : "";
    return url ? `[image] ${url}` : "[image]";
  }

  return "";
}

function historyStatusToAgentState(status, fallback = "running") {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "pendinginit" || normalized === "pending init") {
    return "pending init";
  }
  if (normalized === "inprogress" || normalized === "in_progress" || normalized === "running") {
    return "running";
  }
  if (normalized === "completed" || normalized === "done" || normalized === "shutdown") {
    return "done";
  }
  if (
    normalized === "failed" ||
    normalized === "errored" ||
    normalized === "error" ||
    normalized === "notfound" ||
    normalized === "not_found"
  ) {
    return "error";
  }
  return fallback;
}

function historyToolStatusFallback(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "failed") {
    return "error";
  }
  if (normalized === "completed") {
    return "done";
  }
  return "running";
}

function historyReadStringArray(source, keys) {
  if (!asPlainObject(source)) {
    return [];
  }

  for (const key of keys) {
    const raw = source[key];
    if (Array.isArray(raw)) {
      const values = raw
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0);
      if (values.length > 0) {
        return values;
      }
    }

    const single = String(raw || "").trim();
    if (single.length > 0) {
      return [single];
    }
  }

  return [];
}

function historyUniqueStrings(values) {
  const ordered = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function historyReadStateMap(item) {
  if (!asPlainObject(item)) {
    return {};
  }

  if (asPlainObject(item.agentsStates)) {
    return item.agentsStates;
  }
  if (asPlainObject(item.agents_states)) {
    return item.agents_states;
  }
  if (asPlainObject(item.agentStates)) {
    return item.agentStates;
  }
  if (asPlainObject(item.agent_states)) {
    return item.agent_states;
  }

  return {};
}

function encodeAgentSpawnerMessage(payload) {
  return `${AGENT_SPAWNER_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

function buildAgentSpawnerPayloadFromHistoryItem(item) {
  if (!asPlainObject(item)) {
    return null;
  }

  const tool = normalizeCollabToolName(item.tool);
  if (!tool) {
    return null;
  }

  const callId =
    normalizeThreadIdCandidate(item.id) ||
    String(item.call_id || item.callId || "").trim() ||
    "collab-call";
  const senderThreadId = String(item.senderThreadId || item.sender_thread_id || "").trim();
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  const fallbackStatus = historyToolStatusFallback(item.status);

  const receiverIds = historyReadStringArray(item, [
    "receiverThreadIds",
    "receiver_thread_ids",
    "receiverThreadId",
    "receiver_thread_id",
    "newThreadId",
    "new_thread_id",
  ]);

  const states = historyReadStateMap(item);
  const stateKeys = Object.keys(states)
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry.length > 0);

  const agentIds = historyUniqueStrings([...receiverIds, ...stateKeys]);

  const agents = agentIds.map((agentId) => {
    const rawState = states[agentId];
    const stateObject = asPlainObject(rawState) ? rawState : null;
    const stateValue = stateObject && Object.prototype.hasOwnProperty.call(stateObject, "status")
      ? stateObject.status
      : rawState;

    return {
      callId,
      agentId,
      status: historyStatusToAgentState(stateValue, fallbackStatus),
      prompt,
      ownership: senderThreadId ? `${senderThreadId} -> ${agentId}` : agentId,
    };
  });

  let waiting = null;
  if (tool === "wait") {
    const receivers = historyUniqueStrings([
      ...agentIds,
      ...historyReadStringArray(item, ["receivers", "receiverIds", "receiver_ids"]),
    ]);

    if (receivers.length > 0) {
      waiting = {
        callId,
        receivers,
      };
    }
  }

  if (agents.length === 0 && !waiting) {
    return null;
  }

  const payload = { agents };
  if (waiting) {
    payload.waiting = waiting;
  }

  return payload;
}

function formatStructuredHistoryItem(item) {
  if (!asPlainObject(item)) {
    return null;
  }

  const itemType = String(item.type || "").trim();

  if (itemType === "commandExecution" || itemType === "command_execution") {
    const command = String(item.command || "command").trim() || "command";
    const status = normalizeStatus(item.status);
    const output =
      typeof item.aggregatedOutput === "string"
        ? item.aggregatedOutput
        : typeof item.aggregated_output === "string"
          ? item.aggregated_output
          : "";
    return `[command:${status}] ${command}${output ? `\n${output}` : ""}`;
  }

  if (itemType === "mcpToolCall" || itemType === "mcp_tool_call") {
    const tool = String(item.tool || "tool").trim() || "tool";
    const status = normalizeStatus(item.status);
    return `[mcp:${status}] ${tool}`;
  }

  if (itemType === "fileChange" || itemType === "file_change") {
    return "[file_change] changes applied";
  }

  if (itemType === "reasoning") {
    const text =
      typeof item.text === "string"
        ? item.text
        : [
            Array.isArray(item.summary) ? item.summary.join("\n") : "",
            Array.isArray(item.content) ? item.content.join("\n") : "",
          ]
            .filter(Boolean)
            .join("\n");
    return text.trim().length > 0 ? `[reasoning]\n${text}` : "[reasoning]";
  }

  if (itemType === "error") {
    return `[error] ${String(item.message || "unknown")}`;
  }

  if (itemType === "webSearch" || itemType === "web_search") {
    const query = String(item.query || "").trim();
    return query ? `[web_search] ${query}` : "[web_search]";
  }

  if (itemType === "imageView" || itemType === "image_view") {
    const path = String(item.path || "").trim();
    return path ? `[image_view] ${path}` : "[image_view]";
  }

  if (
    itemType === "collabAgentToolCall" ||
    itemType === "collabToolCall" ||
    itemType === "collab_tool_call"
  ) {
    const payload = buildAgentSpawnerPayloadFromHistoryItem(item);
    if (payload) {
      return encodeAgentSpawnerMessage(payload);
    }

    const tool = normalizeCollabToolName(item.tool) || "collab";
    const status = normalizeStatus(item.status);
    return `[collab:${status}] ${tool}`;
  }

  return null;
}

function summarizeThreadItemForHistory(item) {
  if (!asPlainObject(item)) {
    return null;
  }

  const itemType = String(item.type || "").trim();
  if (itemType === "userMessage" || itemType === "user_message") {
    const contentItems = Array.isArray(item.content) ? item.content : [];
    const content = contentItems
      .map((entry) => normalizeUserInputToText(entry))
      .filter((entry) => entry.trim().length > 0)
      .join("\n")
      .trim();
    if (!content) {
      return null;
    }
    return { role: "user", content };
  }

  if (itemType === "agentMessage" || itemType === "agent_message") {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) {
      return null;
    }
    return { role: "agent", content: text };
  }

  const structured = formatStructuredHistoryItem(item);
  if (structured && structured.trim().length > 0) {
    return { role: "system", content: structured };
  }

  const role = normalizeHistoryRole(item.role);
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (role && content) {
    return { role, content };
  }

  return null;
}

function summarizeThreadItemsForHistory(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const mapped = items
    .map((entry) => summarizeThreadItemForHistory(entry))
    .filter((entry) => entry !== null);

  if (mapped.length === 0) {
    return [];
  }

  const deduped = [];
  for (const entry of mapped) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === entry.role && previous.content === entry.content) {
      continue;
    }
    deduped.push(entry);
  }

  return deduped;
}

function normalizeThreadTurn(turn) {
  if (!asPlainObject(turn)) {
    return null;
  }

  const id = normalizeThreadIdCandidate(turn.id);
  if (!id) {
    return null;
  }

  const historyItems = [];
  if (Array.isArray(turn.messages)) {
    historyItems.push(...turn.messages);
  }
  if (Array.isArray(turn.items)) {
    historyItems.push(...turn.items);
  }
  const historyMessages = summarizeThreadItemsForHistory(historyItems);

  const normalized = {
    id,
    status: normalizeStatus(turn.status),
    itemCount: Array.isArray(turn.items) ? turn.items.length : 0,
  };

  if (historyMessages.length > 0) {
    normalized.messages = historyMessages;
  }

  return normalized;
}

function normalizeThreadRecord(thread, options = {}) {
  if (!asPlainObject(thread)) {
    return null;
  }

  const codexThreadId = normalizeThreadIdCandidate(thread.id);
  if (!codexThreadId) {
    return null;
  }

  const mappedThread = resolveThreadStateByAnyId(codexThreadId);
  const preferredThreadId = normalizeThreadIdCandidate(options.preferredThreadId);
  const id = preferredThreadId || mappedThread?.threadId || codexThreadId;

  const normalizedTurns = Array.isArray(thread.turns)
    ? thread.turns.map(normalizeThreadTurn).filter((entry) => entry !== null)
    : [];

  const explicitTurnCount = asFiniteNumber(thread.turnCount ?? thread.turn_count);
  const turnCount =
    explicitTurnCount == null
      ? normalizedTurns.length
      : Math.max(0, Math.trunc(explicitTurnCount));

  const modelProvider =
    typeof options.modelProvider === "string" && options.modelProvider.trim().length > 0
      ? options.modelProvider.trim()
      : typeof thread.modelProvider === "string"
        ? thread.modelProvider
        : typeof thread.model_provider === "string"
          ? thread.model_provider
          : "";

  const cwd =
    typeof options.cwd === "string" && options.cwd.trim().length > 0
      ? options.cwd.trim()
      : typeof thread.cwd === "string"
        ? thread.cwd
        : "";

  const normalized = {
    id,
    codexThreadId,
    preview: typeof thread.preview === "string" ? thread.preview : "",
    modelProvider,
    createdAt: asFiniteNumber(thread.createdAt ?? thread.created_at) ?? 0,
    updatedAt: asFiniteNumber(thread.updatedAt ?? thread.updated_at) ?? 0,
    cwd,
    path: typeof thread.path === "string" ? thread.path : null,
    source: normalizeThreadSource(thread.source),
    turnCount,
  };

  if (options.includeTurns || normalizedTurns.length > 0) {
    normalized.turns = normalizedTurns;
  }

  return normalized;
}

function getThreadOrThrow(threadId) {
  const key = normalizeThreadIdCandidate(threadId);
  if (!key) {
    throw new Error("threadId is required");
  }

  const threadState = resolveThreadStateByAnyId(key);
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
  const providedThreadId = normalizeThreadIdCandidate(params.threadId);
  const requestedThreadId = providedThreadId || `thread-${state.nextThreadId++}`;

  const workspace =
    typeof params.workspace === "string" && params.workspace.length > 0
      ? params.workspace
      : process.cwd();

  const existing = resolveThreadStateByAnyId(requestedThreadId);
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
      : providedThreadId || null;

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
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);
  const runtimeConfig = normalizeConfigPatch({
    ...state.config,
    ...(params.runtimeConfig || {}),
  });

  const workspace =
    typeof params.workspace === "string" && params.workspace.length > 0
      ? params.workspace
      : threadRef.workspace;

  const runtime = await ensureAppServer();
  const inputItems = normalizeInputItems(params.inputItems);

  let codexThreadId = threadRef.codexThreadId;

  if (threadRef.threadState && !normalizeThreadIdCandidate(threadRef.threadState.codexThreadId)) {
    codexThreadId = await createOrResumeCodexThread(runtime, runtimeConfig, workspace, null);
    threadRef.threadState.codexThreadId = codexThreadId;
    threadRef.threadState.workspace = workspace;
  }

  if (!codexThreadId) {
    throw new Error("failed to resolve codex thread id");
  }

  const turnParams = buildTurnStartParams({
    threadId: codexThreadId,
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
    threadId: threadRef.threadId,
    codexThreadId,
    finalResponse: completion.finalResponse || "",
    usage: completion.usage,
  };
}

function buildThreadListParams(params = {}) {
  const normalized = {};

  if (typeof params.cursor === "string") {
    normalized.cursor = params.cursor;
  } else if (params.cursor === null) {
    normalized.cursor = null;
  }

  const limit = asFiniteNumber(params.limit);
  if (limit != null && limit > 0) {
    normalized.limit = Math.trunc(limit);
  }

  if (typeof params.sortKey === "string" && params.sortKey.trim().length > 0) {
    normalized.sortKey = params.sortKey.trim();
  }

  const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) {
      return null;
    }

    return value
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry.length > 0);
  };

  const modelProviders = normalizeStringArray(params.modelProviders);
  if (modelProviders) {
    normalized.modelProviders = modelProviders;
  }

  const sourceKinds = normalizeStringArray(params.sourceKinds);
  if (sourceKinds) {
    normalized.sourceKinds = sourceKinds;
  }

  if (typeof params.archived === "boolean") {
    normalized.archived = params.archived;
  } else if (params.archived === null) {
    normalized.archived = null;
  }

  const cwd =
    typeof params.cwd === "string" && params.cwd.trim().length > 0
      ? params.cwd.trim()
      : typeof params.workspace === "string" && params.workspace.trim().length > 0
        ? params.workspace.trim()
        : "";
  if (cwd) {
    normalized.cwd = cwd;
  }

  return normalized;
}

async function handleThreadList(params = {}) {
  const runtime = await ensureAppServer();

  const result = await sendRuntimeRequest(runtime, "thread/list", buildThreadListParams(params));
  const data = Array.isArray(result?.data)
    ? result.data
      .map((thread) => normalizeThreadRecord(thread))
      .filter((thread) => thread !== null)
    : [];

  const nextCursor =
    typeof result?.nextCursor === "string" && result.nextCursor.trim().length > 0
      ? result.nextCursor
      : null;

  return {
    data,
    nextCursor,
  };
}

async function handleThreadRead(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);
  const includeTurns = params.includeTurns === undefined ? true : Boolean(params.includeTurns);

  const result = await sendRuntimeRequest(runtime, "thread/read", {
    threadId: threadRef.codexThreadId,
    includeTurns,
  });

  const thread = normalizeThreadRecord(result?.thread, {
    preferredThreadId: threadRef.threadId,
    includeTurns,
  });
  if (!thread) {
    throw new Error("thread/read returned an invalid thread");
  }

  if (threadRef.threadState) {
    threadRef.threadState.codexThreadId = thread.codexThreadId;
    if (thread.cwd) {
      threadRef.threadState.workspace = thread.cwd;
    }
  }

  return { thread };
}

async function handleThreadArchive(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);

  await sendRuntimeRequest(runtime, "thread/archive", {
    threadId: threadRef.codexThreadId,
  });

  return {
    id: threadRef.threadId,
    codexThreadId: threadRef.codexThreadId,
    archived: true,
  };
}

async function handleThreadUnarchive(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);

  const result = await sendRuntimeRequest(runtime, "thread/unarchive", {
    threadId: threadRef.codexThreadId,
  });

  const thread = normalizeThreadRecord(result?.thread, {
    preferredThreadId: threadRef.threadId,
    includeTurns: Array.isArray(result?.thread?.turns),
  });
  if (!thread) {
    throw new Error("thread/unarchive returned an invalid thread");
  }

  if (threadRef.threadState) {
    threadRef.threadState.codexThreadId = thread.codexThreadId;
    if (thread.cwd) {
      threadRef.threadState.workspace = thread.cwd;
    }
  }

  return { thread };
}

async function handleThreadCompactStart(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);

  await sendRuntimeRequest(runtime, "thread/compact/start", {
    threadId: threadRef.codexThreadId,
  });

  return {
    ok: true,
    threadId: threadRef.threadId,
    codexThreadId: threadRef.codexThreadId,
  };
}

async function handleThreadRollback(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);

  const numTurns = asFiniteNumber(params.numTurns ?? params.num_turns);
  if (numTurns == null || numTurns < 1) {
    throw new Error("numTurns must be a number greater than or equal to 1");
  }

  const result = await sendRuntimeRequest(runtime, "thread/rollback", {
    threadId: threadRef.codexThreadId,
    numTurns: Math.trunc(numTurns),
  });

  const thread = normalizeThreadRecord(result?.thread, {
    preferredThreadId: threadRef.threadId,
    includeTurns: true,
  });
  if (!thread) {
    throw new Error("thread/rollback returned an invalid thread");
  }

  if (threadRef.threadState) {
    threadRef.threadState.codexThreadId = thread.codexThreadId;
    if (thread.cwd) {
      threadRef.threadState.workspace = thread.cwd;
    }
  }

  return { thread };
}

function buildThreadForkParams(params = {}, codexThreadId) {
  const requestParams = {
    threadId: codexThreadId,
  };

  if (typeof params.path === "string" && params.path.trim().length > 0) {
    requestParams.path = params.path.trim();
  }

  if (typeof params.model === "string" && params.model.trim().length > 0) {
    requestParams.model = params.model.trim();
  }

  if (typeof params.modelProvider === "string" && params.modelProvider.trim().length > 0) {
    requestParams.modelProvider = params.modelProvider.trim();
  }

  const cwd =
    typeof params.cwd === "string" && params.cwd.trim().length > 0
      ? params.cwd.trim()
      : typeof params.workspace === "string" && params.workspace.trim().length > 0
        ? params.workspace.trim()
        : "";
  if (cwd) {
    requestParams.cwd = cwd;
  }

  if (typeof params.approvalPolicy === "string" && params.approvalPolicy.trim().length > 0) {
    requestParams.approvalPolicy = params.approvalPolicy.trim();
  }

  if (typeof params.sandbox === "string" && params.sandbox.trim().length > 0) {
    requestParams.sandbox = params.sandbox.trim();
  }

  if (isPlainJsonObject(params.config)) {
    requestParams.config = params.config;
  }

  if (typeof params.baseInstructions === "string" && params.baseInstructions.length > 0) {
    requestParams.baseInstructions = params.baseInstructions;
  }

  if (typeof params.developerInstructions === "string" && params.developerInstructions.length > 0) {
    requestParams.developerInstructions = params.developerInstructions;
  }

  if (typeof params.persistExtendedHistory === "boolean") {
    requestParams.persistExtendedHistory = params.persistExtendedHistory;
  }

  return requestParams;
}

async function handleThreadFork(params = {}) {
  const runtime = await ensureAppServer();
  const sourceThread = resolveThreadRef(params.threadId, params.workspace, true);

  const result = await sendRuntimeRequest(
    runtime,
    "thread/fork",
    buildThreadForkParams(params, sourceThread.codexThreadId),
  );

  const thread = normalizeThreadRecord(result?.thread, {
    modelProvider:
      typeof result?.modelProvider === "string" ? result.modelProvider : undefined,
    cwd: typeof result?.cwd === "string" ? result.cwd : undefined,
    includeTurns: true,
  });
  if (!thread) {
    throw new Error("thread/fork returned an invalid thread");
  }

  const requestedThreadId = normalizeThreadIdCandidate(
    params.newThreadId ?? params.forkedThreadId ?? params.targetThreadId,
  );
  const localThreadId = requestedThreadId || thread.codexThreadId;

  const threadState = {
    threadId: localThreadId,
    codexThreadId: thread.codexThreadId,
    workspace: thread.cwd || sourceThread.workspace,
  };
  state.threads.set(localThreadId, threadState);

  return {
    thread: {
      ...thread,
      id: localThreadId,
    },
  };
}

async function handleTurnSteer(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);

  const expectedTurnId = normalizeThreadIdCandidate(
    params.expectedTurnId ?? params.expected_turn_id ?? params.turnId,
  );
  if (!expectedTurnId) {
    throw new Error("expectedTurnId is required");
  }

  const inputItems = Array.isArray(params.inputItems)
    ? params.inputItems
    : Array.isArray(params.input)
      ? params.input
      : Array.isArray(params.input_items)
        ? params.input_items
        : [];

  const result = await sendRuntimeRequest(runtime, "turn/steer", {
    threadId: threadRef.codexThreadId,
    input: normalizeInputItems(inputItems),
    expectedTurnId,
  });

  const turnId = normalizeThreadIdCandidate(result?.turnId) || expectedTurnId;
  ensureTurnTracker(runtime, turnId);

  return {
    threadId: threadRef.threadId,
    codexThreadId: threadRef.codexThreadId,
    turnId,
  };
}

async function handleTurnInterrupt(params = {}) {
  const runtime = await ensureAppServer();
  const threadRef = resolveThreadRef(params.threadId, params.workspace, true);

  const turnId = normalizeThreadIdCandidate(params.turnId ?? params.turn_id);
  if (!turnId) {
    throw new Error("turnId is required");
  }

  await sendRuntimeRequest(runtime, "turn/interrupt", {
    threadId: threadRef.codexThreadId,
    turnId,
  });

  return {
    ok: true,
    threadId: threadRef.threadId,
    codexThreadId: threadRef.codexThreadId,
    turnId,
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

async function handleApprovalRespond(params = {}) {
  const runtime = state.appServer;
  if (!runtime || runtime.closed) {
    throw new Error("app-server is not running");
  }

  const requestParams = asPlainObject(params) ? params : {};
  return resolveApprovalResponse(runtime, requestParams);
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
    case "thread.list":
      return handleThreadList(params);
    case "thread.read":
      return handleThreadRead(params);
    case "thread.archive":
      return handleThreadArchive(params);
    case "thread.unarchive":
      return handleThreadUnarchive(params);
    case "thread.compact.start":
      return handleThreadCompactStart(params);
    case "thread.rollback":
      return handleThreadRollback(params);
    case "thread.fork":
      return handleThreadFork(params);
    case "turn.run":
      return handleTurnRun(params);
    case "turn.steer":
      return handleTurnSteer(params);
    case "turn.interrupt":
      return handleTurnInterrupt(params);
    case "approval.respond":
      return handleApprovalRespond(params);
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
    void handleLine(line).catch((error) => {
      writeEvent({
        type: "error",
        message:
          error instanceof Error ? error.stack || error.message : String(error),
      });
    });
  }
}

main().catch((error) => {
  writeEvent({
    type: "error",
    message: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.exit(1);
});










