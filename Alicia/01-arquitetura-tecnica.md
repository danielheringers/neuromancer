# Arquitetura Técnica

## Visão de alto nível
Arquitetura em duas camadas:
1. Core headless (execução, política, auditoria, sessão de terminal)
2. UI egui (renderização e interação)

A UI não executa ações privilegiadas diretamente; toda ação é validada no core.

## Componentes
1. Session Manager
- Cria e mantém sessões PTY.
- Gerencia lifecycle (start/stop/reattach).
- Captura stream de saída/entrada.

2. Agent Orchestrator
- Recebe intenção do usuário.
- Converte em plano de ações.
- Solicita execução ao executor com policy check.

3. Provider Adapters
- Adapter `codex-cli`
- Adapter `claude-code`
- Contrato único de capabilities e eventos.

4. Policy Engine
- Avalia ação por perfil e regras.
- Decide: allow / require_approval / deny.
- Impede saída de workspace no MVP.

5. Approval Manager
- Fila de aprovações pendentes.
- Timeout e estado final (approved/denied/expired).

6. Audit Logger
- Registro append-only JSONL.
- Eventos de comandos, patch, decisão de policy e aprovação.

7. UI egui
- Painel terminal.
- Painel do agente.
- Fila de aprovações.
- Visualização de diff/impacto.

## Fluxo principal de execução
1. Usuário solicita tarefa ao agente.
2. Agent Orchestrator produz ação candidata.
3. Policy Engine avalia a ação.
4. Se `allow`, executor roda.
5. Se `require_approval`, Approval Manager solicita confirmação na UI.
6. Resultado e telemetria local são enviados ao Audit Logger.
7. UI atualiza timeline e estado da tarefa.

## Requisitos não funcionais
1. Baixa latência de interação terminal.
2. Estabilidade em sessões longas.
3. Consumo de memória previsível em scrollback alto.
4. Isolamento de falhas UI/Core.

## IPC sugerido (para implementação)
1. Transporte local:
- Unix Domain Socket (Linux/macOS)
- Named Pipe (Windows)

2. Mensagens tipadas:
- `ActionProposed`
- `ApprovalRequested`
- `ApprovalResolved`
- `CommandStarted`
- `CommandOutputChunk`
- `CommandFinished`
- `PatchPreviewReady`
- `PatchApplied`

## Estratégia de desempenho
1. Event loop do terminal separado do loop de componentes de UI.
2. Renderização incremental por diffs de buffer.
3. Coalescência de eventos de saída em burst.
4. Limites de frequência para repaint da UI.
