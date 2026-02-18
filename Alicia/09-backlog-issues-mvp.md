# AlicIA - Backlog em Formato de Issues (MVP)

## Como usar
1. Cada item abaixo pode virar uma issue independente.
2. IDs servem para dependencias cruzadas.
3. Prioridade `P0` define o minimo obrigatorio do MVP.

## Atualizacao de Escopo - Reuso Codex (2026-02-17)
1. `ALICIA-MVP-001`, `ALICIA-MVP-002`, `ALICIA-MVP-003`: parcialmente atendidos no bootstrap inicial (`codex-rs/alicia-core`, `codex-rs/alicia-adapters`, `codex-rs/alicia-ui`) e no documento `Alicia/10-contratos-tecnicos-v1.md`.
2. `ALICIA-MVP-004`, `ALICIA-MVP-005`, `ALICIA-MVP-015`: implementar por integracao sobre `codex-utils-pty` e `core/unified_exec`, evitando reescrita de PTY/lifecycle.
3. `ALICIA-MVP-006`, `ALICIA-MVP-007`, `ALICIA-MVP-008`, `ALICIA-MVP-009`: implementar por composicao sobre `AskForApproval`, `SandboxPolicy`, runtime de approvals e `network-proxy` ja existentes.
4. `ALICIA-MVP-010`: base append-only JSONL ja existe em `RolloutRecorder`, mas faltam campos obrigatorios de auditoria do MVP no schema persisted.
5. `ALICIA-MVP-011`: helper de redaction ja existe (`codex-utils-sanitizer`), mas ainda nao esta conectado no pipeline de persistencia de auditoria.
6. `ALICIA-MVP-012`: contrato comum ja iniciado no `codex-alicia-adapters`, faltam adapters reais e testes de contrato por provider.
7. `ALICIA-MVP-013`, `ALICIA-MVP-014`: ainda nao iniciados (nao ha adapter real para `codex-cli` nem `claude-code`).
8. `ALICIA-MVP-016`, `ALICIA-MVP-017`: motor de eventos/diff aproveitavel da TUI atual, porem renderizacao `egui` ainda nao implementada.
9. Referencia tecnica completa do inventario: `Alicia/11-mapa-reuso-codex.md`.

## Atualizacao de Progresso - Implementacao (2026-02-18)
1. `ALICIA-MVP-001`, `ALICIA-MVP-002`, `ALICIA-MVP-003`: concluidos com contratos de policy/IPC e bootstrap dos crates.
2. `ALICIA-MVP-004`, `ALICIA-MVP-005`, `ALICIA-MVP-025`: concluidos no `SessionManager` com `start/stop/reattach`, bridge PTY/pipe e eventos normalizados.
3. `ALICIA-MVP-006`, `ALICIA-MVP-007`, `ALICIA-MVP-008`, `ALICIA-MVP-026`: concluidos com mapeamento de perfis, guard canonico de workspace (incluindo symlink escape) e decisao de rede por perfil.
4. `ALICIA-MVP-009`, `ALICIA-MVP-015`, `ALICIA-MVP-016`, `ALICIA-MVP-017`: concluidos no fluxo UI/runtime (`egui`) com terminal, fila de aprovacoes, timeline e diff preview.
5. `ALICIA-MVP-010`, `ALICIA-MVP-011`, `ALICIA-MVP-027`: concluidos com auditoria JSONL append-only e redaction antes da persistencia.
6. `ALICIA-MVP-012`, `ALICIA-MVP-013`, `ALICIA-MVP-014`, `ALICIA-MVP-028`: concluidos com contrato comum de adapter e adapters funcionais `codex-cli` e `claude-code`.
7. `ALICIA-MVP-018`, `ALICIA-MVP-019`, `ALICIA-MVP-020`: concluidos com workflow cross-platform `alicia-ci`, testes E2E e guia de instalacao/troubleshooting/checklist.
8. `ALICIA-P1-021`, `ALICIA-P1-022`, `ALICIA-P1-023`, `ALICIA-P1-024`, `ALICIA-P1-025`: implementados (incluindo diff por hunk, policy por projeto, cancelamento seguro, mensagens para iniciantes e bootstrap de governanca OSS).

