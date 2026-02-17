# AlicIA - Mapa de Reuso do Codex (2026-02-17)

## Objetivo
Registrar o inventario tecnico do que ja existe no `codex-rs` para reaproveitar no MVP do AlicIA, com os gaps que ainda exigem implementacao nova.

## Resumo executivo
1. O AlicIA deve seguir estrategia `reuse-first`: integrar componentes existentes antes de criar engines paralelas.
2. PTY/session lifecycle, sandbox/aprovacao e parte de auditoria ja existem no Codex e devem ser base do MVP.
3. Os principais gaps atuais sao:
   - adapter real para `codex-cli` e `claude-code`,
   - schema de auditoria MVP (campos de policy/approval/result) sobre JSONL ja existente,
   - redaction antes de persistencia no pipeline de auditoria,
   - renderizacao `egui` (sem reaproveitamento direto da camada visual `ratatui`).

## Inventario por item de backlog

### ALICIA-MVP-004 / 005 / 015 (PTY e lifecycle)
1. Reuso direto:
   - `codex-rs/utils/pty/src/pty.rs`
   - `codex-rs/utils/pty/src/process.rs`
   - `codex-rs/utils/pty/src/pipe.rs`
   - `codex-rs/core/src/unified_exec/process_manager.rs`
   - `codex-rs/core/src/unified_exec/process.rs`
2. Gap:
   - faltam wrappers do AlicIA (`start/stop/reattach`) sobre essas APIs e emissao no contrato IPC do `alicia-core`.
3. Risco:
   - fallback no Windows onde PTY completo pode nao estar disponivel (`ConPTY`/fallback para pipe).

### ALICIA-MVP-006 / 007 / 008 / 009 (policy, workspace guard, rede, approvals)
1. Reuso direto:
   - `codex-rs/protocol/src/protocol.rs` (`AskForApproval`, `SandboxPolicy`)
   - `codex-rs/core/src/tools/sandboxing.rs` (default approval requirement)
   - `codex-rs/core/src/tools/orchestrator.rs` (fluxo approval -> sandbox -> exec)
   - `codex-rs/network-proxy/src/network_policy.rs`
   - `codex-rs/core/src/config/mod.rs` (`Permissions`)
2. Gap:
   - mapear explicitamente os perfis do AlicIA (`read_only`, `read_write_with_approval`, `full_access`) para politicas efetivas do Codex.
   - camada AlicIA para fila de aprovacoes com timeout/estado `expired` usando o contrato IPC proprio.

### ALICIA-MVP-010 / 011 (auditoria JSONL e redaction)
1. Reuso direto:
   - `codex-rs/core/src/rollout/recorder.rs` (writer JSONL append-only)
   - `codex-rs/utils/sanitizer/src/lib.rs` (`redact_secrets`)
2. Gap:
   - log atual nao persiste todos os campos obrigatorios do MVP (`action_kind`, `profile`, `policy_decision`, etc.).
   - redaction nao esta conectada ao fluxo de escrita do `RolloutRecorder` antes de persistencia.

### ALICIA-MVP-012 / 013 / 014 (adapters/providers)
1. Reuso direto:
   - contrato inicial no `codex-rs/alicia-adapters/src/lib.rs` (`ProviderAdapter`, capabilities, `AdapterError`)
2. Gap:
   - nao existe adapter concreto para `codex-cli`.
   - nao existe adapter concreto para `claude-code`.
   - faltam testes de contrato por provider.

### ALICIA-MVP-016 / 017 (fila de aprovacoes UI, timeline e diff)
1. Reuso parcial (motor de dados):
   - `codex-rs/tui/src/bottom_pane/approval_overlay.rs`
   - `codex-rs/tui/src/diff_render.rs`
   - `codex-rs/tui/src/get_git_diff.rs`
   - `codex-rs/tui/src/history_cell.rs`
2. Gap:
   - a renderizacao do AlicIA e `egui`; nao ha camada visual `egui` implementada.
   - precisa adaptar esses motores para o modelo de estado do `alicia-ui`.

## Diretriz de implementacao
1. Evitar duplicar engines de PTY, sandbox e approvals.
2. Criar bridges no AlicIA para encapsular o Codex, mantendo contrato estavel no `alicia-core`.
3. Priorizar fechamento de gaps de seguranca (workspace guard, auditoria completa, redaction no write-path) antes de expandir UI.
