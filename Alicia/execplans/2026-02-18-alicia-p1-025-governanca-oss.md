# Bootstrap de governanca OSS pos-MVP (ALICIA-P1-025)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from repository root and must be maintained in accordance with it.

## Purpose / Big Picture

Depois deste trabalho, o repositorio passa a ter bootstrap minimo de governanca OSS pos-MVP visivel na raiz, com ponteiro de contribuicao, codigo de conduta e criterio objetivo de templates de issue para bug e feature. O resultado observavel e a cobertura do item `ALICIA-P1-025` no backlog com criterios rastreaveis por arquivo.

## Progress

- [x] (2026-02-18 15:07Z) Escopo mapeado no backlog e no plano OSS para confirmar consistencia antes de editar.
- [x] (2026-02-18 15:08Z) Item `ALICIA-P1-025` adicionado em `Alicia/09-backlog-issues-mvp.md` com criterios de aceite de governanca.
- [x] (2026-02-18 15:09Z) Criado `CONTRIBUTING.md` na raiz apontando para `docs/contributing.md` e reforcando fluxo por convite.
- [x] (2026-02-18 15:09Z) Criado `CODE_OF_CONDUCT.md` na raiz com expectativas objetivas, aplicacao e canal de reporte.
- [x] (2026-02-18 15:10Z) Validada consistencia de `Alicia/07-plano-release-oss.md`; sem necessidade de ajuste adicional.

## Surprises & Discoveries

- Observation: Os templates de issue de bug e feature ja existiam no repositorio.
  Evidence: `.github/ISSUE_TEMPLATE/4-bug-report.yml` e `.github/ISSUE_TEMPLATE/5-feature-request.yml`.

- Observation: O plano OSS ja cita os tres pilares de governanca solicitados.
  Evidence: `Alicia/07-plano-release-oss.md`, secao `Governanca inicial`.

## Decision Log

- Decision: Nao editar `Alicia/07-plano-release-oss.md` nesta iteracao.
  Rationale: O arquivo ja estava consistente com o escopo pedido; editar sem necessidade aumentaria ruido.
  Date/Author: 2026-02-18 / Codex

- Decision: Manter `CONTRIBUTING.md` raiz enxuto e baseado em ponteiro para `docs/contributing.md`.
  Rationale: Evita duplicacao de regra e preserva uma unica fonte detalhada.
  Date/Author: 2026-02-18 / Codex

- Decision: Definir `CODE_OF_CONDUCT.md` curto com expectativa, aplicacao e canal de reporte.
  Rationale: Atende bootstrap minimo de governanca com regra acionavel e linguagem direta.
  Date/Author: 2026-02-18 / Codex

## Outcomes & Retrospective

Escopo concluido com alteracoes minimas e rastreaveis: backlog atualizado com novo item pos-MVP, novo ExecPlan criado e artefatos de governanca adicionados na raiz. Nao houve necessidade de revisao ampla no plano OSS porque a consistencia ja existia.

## Context and Orientation

O escopo AlicIA usa `Alicia/09-backlog-issues-mvp.md` como fonte para IDs e criterios de aceite. O plano `Alicia/07-plano-release-oss.md` define diretrizes de release/governanca. Para contribuicao detalhada, a base do repositorio usa `docs/contributing.md`; esta iteracao adiciona ponteiros/artefatos raiz esperados em projetos OSS.

## Plan of Work

Primeiro, confirmar o estado atual do backlog, templates de issue e plano OSS para evitar editar o que ja estava correto. Em seguida, adicionar o item `ALICIA-P1-025` com criterios de aceite observaveis por arquivo. Depois, criar os documentos raiz de governanca (`CONTRIBUTING.md` e `CODE_OF_CONDUCT.md`) com texto curto e operacional. Por fim, validar consistencia e registrar as decisoes neste ExecPlan.

## Concrete Steps

Working directory: `C:\Users\danie\OneDrive\Documentos\Projetos\Neuromancer`

1. Inspecao de baseline documental:

    rg -n "ALICIA-P1-" Alicia/09-backlog-issues-mvp.md
    Get-Content -Raw Alicia/09-backlog-issues-mvp.md
    Get-Content -Raw Alicia/07-plano-release-oss.md
    rg --files docs
    rg --files .github

2. Atualizacao de backlog:

    editar Alicia/09-backlog-issues-mvp.md para incluir ALICIA-P1-025

3. Bootstrap de governanca na raiz:

    criar CONTRIBUTING.md com ponteiro para docs/contributing.md
    criar CODE_OF_CONDUCT.md com expectativas e canal de reporte

4. Conferencia final:

    Test-Path CONTRIBUTING.md
    Test-Path CODE_OF_CONDUCT.md
    Test-Path .github/ISSUE_TEMPLATE/4-bug-report.yml
    Test-Path .github/ISSUE_TEMPLATE/5-feature-request.yml

## Validation and Acceptance

Aceite desta entrega:

1. `Alicia/09-backlog-issues-mvp.md` contem `ALICIA-P1-025` em `P1 - Pos MVP`.
2. `CONTRIBUTING.md` existe na raiz e aponta para `docs/contributing.md`, deixando claro o fluxo por convite.
3. `CODE_OF_CONDUCT.md` existe na raiz com expectativas, aplicacao e canal de reporte.
4. Templates de issue de bug/feature existem em `.github/ISSUE_TEMPLATE/`.

Comandos de verificacao (na raiz):

    Test-Path CONTRIBUTING.md
    Test-Path CODE_OF_CONDUCT.md
    Test-Path .github/ISSUE_TEMPLATE/4-bug-report.yml
    Test-Path .github/ISSUE_TEMPLATE/5-feature-request.yml

Saida esperada: `True` para os quatro checks.

## Idempotence and Recovery

As mudancas sao textuais e aditivas; reaplicar a verificacao de existencia de arquivos e seguro. Em caso de ajuste de redacao, basta editar os mesmos arquivos sem comandos destrutivos. Nao ha migracao de dados nem impacto em runtime.

## Artifacts and Notes

Arquivos alterados neste plano:

- `Alicia/09-backlog-issues-mvp.md`
- `Alicia/execplans/2026-02-18-alicia-p1-025-governanca-oss.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`

## Interfaces and Dependencies

Dependencias diretas deste escopo:

- `docs/contributing.md` (fonte detalhada de contribuicao)
- `.github/ISSUE_TEMPLATE/4-bug-report.yml` (template bug)
- `.github/ISSUE_TEMPLATE/5-feature-request.yml` (template feature)
- `Alicia/07-plano-release-oss.md` (consistencia de governanca inicial)

Update note (2026-02-18 15:10Z): Plano criado e atualizado para refletir a implementacao completa do bootstrap de governanca OSS pos-MVP (`ALICIA-P1-025`) com backlog, artefatos raiz e verificacao de consistencia.
