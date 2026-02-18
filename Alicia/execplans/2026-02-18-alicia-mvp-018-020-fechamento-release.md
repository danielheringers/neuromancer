# Fechamento de ciclo MVP-018/019/020 e preparacao da continuidade

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from repository root and must be maintained in accordance with it.

## Purpose / Big Picture

Depois deste trabalho, o time tera um fluxo objetivo para fechar o ciclo atual sem se perder: publicar o delta local da branch `neuromancer`, revalidar `alicia-ci` em 3 sistemas operacionais, consolidar notas de release e registrar risco residual do provider `claude-code`. O resultado observavel sera um conjunto de evidencias verificaveis (PR, CI e artifacts) alinhado ao checklist de release, permitindo iniciar a proxima iteracao com rastreabilidade e sem lacunas de contexto.

## Progress

- [x] (2026-02-18 12:23Z) Levantado estado atual dos documentos de release e checklist (`Alicia/07`, `Alicia/12`, `Alicia/13`) e confirmado backlog consolidado em `Alicia/09`.
- [x] (2026-02-18 12:23Z) Definido escopo do plano para `ALICIA-MVP-018`, `ALICIA-MVP-019` e `ALICIA-MVP-020`, incluindo risco operacional de `claude-code`.
- [x] (2026-02-18 12:26Z) Baseline tecnico revalidado com `cargo test -p codex-alicia-core -p codex-alicia-adapters -p codex-alicia-ui` (todos os testes passaram).
- [x] (2026-02-18 12:26Z) Lint e formatacao executados no escopo AlicIA (`cargo clippy --fix ... -p codex-alicia-ui`; `cargo fmt --all` como fallback de Windows).
- [x] (2026-02-18 12:36Z) Delta local publicado em PR contra `main`: `https://github.com/danielheringers/neuromancer/pull/13`.
- [x] (2026-02-18 12:36Z) Revalidacao completa do workflow `alicia-ci` no evento `pull_request` concluida com sucesso (9 jobs verdes): `https://github.com/danielheringers/neuromancer/actions/runs/22139722352`.
- [x] (2026-02-18 12:47Z) Diagnostico de falha na rodada seguinte de CI (`run 22140035071`): `start_pipe_session_emits_started_output_and_finished_events` falhou de forma intermitente no Ubuntu (`missing command output event with marker`).
- [x] (2026-02-18 12:47Z) Ajuste aplicado no teste de `codex-alicia-core` para esperar eventos esperados sem depender da ordem `output` vs `finished`; validado localmente com 12 repeticoes do teste e regressao dos crates AlicIA.
- [x] (2026-02-18 12:59Z) Notas de release/changelog da candidata consolidadas em `Alicia/15-notas-release-candidata-mvp-018-020.md` e checklist atualizado.
- [x] (2026-02-18 12:36Z) Decisao sobre risco residual do adapter `claude-code` registrada: risco aceito temporariamente ate validacao em host com binario real.
- [x] (2026-02-18 12:59Z) Revalidacao final de CI apos fix de intermitencia concluida com sucesso (run `19`, 9/9): `https://github.com/danielheringers/neuromancer/actions/runs/22140345314`.
- [x] (2026-02-18 13:11Z) Adicionado smoke test real opt-in para `claude-code` em `codex-rs/alicia-adapters/tests/real_provider_smoke.rs` e procedimento de fechamento do risco sincronizado em `Alicia/12` e `Alicia/13`.

## Surprises & Discoveries

- Observation: O arquivo `CHANGELOG.md` deste repositorio e apenas um ponteiro para releases no GitHub, nao um changelog detalhado local.
  Evidence: `CHANGELOG.md` contem somente: `The changelog can be found on the releases page`.

- Observation: O pacote `Alicia/13-pr-mvp-018-020.md` registra evidencias anteriores, mas o proprio documento informa que nao ha PR aberto no momento para `danielheringers:neuromancer`.
  Evidence: Secao `Estado de PR no GitHub` em `Alicia/13-pr-mvp-018-020.md`.

- Observation: No ambiente Windows atual, `just fmt` nao executa porque o `just` nao encontra shell compatível no host.
  Evidence: `error: Recipe fmt could not be run because just could not find the shell: program not found`; fallback aplicado com `cargo fmt --all`.
- Observation: O checklist atual de release ja marca quase tudo como concluido, mas ainda ha pendencias operacionais explicitas (delta local em PR/CI, changelog/release notes, validacao real de `claude-code`).
  Evidence: `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md`, secoes `Release e documentacao` e `4.1`.
