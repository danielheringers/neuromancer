# AlicIA - Plano de Execucao por Sprints (MVP)

## Objetivo
Entregar um MVP funcional do AlicIA em 8 semanas, com foco em terminal PTY, seguranca/policy, fluxo de aprovacao e UI egui operacional, com paridade Windows/macOS/Linux.

## Premissas
1. Sprints semanais (1 semana cada).
2. Trabalho em trilhas paralelas: Core, UI, Adapters, QA.
3. Prioridade por risco: PTY cross-platform, policy/aprovacao e auditoria.
4. Escopo MVP limitado ao definido nos documentos `Alicia/00` a `Alicia/07`.

## Atualizacao de Escopo - 2026-02-17 (Reuse-first)
1. Reaproveitar como base obrigatoria os componentes existentes do Codex antes de criar implementacoes novas.
2. Tratar o crate `codex-utils-pty` e o fluxo de `unified_exec` como fundacao do Session Manager do AlicIA.
3. Tratar `AskForApproval` + `SandboxPolicy` + `network-proxy` do `codex-rs` como fundacao do policy engine e fluxo de aprovacao.
4. Tratar `RolloutRecorder` como fundacao de persistencia JSONL append-only, extendendo schema e redaction para os campos exigidos no MVP.
5. Reutilizar pipeline de diff/timeline da `codex-rs/tui` somente como motor de dados; a renderizacao do AlicIA permanece em `egui`.
6. Escopo detalhado de reaproveitamento e gaps: `Alicia/11-mapa-reuso-codex.md`.

## Replanejamento Tatico por Sprint (com base em reuso)
1. Sprint 0: consolidar contratos (`Alicia/10`) e travar fronteiras de integracao com componentes do Codex ja existentes.
2. Sprint 1: integrar PTY/lifecycle sobre `codex-utils-pty` + watchers do `unified_exec`.
3. Sprint 2: mapear perfis do AlicIA sobre `SandboxPolicy`/`AskForApproval` com guard de workspace e politica de rede.
4. Sprint 3: estender trilha de auditoria JSONL com schema MVP e redaction antes de persistencia.
5. Sprint 4 e 5: focar nos adapters reais (`codex-cli`, `claude-code`) sobre o contrato comum ja criado.
6. Sprint 6: implementar UI `egui` conectada ao core reutilizando motores de diff/eventos existentes.
7. Sprint 7: hardening, CI cross-platform e checklist de release.

## Definicao de Pronto Global (MVP)
1. Fluxo completo funcional: pedido do usuario, avaliacao de policy, aprovacao, execucao e resultado.
2. Bloqueio fora do workspace validado por testes automatizados.
3. Politica de rede ativa por perfil.
4. Auditoria JSONL append-only com redaction de segredos.
5. Execucao consistente em Windows, macOS e Linux.

## Sprint 0 - Fundacao e Contratos (Semana 1)
## Objetivos
1. Congelar contratos de dominio e taxonomia de acoes.
2. Definir protocolo de eventos IPC.
3. Definir schema de auditoria.
4. Criar esqueleto dos modulos Core/UI/Adapters.

## Entregaveis
1. Documento de contrato de acoes e decisoes (`allow`, `require_approval`, `deny`).
2. Tipos de eventos IPC: `ActionProposed`, `ApprovalRequested`, `ApprovalResolved`, `CommandStarted`, `CommandOutputChunk`, `CommandFinished`, `PatchPreviewReady`, `PatchApplied`.
3. Schema JSONL de auditoria com campos obrigatorios.
4. Estrutura inicial dos crates/modulos.

## Dependencias
1. Nenhuma tecnica previa.

## Criterios de Aceite
1. Contratos versionados e revisados.
2. Testes de serializacao dos tipos de eventos.
3. Build local dos modulos base sem warnings bloqueantes.

## Sprint 1 - Session Manager PTY (Semana 2)
## Objetivos
1. Implementar PTY minimo cross-platform.
2. Entregar ciclo de vida de sessao.
3. Garantir stream de entrada/saida estavel.

## Entregaveis
1. API de sessao: `start`, `stop`, `reattach`.
2. Captura de `stdout/stderr` em chunks.
3. Controle de buffer e limites de scrollback.
4. Testes de sessao curta e longa.

## Dependencias
1. Contratos de eventos da Sprint 0.

## Criterios de Aceite
1. Comando simples executa e retorna saida nos 3 SO.
2. Reattach restaura sessao ativa sem corrupcao de stream.
3. Cenarios long-running sem vazamento evidente de memoria.

## Sprint 2 - Policy Engine e Workspace Guard (Semana 3)
## Objetivos
1. Implementar os 3 perfis de permissao.
2. Bloquear acesso fora do workspace no MVP.
3. Ativar politica de rede por perfil.

