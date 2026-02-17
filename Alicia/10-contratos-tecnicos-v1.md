# AlicIA - Contratos Tecnicos v1 (Sprint 0)

## Escopo
Este documento registra o primeiro contrato tecnico versionado do AlicIA para os itens:
1. ALICIA-MVP-001 (acoes e decisoes de policy).
2. ALICIA-MVP-002 (eventos IPC tipados).
3. ALICIA-MVP-003 (bootstrap Core/UI/Adapters).

Versao do contrato:
1. Policy contract: `v1`.
2. IPC protocol version: `1`.

## Tipos de acao e decisao
Tipos de acao:
1. `read_file`
2. `write_file`
3. `execute_command`
4. `apply_patch`
5. `network_access`

Decisoes:
1. `allow`
2. `require_approval`
3. `deny`

Perfis:
1. `read_only`
2. `read_write_with_approval`
3. `full_access`

## Matriz de permissao v1
1. `read_only`:
   - `read_file`: `allow`
   - demais: `deny`
2. `read_write_with_approval`:
   - `read_file`: `allow`
   - demais: `require_approval`
3. `full_access`:
   - todas as acoes: `allow`

## Eventos IPC v1
Eventos definidos:
1. `action_proposed`
2. `approval_requested`
3. `approval_resolved`
4. `command_started`
5. `command_output_chunk`
6. `command_finished`
7. `patch_preview_ready`
8. `patch_applied`

## Fronteiras de responsabilidade
1. `codex-alicia-core`: contratos de dominio (policy + IPC) e validacoes base.
2. `codex-alicia-adapters`: contrato de providers e normalizacao de eventos.
3. `codex-alicia-ui`: armazenamento e leitura de eventos para a camada de interface.

Regra estrutural inicial:
1. A UI nao executa acao privilegiada diretamente.
2. A UI consome eventos do Core para renderizacao/decisao.
