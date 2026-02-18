# AlicIA - Fluxo de Desenvolvimento com ExecPlan

Data de referencia: 2026-02-18

Este fluxo organiza o desenvolvimento para evitar perda de contexto e manter entregas previsiveis.

## Objetivo do fluxo

Garantir que toda entrega tenha:

1. Escopo claro (issue ID e criterio de aceite).
2. Plano executavel e rastreavel (ExecPlan).
3. Validacao objetiva (testes e evidencia observavel).
4. Continuidade (proximo passo explicito no proprio plano).

## Arquivos de controle

- Regras operacionais: `AGENTS.md`
- Padrao de ExecPlan: `.agent/PLANS.md`
- Planos ativos: `Alicia/execplans/`
- Backlog e IDs: `Alicia/09-backlog-issues-mvp.md`
- Checklist de release: `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md`

## Fluxo padrao (fim-a-fim)

### 1) Intake da tarefa

1. Mapear a solicitacao para issue IDs do AlicIA.
2. Confirmar criterios de aceite e riscos.
3. Definir se a tarefa exige ExecPlan (regra: qualquer tarefa complexa exige).

### 2) Planejamento (ExecPlan)

1. Criar/atualizar arquivo em `Alicia/execplans/` no formato:
   `YYYY-MM-DD-<issue-id>-<slug>.md`
2. Preencher todas as secoes obrigatorias de `.agent/PLANS.md`.
3. Registrar baseline tecnico e comandos de validacao antes da implementacao.

### 3) Implementacao por marcos

1. Implementar em marcos pequenos e verificaveis.
2. A cada marco:
   - atualizar `Progress`,
   - registrar descobertas em `Surprises & Discoveries`,
   - registrar decisoes em `Decision Log`.
3. Manter comportamento observavel (teste, output de CLI ou fluxo de UI).

### 4) Validacao

No minimo, executar os testes dos crates impactados. Baseline recomendada para AlicIA:

    cd codex-rs
    cargo test -p codex-alicia-core
    cargo test -p codex-alicia-adapters
    cargo test -p codex-alicia-ui

Se houver mudanca de lint/formatacao:

    cd codex-rs
    just fmt

Fallback no Windows quando `just` nao estiver funcional no shell atual:

    cd codex-rs
    cargo fmt --all

### 5) Fechamento da iteracao

1. Atualizar status no ExecPlan (incluindo pendencias reais).
2. Atualizar `Alicia/12` quando status de release/validacao mudar.
3. Atualizar `Alicia/09` quando cobertura de issue/criterio mudar.
4. Registrar proximo passo objetivo para a iteracao seguinte.

## Definicao de pronto da iteracao

Uma iteracao so e considerada pronta quando:

1. Existe evidencia de validacao para o que foi alterado.
2. O ExecPlan reflete 100% do estado atual (feito, pendente, decisoes).
3. IDs de issue e criterios de aceite cobertos foram explicitados.
4. Riscos remanescentes foram listados com acao seguinte.

## Regra de ouro para nao se perder

Se a tarefa for complexa e nao existir ExecPlan atualizado em `Alicia/execplans/`, o trabalho nao deve prosseguir para implementacao.