- Observation: O host atual nao tem `gh` (GitHub CLI), entao a automacao de PR/CI precisou usar MCP GitHub e API REST do GitHub.
  Evidence: `gh auth status` retorna `The term 'gh' is not recognized...`.
- Observation: O host atual tambem nao tem `claude-code` instalado.
  Evidence: `claude-code --version` retorna `The term 'claude-code' is not recognized...`.
- Observation: O teste `start_pipe_session_emits_started_output_and_finished_events` era sensivel a ordem de chegada dos eventos e podia encerrar leitura cedo demais ao ver `CommandFinished` antes de `CommandOutputChunk`.
  Evidence: falha no CI: `missing command output event with marker`; ao repetir localmente apos ajuste, 12/12 execucoes passaram.

## Decision Log

- Decision: Focar este primeiro ExecPlan em fechamento de ciclo e readiness operacional, em vez de abrir nova frente de feature.
  Rationale: O backlog (`Alicia/09`) ja marca MVP e P1 imediato como implementados; o maior risco agora e perder rastreabilidade entre alteracoes locais, PR, CI e release.
  Date/Author: 2026-02-18 / Codex

- Decision: Tratar `ALICIA-MVP-018`, `ALICIA-MVP-019` e `ALICIA-MVP-020` como pacote unico de encerramento nesta iteracao.
  Rationale: Os tres itens compartilham as mesmas evidencias (workflow cross-platform, E2E e checklist/documentacao), e separar artificialmente aumenta chance de inconsistencias.
  Date/Author: 2026-02-18 / Codex

- Decision: Manter o risco de `claude-code` explicitamente registrado como gate de decisao, nao implodir o escopo com implementacao nova de adapter.
  Rationale: O risco atual e de validacao em host real, nao de desenvolvimento de funcionalidade no crate.
  Date/Author: 2026-02-18 / Codex
- Decision: Usar MCP GitHub + GitHub REST API para abrir PR e monitorar CI quando `gh` nao estiver disponivel no host.
  Rationale: Mantem o fluxo automatizado sem bloquear o fechamento do ciclo por dependencia de ferramenta local.
  Date/Author: 2026-02-18 / Codex
- Decision: Classificar o risco de `claude-code` como aceito temporariamente nesta iteracao, com validacao real adiada para host apropriado antes da release final.
  Rationale: A validacao nao pode ser executada neste host por ausencia do binario; o risco permanece explicitado no checklist e pacote de PR.
  Date/Author: 2026-02-18 / Codex
- Decision: Tornar o teste de sessao em pipe independente da ordem relativa entre `CommandOutputChunk` e `CommandFinished`.
  Rationale: Em execucao concorrente, o watcher de exit pode publicar `finished` antes do forwarder de output publicar o chunk final; o teste deve validar comportamento observavel sem assumir ordenacao estrita.
  Date/Author: 2026-02-18 / Codex
- Decision: Criar um smoke test real de provider controlado por env var para `claude-code`, em vez de depender apenas de validacao manual ad hoc.
  Rationale: A pendencia vira um procedimento reproduzivel com criterio de aceite claro (`cargo test ... real_provider_claude_code_smoke`) assim que houver host com binario.
  Date/Author: 2026-02-18 / Codex

## Outcomes & Retrospective

Plano em estado de fechamento: PR aberto com CI `pull_request` verde apos estabilizacao de teste intermitente, evidencias registradas em `Alicia/12` e `Alicia/13`, e notas de release consolidadas em `Alicia/15`. O objetivo original (tirar o ciclo de estado ad hoc e fechar com rastreabilidade) foi atendido. Resta apenas o risco conhecido de validacao real do provider `claude-code` em host com binario disponivel.

## Context and Orientation

Este repositorio usa `neuromancer` como branch de trabalho e `main` como espelho do upstream. O escopo AlicIA fica na pasta `Alicia/` com documentos canonicos de produto e artefatos operacionais. O arquivo `Alicia/09-backlog-issues-mvp.md` e a referencia de issue IDs e criterios de aceite. O arquivo `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md` e a referencia de prontidao de release. O arquivo `Alicia/13-pr-mvp-018-020.md` contem historico de evidencias e links de execucoes anteriores.

Neste plano, "delta local" significa exatamente as alteracoes ainda nao publicadas em PR que existem na branch local `neuromancer`. "Evidencia" significa artefato verificavel por humano (URL de workflow, status de job, hash de commit, trecho de log, ou arquivo JSONL de auditoria).

