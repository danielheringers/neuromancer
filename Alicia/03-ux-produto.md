# UX e Produto para Iniciantes

## Princípios
1. Explicar impacto antes de executar.
2. Reduzir necessidade de memorizar comandos.
3. Tornar aprovações claras e rápidas.
4. Preservar fluidez de terminal para usuários avançados.

## Fluxos essenciais
1. Rodar tarefa com agente
- Entrada em linguagem natural.
- Pré-visualização da ação planejada.
- Aprovação quando necessário.
- Resultado com próximos passos.

2. Aplicar alterações em arquivos
- Mostrar diff resumido por arquivo.
- Exibir impacto estimado.
- Permitir aprovar/rejeitar por bloco.

3. Diagnóstico de erro
- Coletar logs/comando falho automaticamente.
- Sugerir ação corretiva.
- Mostrar explicação curta e objetiva.

## Componentes de UI prioritários
1. Terminal principal.
2. Timeline da tarefa.
3. Fila de aprovações.
4. Painel de diffs.
5. Indicador de perfil de permissão ativo.

## Conteúdo mínimo em prompts de aprovação
1. O que será feito.
2. Em quais arquivos/paths.
3. Comando exato (quando houver).
4. Risco/impacto em linguagem simples.

## Métricas de UX
1. Tempo para primeira tarefa concluída.
2. Taxa de aprovação/rejeição por tipo de ação.
3. Quantidade de rollback manual após ação do agente.
4. Tempo médio para usuário entender e decidir aprovação.
