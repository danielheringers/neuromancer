# AlicIA - Guia MVP (Instalacao, Troubleshooting e Pre-Release)

Data de referencia: 2026-02-18

## Escopo
Este guia operacional cobre o item `ALICIA-MVP-020`:
1. Instalacao para Windows, macOS e Linux.
2. Troubleshooting dos erros mais comuns.
3. Checklist de pre-release MVP.

## Pre-requisitos comuns
1. Git instalado.
2. Rust via `rustup` instalado e funcional.
3. Acesso ao repositorio `neuromancer`.
4. Estar no branch de trabalho (`neuromancer` ou feature branch baseado nele).

## 1) Instalacao e bootstrap

### Windows 11 (PowerShell)
1. Instalar o Visual Studio Build Tools com workload `Desktop development with C++`.
2. Instalar Git.
3. Instalar Rust:
```powershell
winget install Rustlang.Rustup
rustup toolchain install stable
rustup default stable
```
4. Clonar e entrar no projeto:
```powershell
git clone https://github.com/danielheringers/neuromancer.git
cd neuromancer\codex-rs
```
5. Validar toolchain:
```powershell
cargo --version
rustc --version
```

### macOS 14/15 (zsh)
1. Instalar Xcode Command Line Tools:
```bash
xcode-select --install
```
2. Instalar Homebrew (se necessario) e Git:
```bash
brew install git
```
3. Instalar Rust:
```bash
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"
rustup toolchain install stable
rustup default stable
```
4. Clonar e entrar no projeto:
```bash
git clone https://github.com/danielheringers/neuromancer.git
cd neuromancer/codex-rs
```

### Linux (Ubuntu 24.04)
1. Instalar dependencias basicas:
```bash
sudo apt-get update
sudo apt-get install -y git build-essential pkg-config libcap-dev
```
2. Instalar Rust:
```bash
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"
rustup toolchain install stable
rustup default stable
```
3. Clonar e entrar no projeto:
```bash
git clone https://github.com/danielheringers/neuromancer.git
cd neuromancer/codex-rs
```

## 2) Validacao local minima (MVP)

### Suite minima AlicIA (equivalente ao job `suite_minima`)
```bash
cargo test -p codex-alicia-core
cargo test -p codex-alicia-adapters
cargo test -p codex-alicia-ui
```

### Cenarios policy/aprovacao (equivalente ao job `policy_approval_scenarios`)
```bash
cargo test -p codex-alicia-core read_write_with_approval_profile_matches_contract -- --exact
cargo test -p codex-alicia-ui approval_prompt_contains_context_and_decision_updates_state -- --exact
cargo test -p codex-alicia-ui expire_pending_approvals_marks_final_state -- --exact
```

### E2E fluxo principal (equivalente ao job `e2e_flow`)
```bash
cargo test -p codex-alicia-ui e2e_happy_path_approval_execution_and_audit -- --exact
cargo test -p codex-alicia-ui e2e_denied_and_expired_blocked_audit -- --exact
cargo test -p codex-alicia-ui e2e_safe_cancel_persists_final_audit_state -- --exact
```

### UI desktop local (janela egui real)
Abrir somente a janela:
```bash
cargo run -p codex-alicia-ui --features desktop --bin codex-alicia-ui-desktop
```

Abrir a janela e iniciar uma sessao automaticamente:
```bash
cargo run -p codex-alicia-ui --features desktop --bin codex-alicia-ui-desktop -- --session-id demo-ui -- cmd /C echo ALICIA_UI_OK
```

### Smoke manual do launcher local (`codex-alicia-ui-app`)
Windows:
```powershell
cargo run -p codex-alicia-ui --bin codex-alicia-ui-app -- --session-id demo-local -- cmd /C echo ALICIA_OK
```

macOS/Linux:
```bash
cargo run -p codex-alicia-ui --bin codex-alicia-ui-app -- --session-id demo-local -- /bin/sh -c "echo ALICIA_OK"
```

Com auditoria JSONL:
```bash
cargo run -p codex-alicia-ui --bin codex-alicia-ui-app -- --session-id demo-audit --audit-path ./.codex/alicia-audit.jsonl -- /bin/sh -c "echo ALICIA_AUDIT_OK"
```

## 3) Troubleshooting