Arquivos e locais principais para este plano:

- `Alicia/09-backlog-issues-mvp.md` (status de issue IDs e criterios)
- `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md` (checklist Go/No-Go)
- `Alicia/13-pr-mvp-018-020.md` (historico de pacote e evidencias)
- `.github/workflows/alicia-ci.yml` (pipeline cross-platform)
- `codex-rs/alicia-ui/src/lib.rs`, `codex-rs/alicia-ui/src/main.rs`, `codex-rs/alicia-ui/tests/e2e_flow.rs` (delta tecnico atual)

## Plan of Work

Primeiro, consolidar o estado de branch para separar claramente o que e alteracao de processo/documentacao e o que e alteracao de runtime UI/policy. Em seguida, preparar um commit coerente com o fechamento do ciclo atual e publicar um PR com descricao que mapeie explicitamente `ALICIA-MVP-018/019/020` e criterios atendidos.

Depois da abertura do PR, executar a revalidacao do workflow `alicia-ci` e registrar links dos 9 jobs por sistema operacional. Se houver falha, corrigir no menor escopo possivel e rerodar ate estabilizar. Paralelamente, consolidar notas de release no formato usado pelo repositorio (release no GitHub, visto que `CHANGELOG.md` local e um ponteiro) e sincronizar o checklist `Alicia/12` com estado final verificavel.

Por fim, fechar o risco de `claude-code` com uma decisao explicita: validar em host com binario real e anexar evidencias, ou registrar formalmente a aceitacao temporaria do risco com plano de mitigacao e data-alvo.

## Concrete Steps

Working directory: repository root `C:\Users\danie\OneDrive\Documentos\Projetos\Neuromancer`

1. Preparar estado local e revisar delta.

    git status --short --branch
    git diff -- Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md
    git diff -- codex-rs/alicia-ui/src/lib.rs codex-rs/alicia-ui/src/main.rs codex-rs/alicia-ui/tests/e2e_flow.rs

   Expected: lista clara de arquivos alterados; nenhum arquivo inesperado para este ciclo.

2. Validar baseline tecnico antes de publicar PR.

    cd codex-rs
    cargo test -p codex-alicia-core -p codex-alicia-adapters -p codex-alicia-ui

   Expected: suites dos tres crates AlicIA passando.

3. Formatar/lint no escopo alterado.

    cd codex-rs
    just fmt

   Fallback (Windows shell sem `just` funcional):

    cd codex-rs
    cargo fmt --all

   Lint (ajustar `-p` conforme crate alterado):

    cd codex-rs
    cargo clippy --fix --all-features --tests --allow-dirty -p codex-alicia-ui

   Expected: comandos finalizam sem erro bloqueante.

4. Publicar commit e PR.

    git add AGENTS.md .agent/PLANS.md Alicia/14-fluxo-desenvolvimento-execplan.md Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md codex-rs/alicia-ui/src/lib.rs codex-rs/alicia-ui/src/main.rs codex-rs/alicia-ui/tests/e2e_flow.rs
    git commit -m "alicia: establish execplan workflow and finalize mvp-018-020 closure state"
    git push origin neuromancer

   Expected: commit publicado na branch remota.

5. Disparar/revalidar `alicia-ci` e registrar evidencias.

    # Opcao A (quando gh estiver disponivel)
    gh workflow run alicia-ci.yml --ref neuromancer
    gh run list --workflow alicia-ci.yml --limit 3
    gh run view <run-id> --json status,conclusion,url

    # Opcao B (fallback via GitHub API REST, usada nesta execucao)
    Invoke-RestMethod https://api.github.com/repos/danielheringers/neuromancer/actions/workflows/alicia-ci.yml/runs?head_sha=<sha>
    Invoke-RestMethod https://api.github.com/repos/danielheringers/neuromancer/actions/runs/<run-id>/jobs?per_page=100

   Expected: run concluido com `success` e 9 jobs verdes (3 jobs por 3 sistemas operacionais).

6. Consolidar release notes e checklist final.

    # Atualizar Alicia/12 com links finais e status Go/No-Go
    # Atualizar Alicia/13 com referencia final do PR e run de CI

   Expected: checklist sem ambiguidade; pendencias finais explicitadas.

7. Resolver risco `claude-code`.

    claude-code --version

   If binary is present, executar smoke de adapter e anexar evidencia. If binary is absent, registrar risco residual com dono, prazo e criterio de saida.