## Entregaveis
1. Perfis `read_only`, `read_write_with_approval`, `full_access`.
2. Matriz de acao/perfil com decisoes consistentes.
3. Validacao de path canonico para IO e patch.
4. Regras de rede com `allow/require_approval/deny`.

## Dependencias
1. Session Manager da Sprint 1.
2. Contrato de acoes da Sprint 0.

## Criterios de Aceite
1. Nenhuma escrita fora do workspace passa em testes.
2. Perfil `read_only` nega escrita/patch/comando sensivel/rede.
3. Falha fechada para qualquer acao sem decisao explicita.

## Sprint 3 - Approval Manager e Auditoria (Semana 4)
## Objetivos
1. Fechar fluxo de aprovacao fim a fim.
2. Registrar trilha de auditoria completa.
3. Reduzir risco de vazamento de segredo em logs.

## Entregaveis
1. Fila de aprovacoes com estados `approved/denied/expired`.
2. Timeout e politicas de expiracao.
3. Logger JSONL append-only.
4. Pipeline de redaction de dados sensiveis.

## Dependencias
1. Policy Engine da Sprint 2.
2. Eventos IPC da Sprint 0.

## Criterios de Aceite
1. Toda acao sensivel gera log com decisao de policy e aprovacao.
2. Sem aprovacao explicita, acao sensivel nao executa.
3. Testes cobrindo redaction para padroes de segredo.

## Sprint 4 - Adapter Codex CLI (Semana 5)
## Objetivos
1. Implementar primeiro provider com contrato comum.
2. Garantir mapeamento de eventos e erros.

## Entregaveis
1. Interface de adapter com capabilities/eventos/erros.
2. Adapter funcional para `codex-cli`.
3. Modo degradado com erro claro para incompatibilidades.
4. Testes de contrato por versao suportada.

## Dependencias
1. Core operacional das Sprints 1 a 3.

## Criterios de Aceite
1. Tarefa simples roda via `codex-cli` com policy/aprovacao/auditoria.
2. Falhas do provider nao derrubam sessao principal.

## Sprint 5 - Adapter Claude Code (Semana 6)
## Objetivos
1. Incluir segundo provider sem quebrar arquitetura.
2. Normalizar eventos entre adapters.

## Entregaveis
1. Adapter funcional para `claude-code`.
2. Mapeamento padrao de erros e estados.
3. Testes de compatibilidade minima dos 2 providers.

## Dependencias
1. Contrato de adapter da Sprint 4.

## Criterios de Aceite
1. Troca de provider sem alterar fluxo principal do usuario.
2. Erros comuns aparecem em formato consistente na UI.

## Sprint 6 - UI Egui Funcional (Semana 7)
## Objetivos
1. Entregar experiencia minima de uso para iniciantes e avancados.
2. Conectar UI com Core em tempo real.

## Entregaveis
1. Terminal principal integrado ao Session Manager.
2. Painel lateral de timeline.
3. Fila de aprovacoes com decisao explicita.
4. Preview de diff simplificado por arquivo.
5. Indicador de perfil de permissao ativo.

## Dependencias
1. Core + adapters funcionais (Sprints 1 a 5).

## Criterios de Aceite
1. Fluxo completo ponta a ponta pela UI.
2. Prompt de aprovacao mostra acao, alvo, comando e impacto.
3. Interacao fluida sem congelamentos no caso comum.

## Sprint 7 - Hardening e Go/No-Go MVP (Semana 8)
## Objetivos
1. Endurecer estabilidade, performance e release readiness.
2. Fechar checklist de liberacao MVP.

## Entregaveis
1. Suite basica cross-platform em CI.
2. Ajustes de performance (coalescencia de output e limite de repaint).
3. Documentacao de instalacao e troubleshooting.
4. Checklist final de seguranca e regressao.

## Dependencias
1. Entregas de todas as sprints anteriores.

## Criterios de Aceite
1. Go/No-Go aprovado: seguranca, aprovacao e paridade 3 SO.
2. Logs auditados sem exposicao de segredo.
3. Bloqueio fora do workspace validado em regressao.

## Riscos por trilha e acao preventiva
1. PTY no Windows/ConPTY: manter matriz de testes desde Sprint 1.
2. Mudancas em CLIs externos: testes de contrato por versao nas Sprints 4 e 5.
3. Fadiga de aprovacao: melhorar resumo de impacto na Sprint 6.
4. Performance UI: profiling e limites de repaint na Sprint 7.

## Metricas de acompanhamento semanal
1. Taxa de cenarios P0 aprovados em CI.
2. Tempo medio de tarefa ponta a ponta.
3. Taxa de falha por provider.
4. Tempo medio de decisao de aprovacao.
5. Incidentes de policy (false allow/false deny).