## P0 Imediato - Integracao Reuse-first

### ALICIA-MVP-025 - Bridge de Sessao sobre `codex-utils-pty`
1. Prioridade: P0
2. Sprint sugerida: 1
3. Componentes: Core, Terminal
4. Descricao: Expor API `start/stop/reattach` do AlicIA sobre `SpawnedProcess`/`ProcessHandle` e watchers de lifecycle existentes.
5. Dependencias: ALICIA-MVP-003
6. Criterios de aceite:
1. Wrapper de sessao usa `spawn_pty_process`/pipe fallback sem duplicar engine de processo.
2. Eventos de saida (`stdout/stderr`) entram no contrato IPC do AlicIA.
3. Testes cobrindo start/stop e caso de processo long-running.

### ALICIA-MVP-026 - Bridge de Policy sobre `SandboxPolicy` e `AskForApproval`
1. Prioridade: P0
2. Sprint sugerida: 2
3. Componentes: Core, Security
4. Descricao: Mapear perfis do AlicIA para politicas efetivas do Codex com comportamento fail-closed.
5. Dependencias: ALICIA-MVP-006, ALICIA-MVP-007, ALICIA-MVP-008
6. Criterios de aceite:
1. Perfil do AlicIA gera configuracao efetiva valida de sandbox/aprovacao.
2. Workspace guard bloqueia alvo fora do workspace em IO/patch/comando.
3. Politica de rede por perfil gera decisao auditavel (`allow/require_approval/deny`).

### ALICIA-MVP-027 - Auditoria MVP sobre `RolloutRecorder`
1. Prioridade: P0
2. Sprint sugerida: 3
3. Componentes: Core, Observability, Security
4. Descricao: Estender persistencia JSONL existente com schema de auditoria MVP e redaction antes de escrita.
5. Dependencias: ALICIA-MVP-010, ALICIA-MVP-011
6. Criterios de aceite:
1. Cada linha contem campos obrigatorios do MVP (`timestamp`, `session_id`, `action_kind`, `target`, `profile`, `policy_decision`, `approval_decision`, `result_status`, `duration_ms`).
2. Escrita continua append-only.
3. Redaction de segredos aplicada antes da persistencia em testes automatizados.

### ALICIA-MVP-028 - Adapter real `codex-cli`
1. Prioridade: P0
2. Sprint sugerida: 4
3. Componentes: Adapters
4. Descricao: Implementar adapter concreto no `codex-alicia-adapters` para fluxo de tarefa simples com normalizacao de eventos/erros.
5. Dependencias: ALICIA-MVP-012, ALICIA-MVP-013
6. Criterios de aceite:
1. Provider executa tarefa simples e emite eventos IPC normalizados.
2. Erros de provider nao derrubam sessao principal.
3. Testes de contrato para versao suportada do provider.

## P0 - Obrigatorio para MVP

### ALICIA-MVP-001 - Contrato de Acoes e Decisoes de Policy
1. Prioridade: P0
2. Sprint sugerida: 0
3. Componentes: Core, Security
4. Descricao: Definir taxonomia final de acoes (`read_file`, `write_file`, `execute_command`, `apply_patch`, `network_access`) e decisoes (`allow`, `require_approval`, `deny`).
5. Dependencias: nenhuma
6. Criterios de aceite:
1. Contrato documentado e versionado.
2. Matriz de acao x perfil definida.
3. Testes unitarios de validacao de tipos.

