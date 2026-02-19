# AlicIA - Matriz de UI, comandos e configurações do Codex CLI

## Matriz pronta para UI (`componente -> ação -> backend/config`)

1. `Model Select`  
`/model` -> abre picker de modelo e depois picker de reasoning.  
Config: `model`, `model_reasoning_effort`.  
Valores de effort: `none|minimal|low|medium|high|xhigh` (filtrado por modelo).

2. `Reasoning Select`  
Sem slash separado (etapa 2 do `/model`).  
Config: `model_reasoning_effort`.  
Comportamento: persiste seleção + atualiza sessão.

3. `Approvals/Permissions Select`  
`/approvals` e `/permissions` (mesma tela).  
Config efetiva: `approval_policy` + `sandbox_mode` (e derivados).  
Presets atuais:
- `read-only` -> `approval=on-request`, `sandbox=read-only`
- `auto` (Default) -> `approval=on-request`, `sandbox=workspace-write`
- `full-access` -> `approval=never`, `sandbox=danger-full-access`

4. `Sandbox Select`  
Hoje não existe slash `/sandbox` na TUI.  
Use `/permissions` (preset) ou CLI `--sandbox`.  
Valores: `read-only|workspace-write|danger-full-access`.

5. `MCP Panel`  
`/mcp` mostra estado/ferramentas MCP.  
Gestão completa via CLI: `codex mcp list|get|add|remove|login|logout`.

6. `Resume/Fork Session`  
`/resume`, `/fork` (picker na TUI).  
CLI: `codex resume [--last|--all]`, `codex fork [--last|--all]`.

7. `Prompt + imagem + menções`  
Entrada estruturada suportada nativamente (não precisa hack de texto):  
`Text`, `LocalImage`, `Image`, `Skill`, `Mention`.  
Imagem local vira `input_image` no payload automaticamente.

## Árvore completa de comandos CLI atuais

```text
codex
  exec (alias: e)
    resume
    review
  review
  login
    status
  logout
  mcp
    list
    get
    add
    remove
    login
    logout
  mcp-server
  app-server
    generate-ts
    generate-json-schema
  completion
  sandbox
    macos
    linux
    windows
  debug
    app-server
      send-message-v2
  apply (alias: a)
  resume
  fork
  cloud
    exec
    status
    list
    apply
    diff
  features
    list
    enable
    disable
```

## Slash commands atuais da TUI

```text
/model
/approvals
/permissions
/setup-default-sandbox
/sandbox-add-read-dir
/experimental
/skills
/review
/rename
/new
/resume
/fork
/init
/compact
/plan
/collab
/agent
/diff
/mention
/status
/debug-config
/statusline
/mcp
/apps
/logout
/quit
/exit
/feedback
/ps
/clean
/personality
/debug-m-drop
/debug-m-update
```

Notas:
- `/rollout` e `/test-approval` aparecem em build de debug.
- Alguns comandos ficam indisponíveis durante tarefa em execução.

## Flags principais para virar controles visuais na UI

```text
--model
--image
--profile
--sandbox
--ask-for-approval
--full-auto
--dangerously-bypass-approvals-and-sandbox
--search
--add-dir
--cd
-c key=value
--enable FEATURE
--disable FEATURE
```

## Configurações top-level disponíveis hoje (`config.toml`)

```text
agents
analytics
approval_policy
apps
chatgpt_base_url
check_for_update_on_startup
cli_auth_credentials_store
compact_prompt
developer_instructions
disable_paste_burst
experimental_compact_prompt_file
experimental_use_freeform_apply_patch
experimental_use_unified_exec_tool
features
feedback
file_opener
forced_chatgpt_workspace_id
forced_login_method
ghost_snapshot
hide_agent_reasoning
history
instructions
js_repl_node_path
log_dir
mcp_oauth_callback_port
mcp_oauth_credentials_store
mcp_servers
model
model_auto_compact_token_limit
model_context_window
model_instructions_file
model_provider
model_providers
model_reasoning_effort
model_reasoning_summary
model_supports_reasoning_summaries
model_verbosity
notice
notify
oss_provider
otel
personality
profile
profiles
project_doc_fallback_filenames
project_doc_max_bytes
project_root_markers
projects
review_model
sandbox_mode
sandbox_workspace_write
shell_environment_policy
show_raw_agent_reasoning
skills
suppress_unstable_features_warning
tool_output_token_limit
tools
tui
web_search
windows
windows_wsl_setup_acknowledged
```
