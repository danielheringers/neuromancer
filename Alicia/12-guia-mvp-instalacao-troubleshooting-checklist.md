# AlicIA - Guia MVP (Instalacao, Troubleshooting e Pre-Release)

Data de referencia: 2026-02-17

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
- [ ] Notas de release/changelog preenchidas.
- [x] Evidencias de CI anexadas (links dos jobs por SO).

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

## 5) Evidencias recomendadas para aprovacao de release
1. URL do workflow `alicia-ci` com os 3 jobs (`suite_minima`, `policy_approval_scenarios`, `e2e_flow`) verdes.
2. Hash/tag candidata de release.
3. Registro do smoke manual (um caso feliz + um caso negado/expirado).
4. Exemplo de linha de auditoria validada no artefato JSONL.
