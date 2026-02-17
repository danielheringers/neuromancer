# Roadmap e Estimativas

## Linha do tempo sugerida

### Fase 0 - Preparação (1-2 semanas)
1. Definir contratos e taxonomia de ações.
2. Congelar modelo de policy e auditoria.
3. Estabelecer padrões de contribuição OSS.

### Fase 1 - Núcleo operacional (3-5 semanas)
1. Sessão terminal PTY básica.
2. Policy engine com 3 perfis.
3. Auditoria em arquivo JSONL.
4. Primeira integração com adapter de agente.

### Fase 2 - Multi-provider (2-3 semanas)
1. Adapter `codex-cli`.
2. Adapter `claude-code`.
3. Contrato comum de eventos e erros.

### Fase 3 - UI egui funcional (3-5 semanas)
1. Terminal view integrada.
2. Fila de aprovação funcional.
3. Timeline de ações.
4. Preview de diff simplificado.

### Fase 4 - Hardening v1 (5-8 semanas)
1. Testes cross-platform.
2. Profile/performance tuning.
3. Empacotamento e documentação.
4. Modelo de governança OSS.

## Estimativas consolidadas
1. MVP funcional: 6-10 semanas.
2. v1 open source robusta: 14-22 semanas totais.
3. Maturidade avançada tipo produto líder: 9-15 meses.

## Dependências críticas
1. Qualidade dos adapters dos CLIs externos.
2. Comportamento de PTY no Windows/ConPTY.
3. Escopo da UX além do essencial.

## Marco de Go/No-Go para liberar MVP
1. Política de segurança testada e estável.
2. Fluxo de aprovação completo.
3. Operação consistente em 3 sistemas operacionais.
