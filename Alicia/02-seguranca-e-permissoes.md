# Segurança e Permissões

## Perfis de permissão
1. `read_only`
- Permite leitura e inspeção.
- Bloqueia escrita, patch e ações de rede.

2. `read_write_with_approval`
- Leitura permitida.
- Escrita, patch, comando sensível e rede exigem aprovação.

3. `full_access`
- Permite ações sem prompt por ação.
- Ainda sujeito ao limite de workspace no MVP (decisão atual).

## Regras globais no MVP
1. Bloquear ações fora do workspace para todos os perfis.
2. Registrar todas as decisões de policy em audit log.
3. Exigir confirmação explícita para ações de alto impacto quando aplicável.
4. Política de rede ativa: permitir/bloquear por regra e perfil.

## Matriz inicial de ações
Ações base:
- `read_file`
- `write_file`
- `execute_command`
- `apply_patch`
- `network_access`

Decisão por perfil:
- `read_only`: `read_file` = allow; demais = deny
- `read_write_with_approval`: `read_file` = allow; demais = require_approval
- `full_access`: allow (com restrição workspace no MVP)

## Auditoria
Formato sugerido JSONL por linha:
- timestamp
- session_id
- action_kind
- target
- profile
- policy_decision
- approval_decision (quando houver)
- result_status
- duration_ms

## Ameaças principais e mitigação
1. Execução indevida fora do projeto
- Mitigação: validação de path canônico + bloqueio por workspace.

2. Uso indevido de comandos destrutivos
- Mitigação: denylist inicial + approval gate em perfis moderados.

3. Exfiltração de dados via rede
- Mitigação: política de rede por padrão restrita e auditada.

4. Vazamento de segredo em log
- Mitigação: mascaramento de padrões sensíveis antes de persistir.

## Critérios de aceite de segurança
1. Nenhuma escrita fora do workspace em teste automatizado.
2. Toda ação sensível registra trilha completa.
3. Toda ação que exige aprovação deve falhar fechada sem decisão explícita.