### ALICIA-MVP-002 - Contrato IPC de Eventos Tipados
1. Prioridade: P0
2. Sprint sugerida: 0
3. Componentes: Core, UI
4. Descricao: Definir mensagens `ActionProposed`, `ApprovalRequested`, `ApprovalResolved`, `CommandStarted`, `CommandOutputChunk`, `CommandFinished`, `PatchPreviewReady`, `PatchApplied`.
5. Dependencias: ALICIA-MVP-001
6. Criterios de aceite:
1. Eventos serializam/desserializam sem perda.
2. Versao de protocolo definida.
3. Testes cobrindo payload minimo e erro de schema.

### ALICIA-MVP-003 - Bootstrap da Arquitetura Core/UI/Adapters
1. Prioridade: P0
2. Sprint sugerida: 0
3. Componentes: Infra, Core, UI
4. Descricao: Criar estrutura inicial dos modulos e fronteiras de responsabilidade.
5. Dependencias: ALICIA-MVP-001, ALICIA-MVP-002
6. Criterios de aceite:
1. Modulos compilam com build local.
2. Fronteiras documentadas (UI nao executa acao privilegiada direta).
3. Integracao basica por eventos funcionando.

### ALICIA-MVP-004 - Session Manager PTY Cross-Platform
1. Prioridade: P0
2. Sprint sugerida: 1
3. Componentes: Core, Terminal
4. Descricao: Implementar criacao e manutencao de sessoes PTY em Windows/macOS/Linux.
5. Dependencias: ALICIA-MVP-003
6. Criterios de aceite:
1. Sessao `start`/`stop` funcional nos 3 SO.
2. Entrada/saida em stream sem travamento no caso comum.
3. Teste de comando simples passando em 3 SO.

### ALICIA-MVP-005 - Lifecycle de Sessao e Reattach
1. Prioridade: P0
2. Sprint sugerida: 1
3. Componentes: Core, Terminal
4. Descricao: Implementar reattach e recuperacao de sessao ativa.
5. Dependencias: ALICIA-MVP-004
6. Criterios de aceite:
1. Reattach restaura contexto de sessao.
2. Eventos de estado de sessao emitidos corretamente.
3. Testes de longa duracao sem falha intermitente critica.

### ALICIA-MVP-006 - Policy Engine com 3 Perfis
1. Prioridade: P0
2. Sprint sugerida: 2
3. Componentes: Core, Security
4. Descricao: Implementar perfis `read_only`, `read_write_with_approval`, `full_access`.
5. Dependencias: ALICIA-MVP-001
6. Criterios de aceite:
1. Matriz de decisoes aplicada corretamente.
2. `read_only` so permite leitura.
3. `read_write_with_approval` exige aprovacao nas acoes sensiveis.

### ALICIA-MVP-007 - Bloqueio Fora do Workspace
1. Prioridade: P0
2. Sprint sugerida: 2
3. Componentes: Core, Security
4. Descricao: Bloquear IO/patch/comando com alvo fora do workspace via path canonico.
5. Dependencias: ALICIA-MVP-006
6. Criterios de aceite:
1. Nenhuma escrita fora do workspace permitida em testes.
2. Tentativas bloqueadas com log de auditoria.
3. Cobertura de casos com symlink/path traversal.

### ALICIA-MVP-008 - Politica de Rede por Perfil
1. Prioridade: P0
2. Sprint sugerida: 2
3. Componentes: Core, Security
4. Descricao: Aplicar regras de acesso a rede por perfil e por acao.
5. Dependencias: ALICIA-MVP-006
6. Criterios de aceite:
1. Regra padrao restritiva aplicada.
2. Decisao de rede auditada em todas as tentativas.
3. Testes de allow/require_approval/deny.

### ALICIA-MVP-009 - Approval Manager Fim a Fim
1. Prioridade: P0
2. Sprint sugerida: 3
3. Componentes: Core, UI
4. Descricao: Implementar fila de aprovacoes com estados `approved`, `denied`, `expired`.
5. Dependencias: ALICIA-MVP-006, ALICIA-MVP-002
6. Criterios de aceite:
1. Toda acao `require_approval` entra na fila.
2. Timeout expira em estado fechado.
3. Sem decisao explicita, acao nao executa.