## Validation and Acceptance

Aceitacao deste plano exige comportamentos verificaveis:

1. Existe PR aberto de `neuromancer` para `main` com descricao que mapeia `ALICIA-MVP-018/019/020`.
2. O workflow `alicia-ci` desse PR conclui com sucesso em Windows, macOS e Linux para `suite_minima`, `policy_approval_scenarios` e `e2e_flow`.
3. O checklist `Alicia/12` reflete estado final sem contradicoes (itens marcados conforme evidencias reais).
4. Ha uma decisao explicita documentada para `claude-code`: validado com evidencia ou risco residual aceito com plano de mitigacao.

Comandos minimos de verificacao local:

    cd codex-rs
    cargo test -p codex-alicia-core -p codex-alicia-adapters -p codex-alicia-ui

Interprete sucesso como `test result: ok` para as suites executadas.

## Idempotence and Recovery

Os passos deste plano sao idempotentes quando executados com cuidado:

- Reexecutar testes e comandos de formatacao/lint e seguro.
- Reexecutar workflow `alicia-ci` e seguro; apenas gera nova execucao.
- Atualizacoes em `Alicia/12` e `Alicia/13` devem ser feitas de forma aditiva, preservando historico.

Se houver falha parcial:

1. Corrigir apenas o arquivo/escopo afetado.
2. Reexecutar somente os comandos de validacao impactados.
3. Atualizar `Progress` e `Decision Log` explicando a mudanca de curso.

Evitar comandos destrutivos (`reset --hard`, `checkout --`) para nao perder contexto local.

## Artifacts and Notes

Baseline documental observado antes da execucao:

    CHANGELOG.md
    The changelog can be found on the releases page(...)

Pendencias operacionais atuais (a partir de `Alicia/12`):

    - [x] Notas de release/changelog preenchidas.
    - [x] Delta local atual publicado em PR e validado novamente no `alicia-ci` (3 SO).
    - [ ] Validar provider `claude-code` com binario real no host alvo de release (risco aceito temporariamente nesta iteracao).

Historico de evidencias existentes para referencia:

    Alicia/13-pr-mvp-018-020.md
    - run com 9/9 jobs verdes registrado
    - PR atual aberto: https://github.com/danielheringers/neuromancer/pull/13
    - revalidacao atual: https://github.com/danielheringers/neuromancer/actions/runs/22139722352 (9/9)
    - revalidacao final apos fix: https://github.com/danielheringers/neuromancer/actions/runs/22140345314 (9/9)

## Interfaces and Dependencies

Dependencias de processo e ferramentas:

- Git e GitHub (`git`, opcionalmente `gh` para automacao de workflow/PR).
- Toolchain Rust em `codex-rs` para validacao local.
- Workflow `.github/workflows/alicia-ci.yml` como gate cross-platform.

Interfaces e arquivos que devem existir/ser mantidos ao final:

- `.agent/PLANS.md` define padrao de ExecPlan.
- `AGENTS.md` define quando ExecPlan e obrigatorio e qual fluxo operar.
- `Alicia/execplans/<arquivo>.md` guarda o estado vivo desta execucao.
- `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md` refletindo estado final de release readiness.
- `Alicia/13-pr-mvp-018-020.md` com evidencias finais de PR/CI.

Update note (2026-02-18 12:23Z): Plano criado para transformar pendencias operacionais do ciclo `ALICIA-MVP-018/019/020` em um fluxo executavel e rastreavel, reduzindo perda de contexto e preparando continuidade.


Update note (2026-02-18 12:26Z): Progresso atualizado com validacao local concluida (testes, clippy e formatacao) e descoberta operacional do fallback `cargo fmt --all` no Windows.
Update note (2026-02-18 12:36Z): Progresso atualizado com PR aberto (#13), CI `pull_request` 9/9 verde e decisao explicita de risco residual para `claude-code`; docs `Alicia/12` e `Alicia/13` sincronizadas.
Update note (2026-02-18 12:47Z): Plano atualizado com diagnostico da falha intermitente no CI, correcao do teste em `codex-alicia-core` e nova rodada de validacao local.
Update note (2026-02-18 12:59Z): Plano atualizado com release notes da candidata (`Alicia/15`), checklist sincronizado e revalidacao final de CI verde (run 19).
Update note (2026-02-18 13:11Z): Plano atualizado com smoke test real opt-in do provider `claude-code` e runbook objetivo para fechar o risco residual em host alvo.
