import type {
  RuntimeMethod,
  RuntimeMethodCapabilities,
} from "@/lib/tauri-bridge/types"

// ========================
// Alicia shared types
// ========================

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"

export type ApprovalPreset = "read-only" | "auto" | "full-access"

export interface ApprovalConfig {
  preset: ApprovalPreset
  approvalPolicy: "on-request" | "never"
  sandboxMode: SandboxMode
}

export const APPROVAL_PRESETS: Record<ApprovalPreset, { label: string; description: string; approvalPolicy: "on-request" | "never"; sandboxMode: SandboxMode }> = {
  "read-only": {
    label: "Read Only",
    description: "Agent can only read files. All writes require explicit approval.",
    approvalPolicy: "on-request",
    sandboxMode: "read-only",
  },
  "auto": {
    label: "Auto",
    description: "Agent can read/write within workspace. External actions need approval.",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  },
  "full-access": {
    label: "Full",
    description: "Agent has unrestricted access. No approval prompts. Use with caution.",
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  },
}

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

export interface McpServer {
  id: string
  name: string
  transport: "stdio" | "sse" | "streamable-http"
  status: "connected" | "disconnected" | "error" | "connecting"
  statusReason?: string | null
  authStatus?: "unsupported" | "not_logged_in" | "bearer_token" | "oauth"
  tools: string[]
  url?: string
}

export type AccountAuthMode =
  | "none"
  | "api_key"
  | "chatgpt"
  | "chatgpt_auth_tokens"
  | "unknown"

export interface ConnectedApp {
  id: string
  name: string
  description?: string | null
  logoUrl?: string | null
  logoUrlDark?: string | null
  distributionChannel?: string | null
  installUrl?: string | null
  isAccessible: boolean
  isEnabled: boolean
}

export interface AccountProfile {
  type: Exclude<AccountAuthMode, "none">
  email?: string | null
  planType?: string | null
}

export interface AccountRateLimitWindow {
  usedPercent: number
  windowDurationMins?: number | null
  resetsAt?: number | null
}

export interface AccountCreditsSnapshot {
  hasCredits: boolean
  unlimited: boolean
  balance?: string | null
}

export interface AccountRateLimitSnapshot {
  limitId?: string | null
  limitName?: string | null
  primary?: AccountRateLimitWindow | null
  secondary?: AccountRateLimitWindow | null
  credits?: AccountCreditsSnapshot | null
  planType?: string | null
}

export interface AccountState {
  authMode: AccountAuthMode
  requiresOpenaiAuth: boolean
  account: AccountProfile | null
}

export const DEFAULT_MCP_SERVERS: McpServer[] = [
  { id: "filesystem", name: "Filesystem", transport: "stdio", status: "connected", tools: ["read_file", "write_file", "list_dir", "search_files", "get_file_info", "create_dir", "move_file", "read_multiple", "edit_file", "directory_tree", "grep", "glob", "head", "tail"] },
  { id: "git", name: "Git", transport: "stdio", status: "connected", tools: ["status", "diff", "log", "commit", "branch", "checkout", "stash", "blame"] },
  { id: "shell", name: "Shell", transport: "stdio", status: "connected", tools: ["execute", "background", "kill"] },
  { id: "browser", name: "Browser", transport: "sse", status: "connected", tools: ["navigate", "screenshot", "click", "type", "evaluate", "scroll"] },
  { id: "database", name: "Database", transport: "stdio", status: "connected", tools: ["query", "schema", "tables", "describe", "migrate"] },
  { id: "search", name: "Search", transport: "sse", status: "connected", tools: ["web_search", "code_search", "docs_search", "semantic_search"] },
]

export interface Session {
  id: string
  threadId?: string
  name: string
  time: string
  active: boolean
  messageCount: number
  model: string
  createdAt?: number | null
  updatedAt?: number | null
  sourceKind?: string | null
  cwd?: string
}

export const DEFAULT_SESSIONS: Session[] = [
  { id: "s1", name: "Refactor auth module", time: "2m ago", active: true, messageCount: 12, model: "gpt-4o" },
  { id: "s2", name: "Fix database migration", time: "15m ago", active: false, messageCount: 8, model: "gpt-4o-mini" },
  { id: "s3", name: "Add API endpoints", time: "1h ago", active: false, messageCount: 23, model: "o3-mini" },
  { id: "s4", name: "Update test suite", time: "3h ago", active: false, messageCount: 5, model: "gpt-4o" },
  { id: "s5", name: "Implement caching layer", time: "yesterday", active: false, messageCount: 31, model: "claude-sonnet-4-20250514" },
]

export interface SlashCommand {
  command: string
  label: string
  description: string
  category: "model" | "session" | "config" | "agent" | "debug" | "system"
  support: "supported" | "planned"
}