### ALICIA-MVP-010 - Audit Logger JSONL Append-Only
1. Prioridade: P0
2. Sprint sugerida: 3
3. Componentes: Core, Observability
4. Descricao: Persistir trilha completa por linha JSONL com campos minimos definidos.
5. Dependencias: ALICIA-MVP-001
6. Criterios de aceite:
1. Logs contem timestamp, session_id, action_kind, target, profile, policy_decision, approval_decision, result_status, duration_ms.
2. Escrita append-only validada.
3. Parser de log para validacao basica.

### ALICIA-MVP-011 - Redaction de Segredos em Logs
1. Prioridade: P0
2. Sprint sugerida: 3
3. Componentes: Core, Security
4. Descricao: Mascarar padroes sensiveis antes da persistencia.
5. Dependencias: ALICIA-MVP-010
6. Criterios de aceite:
1. Tokens/chaves/senhas mascarados em casos de teste.
2. Nao mascarar excessivamente conteudo comum.
3. Testes automatizados de redaction.

### ALICIA-MVP-012 - Contrato Comum de Provider Adapter
1. Prioridade: P0
2. Sprint sugerida: 4
3. Componentes: Core, Adapters
4. Descricao: Definir trait/interface unica de capabilities, eventos e erros para providers externos.
5. Dependencias: ALICIA-MVP-002, ALICIA-MVP-003
6. Criterios de aceite:
1. Adapter interface documentada.
2. Eventos normalizados entre providers.
3. Tratamento de erro padrao definido.

### ALICIA-MVP-013 - Adapter Funcional `codex-cli`
1. Prioridade: P0
2. Sprint sugerida: 4
3. Componentes: Adapters
4. Descricao: Integrar `codex-cli` via contrato comum.
5. Dependencias: ALICIA-MVP-012
6. Criterios de aceite:
1. Fluxo de tarefa simples completo via provider.
2. Erros de provider sao exibidos sem crash.
3. Teste de contrato da versao suportada.

### ALICIA-MVP-014 - Adapter Funcional `claude-code`
1. Prioridade: P0
2. Sprint sugerida: 5
3. Componentes: Adapters
4. Descricao: Integrar `claude-code` no mesmo contrato do adapter anterior.
5. Dependencias: ALICIA-MVP-012
6. Criterios de aceite:
1. Troca de provider sem mudar fluxo principal.
2. Compatibilidade minima validada.
3. Erros mapeados para formato comum.

### ALICIA-MVP-015 - UI: Terminal Principal Integrado
1. Prioridade: P0
2. Sprint sugerida: 6
3. Componentes: UI (egui), Core
4. Descricao: Renderizar terminal e stream de output em tempo real.
5. Dependencias: ALICIA-MVP-004, ALICIA-MVP-005
6. Criterios de aceite:
1. Terminal exibe output em tempo real sem congelar.
2. Input do usuario chega na sessao correta.
3. Scrollback minimo funcional.

### ALICIA-MVP-016 - UI: Fila de Aprovacoes
1. Prioridade: P0
2. Sprint sugerida: 6
3. Componentes: UI (egui), Core
4. Descricao: Exibir e resolver aprovacoes pendentes com contexto de risco.
5. Dependencias: ALICIA-MVP-009
6. Criterios de aceite:
1. Prompt mostra o que, onde, comando e impacto.
2. Usuario aprova/rejeita de forma explicita.
3. Estado final reflete no fluxo da tarefa.

### ALICIA-MVP-017 - UI: Timeline + Diff Preview Simplificado
1. Prioridade: P0
2. Sprint sugerida: 6
3. Componentes: UI (egui)
4. Descricao: Mostrar historico de eventos e preview de diff por arquivo.
5. Dependencias: ALICIA-MVP-002, ALICIA-MVP-015
6. Criterios de aceite:
1. Timeline atualiza em ordem de eventos.
2. Diff por arquivo visivel antes da aplicacao.
3. Usuario identifica impacto basico da alteracao.