### Erro: `cargo`/`rustc` nao encontrado
1. Verificar instalacao do rustup.
2. Reabrir o terminal para recarregar PATH.
3. No macOS/Linux, executar:
```bash
source "$HOME/.cargo/env"
```

### Erro no Windows com `just`: `could not find the shell`
1. O `justfile` principal usa redirecionamento estilo bash.
2. Em Windows puro, executar os comandos `cargo` equivalentes diretamente:
```powershell
cargo fmt -- --config imports_granularity=Item
cargo clippy --fix --all-features --tests --allow-dirty -p codex-alicia-ui
```

### Erro: PTY indisponivel
1. Em ambientes sem PTY, usar modo pipe (`SessionMode::Pipe`) para os testes.
2. Validar fallback com os testes de `SessionManager` em `codex-alicia-core`.

### Erro: provider com versao nao suportada
1. Validar binario com `--version`.
2. Conferir mensagem `UnsupportedProviderVersion` nos adapters.
3. Atualizar `codex-cli`/`claude-code` para versao minima esperada.

### Validacao real do provider `claude-code` (host alvo de release)
1. Confirmar que o binario esta acessivel:
```powershell
claude --version
```
2. Executar o smoke real do adapter (teste habilitado por env var):
```powershell
cd codex-rs
$env:ALICIA_REAL_PROVIDER_CLAUDE_CODE='1'
cargo test -p codex-alicia-adapters real_provider_claude_code_smoke -- --exact --nocapture
```
```bash
cd codex-rs
ALICIA_REAL_PROVIDER_CLAUDE_CODE=1 cargo test -p codex-alicia-adapters real_provider_claude_code_smoke -- --exact --nocapture
```
3. Observacoes operacionais:
   - o smoke autodetecta `claude` ou `claude-code` quando `ALICIA_CLAUDE_CODE_BIN` nao estiver definido;
   - usar `ALICIA_CLAUDE_CODE_BIN` apenas para forcar um binario especifico.
4. Resultado esperado:
   - `test real_provider_claude_code_smoke ... ok`
   - sem `ProviderCommandFailed` no output do teste.
5. Registrar a evidencia no pacote de PR (`Alicia/13-pr-mvp-018-020.md`) e marcar o item pendente do checklist como concluido.

### Erro: aprovacao expira antes da decisao
1. Conferir `expires_at_unix_s` no evento `approval_requested`.
2. Confirmar que o clock local da maquina esta correto.
3. Reproduzir com teste:
```bash
cargo test -p codex-alicia-ui expire_pending_approvals_marks_final_state -- --exact
```

### Erro: acao bloqueada fora do workspace
1. Esse bloqueio e esperado no MVP.
2. Validar com testes de `workspace_guard` no `codex-alicia-core`.
3. Ajustar target para path dentro do workspace da tarefa.

## 4) Checklist pre-release MVP (Go/No-Go)

## Qualidade e regressao
- [x] `suite_minima` verde em Windows, macOS e Linux.
- [x] `policy_approval_scenarios` verde em Windows, macOS e Linux.
- [x] `e2e_flow` verde em Windows, macOS e Linux.
- [x] Sem regressao funcional nos crates `codex-alicia-core`, `codex-alicia-adapters`, `codex-alicia-ui`.

## Seguranca
- [x] Fluxo de aprovacao cobre `approved`, `denied` e `expired`.
- [x] Bloqueio fora do workspace validado por teste.
- [x] Auditoria JSONL inclui `policy_decision`, `approval_decision` e `result_status`.
- [x] Sem segredo em logs de auditoria (redaction ativa).

## Runtime e UX minima
- [x] Terminal integrado recebe output em tempo real sem congelar.
- [x] Input do usuario chega na sessao ativa correta.
- [x] Timeline atualiza em ordem de eventos.
- [x] Diff preview por arquivo visivel antes de aplicar.

## Release e documentacao
- [x] `Alicia/07-plano-release-oss.md` revisado.
- [x] Este guia revisado e atualizado para a versao candidata.
- [x] Notas de release/changelog preenchidas: `Alicia/15-notas-release-candidata-mvp-018-020.md`.
- [x] Evidencias de CI anexadas (links dos jobs por SO).
- [x] Delta local atual publicado em PR e validado novamente no `alicia-ci` (3 SO): `https://github.com/danielheringers/neuromancer/pull/13`.