export const SUPPORTED_SLASH_COMMANDS: SlashCommand[] = [
  { command: "/model", label: "Model", description: "Change model and reasoning effort", category: "model", support: "supported" },
  { command: "/models", label: "Models", description: "Open available models from Codex runtime", category: "model", support: "supported" },
  { command: "/approvals", label: "Approvals", description: "Configure approval policy", category: "config", support: "supported" },
  { command: "/permissions", label: "Permissions", description: "Set permission preset", category: "config", support: "supported" },
  { command: "/new", label: "New Session", description: "Start a new session", category: "session", support: "supported" },
  { command: "/resume", label: "Resume", description: "Resume a previous session", category: "session", support: "supported" },
  { command: "/fork", label: "Fork", description: "Fork current or previous session", category: "session", support: "supported" },
  { command: "/agent", label: "Agent", description: "Switch agent mode", category: "agent", support: "supported" },
  { command: "/review", label: "Review", description: "Request code review", category: "agent", support: "supported" },
  { command: "/diff", label: "Diff", description: "Show current changes diff", category: "agent", support: "supported" },
  { command: "/mcp", label: "MCP", description: "View MCP server status and tools", category: "debug", support: "supported" },
  { command: "/apps", label: "Apps", description: "Manage connected apps", category: "debug", support: "supported" },
  { command: "/status", label: "Status", description: "Show system status", category: "debug", support: "supported" },
  { command: "/logout", label: "Logout", description: "Log out of current session", category: "system", support: "supported" },
  { command: "/quit", label: "Quit", description: "Exit Alicia", category: "system", support: "supported" },
  { command: "/exit", label: "Exit", description: "Exit Alicia", category: "system", support: "supported" },
]

export const PLANNED_SLASH_COMMANDS: SlashCommand[] = [
  { command: "/sandbox-add-read-dir", label: "Sandbox Add Dir", description: "Add readable directory to sandbox", category: "config", support: "planned" },
  { command: "/personality", label: "Personality", description: "Set agent personality", category: "config", support: "planned" },
  { command: "/experimental", label: "Experimental", description: "Toggle experimental features", category: "config", support: "planned" },
  { command: "/statusline", label: "Status Line", description: "Configure status line display", category: "config", support: "planned" },
  { command: "/rename", label: "Rename", description: "Rename current session", category: "session", support: "planned" },
  { command: "/compact", label: "Compact", description: "Compact conversation history", category: "session", support: "planned" },
  { command: "/plan", label: "Plan", description: "Ask agent to create a plan", category: "agent", support: "planned" },
  { command: "/collab", label: "Collab", description: "Collaborative mode with agent", category: "agent", support: "planned" },
  { command: "/mention", label: "Mention", description: "Mention a file or symbol", category: "agent", support: "planned" },
  { command: "/skills", label: "Skills", description: "List available skills", category: "agent", support: "planned" },
  { command: "/init", label: "Init", description: "Initialize project context", category: "agent", support: "planned" },
  { command: "/debug-config", label: "Debug Config", description: "Show current configuration", category: "debug", support: "planned" },
  { command: "/ps", label: "Processes", description: "Show running background tasks", category: "debug", support: "planned" },
  { command: "/clean", label: "Clean", description: "Clean session data", category: "system", support: "planned" },
  { command: "/feedback", label: "Feedback", description: "Send feedback", category: "system", support: "planned" },
]

export const SLASH_COMMANDS: SlashCommand[] = [
  ...SUPPORTED_SLASH_COMMANDS,
  ...PLANNED_SLASH_COMMANDS,
]

export type SlashCommandSupportState = SlashCommand["support"] | "unsupported"

const SLASH_COMMAND_METHOD_REQUIREMENTS: Partial<Record<string, RuntimeMethod[]>> = {
  "/review": ["review.start"],
}

export function getSlashCommandDefinition(command: string): SlashCommand | null {
  const normalized = command.trim().toLowerCase()
  if (!normalized.startsWith("/")) {
    return null
  }
  return (
    SLASH_COMMANDS.find((entry) => entry.command.toLowerCase() === normalized) ??
    null
  )
}

export function resolveSlashCommandSupport(
  command: SlashCommand,
  capabilities: RuntimeMethodCapabilities,
): SlashCommandSupportState {
  if (command.support === "planned") {
    return "planned"
  }

  const requiredMethods =
    SLASH_COMMAND_METHOD_REQUIREMENTS[command.command.toLowerCase()]
  if (!requiredMethods || requiredMethods.length === 0) {
    return "supported"
  }

  return requiredMethods.every((method) => capabilities[method] !== false)
    ? "supported"
    : "unsupported"
}

export interface FileChange {
  name: string
  status:
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "unmerged"
  fromPath?: string
}

export interface AliciaState {
  model: string
  reasoningEffort: ReasoningEffort
  approvalPreset: ApprovalPreset
  sandboxMode: SandboxMode
  runtimeCapabilities: RuntimeMethodCapabilities
  mcpServers: McpServer[]
  apps: ConnectedApp[]
  account: AccountState
  rateLimits: AccountRateLimitSnapshot | null
  rateLimitsByLimitId: Record<string, AccountRateLimitSnapshot>
  sessions: Session[]
  fileChanges: FileChange[]
  activePanel:
    | "model"
    | "permissions"
    | "mcp"
    | "sessions"
    | "apps"
    | "review"
    | null
}

