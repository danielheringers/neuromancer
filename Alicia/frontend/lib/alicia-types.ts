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
  tools: string[]
  url?: string
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
  name: string
  time: string
  active: boolean
  messageCount: number
  model: string
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
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Model & Config
  { command: "/model", label: "Model", description: "Change model and reasoning effort", category: "model" },
  { command: "/models", label: "Models", description: "Open available models from Codex runtime", category: "model" },
  { command: "/approvals", label: "Approvals", description: "Configure approval policy", category: "config" },
  { command: "/permissions", label: "Permissions", description: "Set permission preset", category: "config" },
  { command: "/sandbox-add-read-dir", label: "Sandbox Add Dir", description: "Add readable directory to sandbox", category: "config" },
  { command: "/personality", label: "Personality", description: "Set agent personality", category: "config" },
  { command: "/experimental", label: "Experimental", description: "Toggle experimental features", category: "config" },
  { command: "/statusline", label: "Status Line", description: "Configure status line display", category: "config" },

  // Session
  { command: "/new", label: "New Session", description: "Start a new session", category: "session" },
  { command: "/resume", label: "Resume", description: "Resume a previous session", category: "session" },
  { command: "/fork", label: "Fork", description: "Fork current or previous session", category: "session" },
  { command: "/rename", label: "Rename", description: "Rename current session", category: "session" },
  { command: "/compact", label: "Compact", description: "Compact conversation history", category: "session" },

  // Agent actions
  { command: "/plan", label: "Plan", description: "Ask agent to create a plan", category: "agent" },
  { command: "/collab", label: "Collab", description: "Collaborative mode with agent", category: "agent" },
  { command: "/agent", label: "Agent", description: "Switch agent mode", category: "agent" },
  { command: "/diff", label: "Diff", description: "Show current changes diff", category: "agent" },
  { command: "/review", label: "Review", description: "Request code review", category: "agent" },
  { command: "/mention", label: "Mention", description: "Mention a file or symbol", category: "agent" },
  { command: "/skills", label: "Skills", description: "List available skills", category: "agent" },
  { command: "/init", label: "Init", description: "Initialize project context", category: "agent" },

  // Debug & System
  { command: "/mcp", label: "MCP", description: "View MCP server status and tools", category: "debug" },
  { command: "/status", label: "Status", description: "Show system status", category: "debug" },
  { command: "/debug-config", label: "Debug Config", description: "Show current configuration", category: "debug" },
  { command: "/ps", label: "Processes", description: "Show running background tasks", category: "debug" },
  { command: "/apps", label: "Apps", description: "Manage connected apps", category: "debug" },
  { command: "/clean", label: "Clean", description: "Clean session data", category: "system" },
  { command: "/feedback", label: "Feedback", description: "Send feedback", category: "system" },
  { command: "/logout", label: "Logout", description: "Log out of current session", category: "system" },
  { command: "/quit", label: "Quit", description: "Exit Alicia", category: "system" },
  { command: "/exit", label: "Exit", description: "Exit Alicia", category: "system" },
]

export interface FileChange {
  name: string
  status: "modified" | "added" | "deleted"
}

export interface AliciaState {
  model: string
  reasoningEffort: ReasoningEffort
  approvalPreset: ApprovalPreset
  sandboxMode: SandboxMode
  mcpServers: McpServer[]
  sessions: Session[]
  fileChanges: FileChange[]
  activePanel: "model" | "permissions" | "mcp" | "sessions" | null
}