### ALICIA-MVP-018 - Testes Cross-Platform e CI Basico
1. Prioridade: P0
2. Sprint sugerida: 7
3. Componentes: QA, Infra
4. Descricao: Configurar pipeline de validacao em Windows/macOS/Linux com cenarios essenciais.
5. Dependencias: ALICIA-MVP-004, ALICIA-MVP-006, ALICIA-MVP-009, ALICIA-MVP-013, ALICIA-MVP-014
6. Criterios de aceite:
1. Suite minima roda nos 3 SO.
2. Cenarios de policy/aprovacao passam em CI.
3. Falhas reportadas por plataforma com clareza.

### ALICIA-MVP-019 - Teste E2E do Fluxo Principal
1. Prioridade: P0
2. Sprint sugerida: 7
3. Componentes: QA, Core, UI
4. Descricao: Cobrir fluxo completo: solicitacao, policy, aprovacao, execucao, auditoria e retorno ao usuario.
5. Dependencias: ALICIA-MVP-016, ALICIA-MVP-017, ALICIA-MVP-018
6. Criterios de aceite:
1. Caso feliz passa em 3 SO.
2. Caso com negacao/expiracao de aprovacao passa.
3. Trilha de auditoria valida ao final do teste.

### ALICIA-MVP-020 - Documentacao MVP e Checklist de Release
1. Prioridade: P0
2. Sprint sugerida: 7
3. Componentes: Docs, Release
4. Descricao: Publicar instalacao, troubleshooting e checklist final de liberacao.
5. Dependencias: ALICIA-MVP-018, ALICIA-MVP-019
6. Criterios de aceite:
1. Guia de instalacao para 3 SO.
2. Troubleshooting dos principais erros.
3. Checklist pre-release completo e revisado.

## P1 - Pos MVP Imediato

### ALICIA-P1-021 - Diff por Hunk com Aprovacao Granular
1. Prioridade: P1
2. Sprint sugerida: pos MVP
3. Dependencias: ALICIA-MVP-017
4. Criterios de aceite:
1. Aprovar/rejeitar por bloco de alteracao.
2. UI indica impacto por hunk.

### ALICIA-P1-022 - Politica por Projeto (arquivo de config)
1. Prioridade: P1
2. Sprint sugerida: pos MVP
3. Dependencias: ALICIA-MVP-006, ALICIA-MVP-008
4. Criterios de aceite:
1. Override local por projeto funcionando.
2. Validacao de schema de configuracao.

### ALICIA-P1-023 - Cancelamento Seguro de Tarefa
1. Prioridade: P1
2. Sprint sugerida: pos MVP
3. Dependencias: ALICIA-MVP-005, ALICIA-MVP-015
4. Criterios de aceite:
1. Cancelamento interrompe execucao sem corromper sessao.
2. Estado final registrado em auditoria.

### ALICIA-P1-024 - Mensagens de Erro para Iniciantes
1. Prioridade: P1
2. Sprint sugerida: pos MVP
3. Dependencias: ALICIA-MVP-016, ALICIA-MVP-017
4. Criterios de aceite:
1. Erro com explicacao curta e proximo passo recomendado.
2. Linguagem sem jargao tecnico desnecessario.

### ALICIA-P1-025 - Bootstrap de Governanca OSS Pos-MVP
1. Prioridade: P1
2. Sprint sugerida: pos MVP
3. Dependencias: ALICIA-MVP-020
4. Criterios de aceite:
1. `CONTRIBUTING.md` existe na raiz, referencia `docs/contributing.md` e explicita o fluxo de contribuicao por convite.
2. `CODE_OF_CONDUCT.md` existe na raiz com expectativas de conduta objetivas e canal de reporte.
3. Templates de issue para bug e feature estao presentes em `.github/ISSUE_TEMPLATE/`.
