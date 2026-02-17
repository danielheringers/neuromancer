# Riscos e Mitigações

## Risco 1 - Instabilidade cross-platform de terminal
Probabilidade: alta
Impacto: alto
Mitigação:
1. Matriz de testes por SO desde o primeiro sprint.
2. Cenários long-running e TUI na suíte de integração.

## Risco 2 - Mudanças de comportamento em CLIs externos
Probabilidade: média
Impacto: alto
Mitigação:
1. Isolar integração por adapters.
2. Testes de contrato por versão suportada.
3. Modo degradação com mensagens claras ao usuário.

## Risco 3 - UX de aprovação cansativa
Probabilidade: alta
Impacto: médio
Mitigação:
1. Agrupamento de ações relacionadas.
2. Templates de política por projeto.
3. Resumo claro de impacto para reduzir dúvida.

## Risco 4 - Vazamento de segredos em logs
Probabilidade: média
Impacto: alto
Mitigação:
1. Filtro/máscara em pipeline de log.
2. Testes de redaction.
3. Política de retenção e limpeza de logs.

## Risco 5 - Degradação de performance com UI rica
Probabilidade: média
Impacto: alto
Mitigação:
1. Orçamento de frame e profiling contínuo.
2. Render incremental.
3. Separação rigorosa entre core e UI.

## Risco 6 - Escopo crescer sem controle
Probabilidade: alta
Impacto: médio
Mitigação:
1. Backlog priorizado por valor/risco.
2. Gate de escopo por marco.
3. Critérios de aceite objetivos por fase.
