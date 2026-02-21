  ## Review UX v2 (AlicIA) — Plano de implementação orientado a dev                                                                                                                                
                                                                                                                                                                                                   
  ### Resumo                                                                                                                                                                                       
                                                                                                                                                                                                   
  Vamos evoluir a funcionalidade de review para uma experiência de engenharia mais útil no dia a dia:                                                                                              
                                                                                                                                                                                                   
  1. abrir review sem disparar execução,                                                                                                                                                           
  2. exibir feed focado em diff (com status mínimo),                                                                                                                                               
  3. usar auto-scroll inteligente,                                                                                                                                                                 
  4. maximizar área útil da tela (modo docked full area),                                                                                                                                          
  5. reduzir ruído visual (comentários colapsados),                                                                                                                                                
  6. garantir que os diffs sejam sempre renderizados pelo componente de diff.                                                                                                                      
                                                                                                                                                                                                   
  Decisões fechadas:                                                                                                                                                                               
                                                                                                                                                                                                   
  - Feed: only diffs + estado                                                                                                                                                                      
  - Layout: tela inteira docked                                                                                                                                                                    
  - Comentários: colapsada por padrão                                                                                                                                                              
  - Auto-scroll: seguir só no fim                                                                                                                                                                  
  - Histórico: sessão atual                                                                                                                                                                        
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Escopo funcional                                                                                                                                                                              
                                                                                                                                                                                                   
  ### 1) Abrir review sem iniciar /review                                                                                                                                                          
                                                                                                                                                                                                   
  - Clique no item REVIEW da sidebar:                                                                                                                                                              
      - apenas define activePanel = "review"                                                                                                                                                       
      - atualiza workspace changes                                                                                                                                                                 
      - não executa handleSlashCommand("/review")                                                                                                                                                  
  - Dentro do ReviewMode, botão explícito Run /review mantém o disparo manual.                                                                                                                     
                                                                                                                                                                                                   
  ### 2) Review ocupa toda área disponível (docked, não modal)                                                                                                                                     
                                                                                                                                                                                                   
  - ReviewMode deixa de usar overlay/modal central.                                                                                                                                                
  - Renderiza como painel principal dentro da área de conteúdo (mesma região onde hoje está conversa + terminal).                                                                                  
  - Estrutura proposta:                                                                                                                                                                            
      - coluna esquerda: arquivos alterados (com status)                                                                                                                                           
      - coluna direita superior: Review feed (diffs + estado)                                                                                                                                      
      - coluna direita inferior: Arquivo selecionado com diff completo + ações de approve/reject                                                                                                   
      - barra inferior: commit message + commit approved                                                                                                                                           
  - Resulta em mais linhas visíveis de diff e menos compactação da UI.                                                                                                                             
                                                                                                                                                                                                   
  ### 3) Feed de review: apenas diffs + estado                                                                                                                                                     
                                                                                                                                                                                                   
  - No canal de review, ocultar mensagens narrativas longas.                                                                                                                                       
  - Exibir:                                                                                                                                                                                        
      - blocos de diff via DiffViewer                                                                                                                                                              
      - estado mínimo (running, completed, failed, no diff)                                                                                                                                        
  - Estratégia:                                                                                                                                                                                    
      - criar parser/normalizador de mensagens de review para extrair DiffFileView[]                                                                                                               
      - quando houver diff no conteúdo do agente, renderiza DiffViewer                                                                                                                             
      - quando não houver diff, renderiza somente linha de estado curta (não texto completo da mensagem)                                                                                           
                                                                                                                                                                                                   
  ### 4) Garantir uso do componente de diff no review                                                                                                                                              
                                                                                                                                                                                                   
  - Não reutilizar TerminalMessage bruto para o feed de review.                                                                                                                                    
  - Criar renderer dedicado no ReviewMode:                                                                                                                                                         
      - ReviewFeedItem (estado)                                                                                                                                                                    
      - ReviewDiffBlock (usa DiffViewer)                                                                                                                                                           
  - Fonte de verdade do parsing:                                                                                                                                                                   
      - parseAgentDiffMarkdownSegments                                                                                                                                                             
      - fallback para turnDiffFiles quando aplicável ao último turn/review ativo                                                                                                                   
                                                                                                                                                                                                   
  ### 5) Auto-scroll inteligente no feed                                                                                                                                                           
                                                                                                                                                                                                   
  - Implementar regra “seguir só no fim”:                                                                                                                                                          
      - se usuário está próximo do fundo, novas entradas rolam para baixo automaticamente                                                                                                          
      - se usuário subiu para revisar histórico, não forçar scroll                                                                                                                                 
  - Adicionar indicador discreto New updates quando novas entradas chegam fora da viewport.                                                                                                        
                                                                                                                                                                                                   
  ### 6) Comentários colapsados por padrão                                                                                                                                                         
                                                                                                                                                                                                   
  - Seção de comentários inicia colapsada.                                                                                                                                                         
  - Cabeçalho mostra contador (Comments (0|n)).                                                                                                                                                    
  - Expande por clique.                                                                                                                                                                            
  - Manter estado por arquivo selecionado (ou global simples, conforme implementação mais estável).                                                                                                
                                                                                                                                                                                                   
  ### 7) Histórico por sessão ativa                                                                                                                                                                
                                                                                                                                                                                                   
  - Manter reviewMessages segregado por sessão/thread ativo.                                                                                                                                       
  - Troca de sessão atualiza histórico exibido para aquele contexto.                                                                                                                               
  - Abrir review sem rodar novo comando mostra o último review daquela sessão.                                                                                                                     
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Mudanças em APIs/interfaces/tipos                                                                                                                                                             
                                                                                                                                                                                                   
  ### Frontend (tipos e props)                                                                                                                                                                     
                                                                                                                                                                                                   
  1. SidebarProps                                                                                                                                                                                  
                                                                                                                                                                                                   
  - manter onStartReview, mas comportamento muda para “abrir painel apenas”.                                                                                                                       
                                                                                                                                                                                                   
  2. ReviewModeProps                                                                                                                                                                               
                                                                                                                                                                                                   
  - adicionar estrutura de feed já normalizada ou utilitários para normalizar internamente:                                                                                                        
      - reviewMessages: Message[] (já existe)                                                                                                                                                      
      - isReviewThinking: boolean (já existe)                                                                                                                                                      
      - onRunReview: () => void (já existe)                                                                                                                                                        
  - incluir prop opcional para estado de novas entradas:                                                                                                                                           
      - hasUnreadReviewUpdates?: boolean (novo, se necessário)                                                                                                                                     
                                                                                                                                                                                                   
  3. Message/helpers (sem breaking externo)                                                                                                                                                        
                                                                                                                                                                                                   
  - manter canal chat | review.                                                                                                                                                                    
  - adicionar helper novo:                                                                                                                                                                         
      - buildReviewFeedItems(messages: Message[]): ReviewFeedItem[]                                                                                                                                
  - novo tipo:                                                                                                                                                                                     
      - ReviewFeedItem = { id, kind: "diff" | "status", files?: DiffFileView[], statusText?: string, timestamp }                                                                                   
                                                                                                                                                                                                   
  ### Comportamento/eventos                                                                                                                                                                        
                                                                                                                                                                                                   
  - createCodexEventHandler:                                                                                                                                                                       
      - preservar roteamento para canal review.                                                                                                                                                    
      - adicionar mapeamento de estados curtos no contexto review (started/completed/failed) para feed.                                                                                            
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Arquivos-alvo (implementação)                                                                                                                                                                 
                                                                                                                                                                                                   
  ### Ajustes de abertura/fluxo                                                                                                                                                                    
                                                                                                                                                                                                   
  - Alicia/frontend/app/page.tsx                                                                                                                                                                   
      - remover disparo automático /review em onStartReview                                                                                                                                        
      - mover ReviewMode para render docked no layout principal                                                                                                                                    
      - manter onRunReview como gatilho explícito                                                                                                                                                  
  - Alicia/frontend/components/alicia/sidebar.tsx                                                                                                                                                  
      - manter botão REVIEW ativável sem auto-execução                                                                                                                                             
                                                                                                                                                                                                   
  ### UI de review                                                                                                                                                                                 
                                                                                                                                                                                                   
  - Alicia/frontend/components/alicia/review-mode.tsx                                                                                                                                              
      - refatorar layout para full-area docked                                                                                                                                                     
      - implementar feed dedicado (diff + estado)                                                                                                                                                  
      - auto-scroll inteligente                                                                                                                                                                    
      - comentários colapsáveis                                                                                                                                                                    
  - Alicia/frontend/components/alicia/diff-viewer.tsx                                                                                                                                              
      - validar uso no feed e no arquivo selecionado (sem alteração visual obrigatória)                                                                                                            
                                                                                                                                                                                                   
  ### Parsing/normalização                                                                                                                                                                         
                                                                                                                                                                                                   
  - Alicia/frontend/lib/alicia-runtime-helpers.ts                                                                                                                                                  
      - adicionar buildReviewFeedItems + tipos de feed                                                                                                                                             
      - reforçar parsing de blocos diff / patch para review                                                                                                                                        
                                                                                                                                                                                                   
  ### Eventos/review channel                                                                                                                                                                       
                                                                                                                                                                                                   
  - Alicia/frontend/lib/alicia-event-handlers.ts                                                                                                                                                   
      - garantir emissão de eventos de estado curtos para review                                                                                                                                   
      - manter separação chat/review sem duplicação                                                                                                                                                
                                                                                                                                                                                                   
  ### (Opcional, se necessário)                                                                                                                                                                    
                                                                                                                                                                                                   
  - Alicia/frontend/hooks/use-alicia-actions.ts                                                                                                                                                    
      - pequenos ajustes para manter consistência de thinking/status sem poluir feed                                                                                                               
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Critérios de aceite                                                                                                                                                                           
                                                                                                                                                                                                   
  1. Clique em REVIEW abre painel, não executa /review.                                                                                                                                            
  2. Botão Run /review dentro do painel executa review.                                                                                                                                            
  3. Feed mostra apenas:                                                                                                                                                                           
                                                                                                                                                                                                   
  - diffs via DiffViewer                                                                                                                                                                           
  - estados curtos (running/completed/failed)                                                                                                                                                      
                                                                                                                                                                                                   
  4. Mensagens textuais longas de review não aparecem no feed.                                                                                                                                     
  5. Auto-scroll:                                                                                                                                                                                  
                                                                                                                                                                                                   
  - acompanha novas entradas quando usuário está no fim                                                                                                                                            
  - não forçado quando usuário rolou para cima                                                                                                                                                     
                                                                                                                                                                                                   
  6. Layout docked ocupa área principal disponível e melhora legibilidade dos diffs.                                                                                                               
  7. Comentários começam colapsados e não consomem altura desnecessária.                                                                                                                           
  8. Abrindo review sem novo comando mostra histórico da sessão atual.                                                                                                                             
  9. Diff do review é renderizado no componente de diff também durante review run (não só no chat principal).                                                                                      
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Plano de testes                                                                                                                                                                               
                                                                                                                                                                                                   
  ### Unitários (helpers)                                                                                                                                                                          
                                                                                                                                                                                                   
  - buildReviewFeedItems:                                                                                                                                                                          
      - extrai blocos diff/patch corretamente                                                                                                                                                      
      - gera status quando não há diff                                                                                                                                                             
      - ignora ruído textual longo                                                                                                                                                                 
  - parseAgentDiffMarkdownSegments:                                                                                                                                                                
      - múltiplos blocos no mesmo texto                                                                                                                                                            
      - bloco inválido sem diff parseável                                                                                                                                                          
                                                                                                                                                                                                   
  ### Integração de UI (React)                                                                                                                                                                     
                                                                                                                                                                                                   
  - ReviewMode:                                                                                                                                                                                    
      - render docked                                                                                                                                                                              
      - auto-scroll inteligente com cenário “user scrolled up”
  ### Fluxo E2E manual
  2. Rodar /review: feed recebe estados + diffs.
  3. Confirmar ausência de mensagens longas no feed.
  4. Aprovar/reprovar arquivos e validar commit approved.
  5. Trocar sessão e verificar histórico isolado por sessão.

  ———

  ## Melhorias adicionais recomendadas (fase 2)

  1. Filtro do feed por arquivo selecionado (mostrar somente diffs do arquivo ativo).
  2. Navegação entre hunks (next/prev hunk) com atalhos de teclado.
  3. “Focus mode” para diff (esconde lista lateral temporariamente).
  4. Export de review summary (aprovados/rejeitados/comentários) em markdown.
  5. Indicador de cobertura de review (% arquivos revisados com comentário).

  ———

  ## Assumptions e defaults adotados

  - Feed do review prioriza produtividade de dev: diffs primeiro, logs detalhados fora do caminho principal.
  - Histórico exibido é da sessão ativa; não haverá persistência global entre sessões.
  - Estados curtos no feed são suficientes para diagnóstico rápido; logs extensos podem continuar no canal principal/sistema, mas não no feed visual de review.
  - Layout docked full-area é preferível ao modal para revisão de código em diffs longos.