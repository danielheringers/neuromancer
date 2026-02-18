# AlicIA - Notas de Release Candidata (MVP-018/019/020)

Data de referencia: 2026-02-18

## Escopo desta candidata

Esta release candidata consolida os itens:

1. `ALICIA-MVP-018`: CI cross-platform (`alicia-ci`) com matriz Windows/macOS/Linux.
2. `ALICIA-MVP-019`: cobertura E2E do fluxo principal (caso feliz, negacao/expiracao e cancelamento seguro).
3. `ALICIA-MVP-020`: guia operacional de instalacao, troubleshooting e checklist pre-release.

## Principais mudancas

1. Endurecimento de policy/aprovacao no runtime de `codex-alicia-ui`:
   - bloqueio explicito quando aprovacao e exigida e ausente/negada/expirada;
   - emissao de auditoria para acoes bloqueadas.
2. Reforco de testes em `codex-alicia-ui` e `codex-alicia-core` para cenarios de aprovacao e fluxo de sessao.
3. Fluxo de trabalho formalizado com ExecPlan:
   - `AGENTS.md` atualizado para operacao por planos vivos;
   - `.agent/PLANS.md` criado como padrao;
   - `Alicia/14-fluxo-desenvolvimento-execplan.md` criado para operacao do time.
4. Correção de intermitencia no teste de pipe session:
   - `start_pipe_session_emits_started_output_and_finished_events` tornado resiliente a ordem de eventos concorrentes.

## Evidencias de validacao

1. PR em andamento:
   - `https://github.com/danielheringers/neuromancer/pull/13`
2. CI final da rodada atual (`pull_request`, run `32`) com 9/9 jobs verdes:
   - `https://github.com/danielheringers/neuromancer/actions/runs/22144213751`
3. Validacao local complementar:
   - `cargo test -p codex-alicia-core -p codex-alicia-adapters -p codex-alicia-ui`

## Compatibilidade e riscos conhecidos

1. Compatibilidade cross-platform validada nos 3 SO via CI.
2. Validacao real de provider concluida no host atual (2026-02-18):
   - `claude --version` -> `2.1.45 (Claude Code)`.
   - smoke `real_provider_claude_code_smoke` aprovado com `ALICIA_REAL_PROVIDER_CLAUDE_CODE=1` (autodetect de `claude`/`claude-code` ativo; override opcional por `ALICIA_CLAUDE_CODE_BIN`).

## Rollback

1. Em caso de regressao, reverter para o commit anterior ao pacote da candidata:
   - `git revert` dos commits da rodada, preservando historico.
2. Reexecutar `alicia-ci` apos rollback para confirmar retorno ao estado estavel.