## Estado de validacao (2026-02-18)
1. Run `alicia-ci` com 9/9 jobs verdes:
- `https://github.com/danielheringers/neuromancer/actions/runs/22135313223`
2. Regressao local complementar apos sync:
- `cargo test -p codex-alicia-core -p codex-alicia-adapters -p codex-alicia-ui`
3. Smoke complementar com auditoria JSONL:
- comando:
```powershell
cargo run -p codex-alicia-ui --bin codex-alicia-ui-app -- --session-id smoke-20260218-sync --audit-path ./.codex/alicia-smoke-audit-sync.jsonl -- cmd /C echo ALICIA_AUDIT_SYNC_OK
```
- artefato: `codex-rs/.codex/alicia-smoke-audit-sync.jsonl`
4. Revalidacao CI no contexto do PR atual:
- PR: `https://github.com/danielheringers/neuromancer/pull/13`
- run (`pull_request`, run_number `16`): `https://github.com/danielheringers/neuromancer/actions/runs/22139722352` (success 9/9)
- run (`pull_request`, run_number `19`): `https://github.com/danielheringers/neuromancer/actions/runs/22140345314` (success 9/9, apos fix de intermitencia no `codex-alicia-core`)
- run (`pull_request`, run_number `32`): `https://github.com/danielheringers/neuromancer/actions/runs/22144213751` (success 9/9, commit `3c38be3de` apos hardening do smoke real de provider)
- resultado: `success` (9/9 jobs verdes)
- jobs:
  - `Alicia Policy and Approval Scenarios - windows-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562577`
  - `Alicia E2E Flow - macos-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562897`
  - `Alicia E2E Flow - windows-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562919`
  - `Alicia Policy and Approval Scenarios - ubuntu-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562619`
  - `Alicia Suite Minima - ubuntu-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562707`
  - `Alicia E2E Flow - ubuntu-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562665`
  - `Alicia Suite Minima - macos-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016563040`
  - `Alicia Policy and Approval Scenarios - macos-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016562711`
  - `Alicia Suite Minima - windows-latest`: `https://github.com/danielheringers/neuromancer/actions/runs/22144213751/job/64016563004`
5. Validacao real do provider `claude-code` no host atual:
- `claude --version` -> `2.1.45 (Claude Code)`
- `cargo test -p codex-alicia-adapters real_provider_claude_code_smoke -- --exact --nocapture` com `ALICIA_REAL_PROVIDER_CLAUDE_CODE=1` (autodetect `claude`/`claude-code`) -> `ok`.

## 4.1) Consolidado para planejamento de continuidade (2026-02-18)

## Concluido (base MVP + P1 imediato)
- [x] `ALICIA-MVP-001` a `ALICIA-MVP-020` implementados e documentados no backlog.
- [x] `ALICIA-P1-021` a `ALICIA-P1-024` implementados (diff por hunk, policy por projeto, cancelamento seguro e mensagens para iniciantes).
- [x] Regressao local dos crates AlicIA executada:
  - `cargo test -p codex-alicia-core -p codex-alicia-adapters -p codex-alicia-ui`
- [x] Reforco de policy no runtime/UI validado localmente com:
  - `cargo test -p codex-alicia-ui`

## Pendente para fechar ciclo atual
- [x] Publicar o delta local atual (branch `neuromancer`) e rerodar o workflow `alicia-ci`.
- [x] Preencher notas de release/changelog para a candidata de release.
- [x] Validar provider `claude-code` com binario real no host alvo de release (host atual usa binario `claude`; `claude --version` retornou `2.1.45 (Claude Code)` e `real_provider_claude_code_smoke` passou com `ALICIA_CLAUDE_CODE_BIN=claude` em 2026-02-18).


## 5) Evidencias recomendadas para aprovacao de release
1. URL do workflow `alicia-ci` com os 3 jobs (`suite_minima`, `policy_approval_scenarios`, `e2e_flow`) verdes.
2. Hash/tag candidata de release.
3. Registro do smoke manual (um caso feliz + um caso negado/expirado).
4. Exemplo de linha de auditoria validada no artefato JSONL.

