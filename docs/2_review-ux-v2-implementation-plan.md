  # Review UX v2 — Implementation Plan + Multi-Agent Checklist                                                                                                                                     
                                                                                                                                                                                                   
  ## Objetivo                                                                                                                                                                                      
  Evoluir a experiência de revisão para developers:                                                                                                                                                
  - abrir painel de review sem executar `/review`                                                                                                                                                  
  - feed de review mostrando apenas diffs + estado curto                                                                                                                                           
  - diffs renderizados com componente `DiffViewer`                                                                                                                                                 
  - auto-scroll inteligente no feed                                                                                                                                                                
  - layout docked full-area                                                                                                                                                                        
  - comentários colapsados por padrão                                                                                                                                                              
  - histórico por sessão ativa                                                                                                                                                                     
                                                                                                                                                                                                   
  ---                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 0 — Preparação e contrato (Planner + Reviewer, serial)                                                                                                                                   
  ### Responsável                                                                                                                                                                                  
  - `alicia-planner` (primário)                                                                                                                                                                    
  - `alicia-reviewer` (validação do plano)                                                                                                                                                         
                                                                                                                                                                                                   
  ### Entregáveis                                                                                                                                                                                  
  - mapeamento final de arquivos impactados                                                                                                                                                        
  - contratos de tipos/props fechados                                                                                                                                                              
  - matriz de riscos e mitigação                                                                                                                                                                   
                                                                                                                                                                                                   
  ### Checklist                                                                                                                                                                                    
  - [ ] Validar fluxo atual de abertura de review (`sidebar -> page -> review-mode`)                                                                                                               
  - [ ] Validar fluxo de mensagens (`event-handlers -> review channel -> UI`)                                                                                                                      
  - [ ] Definir `ReviewFeedItem` e função normalizadora (`buildReviewFeedItems`)                                                                                                                   
  - [ ] Definir critérios de aceite técnicos por feature                                                                                                                                           
  - [ ] Revisão de plano por `alicia-reviewer`                                                                                                                                                     
                                                                                                                                                                                                   
  ---                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 1 — Orquestração de entrada e layout base (Frontend A + Frontend B em paralelo)                                                                                                          
  ### Paralelo A (Frontend A)                                                                                                                                                                      
  **Escopo:** abertura do painel e roteamento de ações                                                                                                                                             
                                                                                                                                                                                                   
  #### Arquivos                                                                                                                                                                                    
  - `Alicia/frontend/components/alicia/sidebar.tsx`                                                                                                                                                
  - `Alicia/frontend/app/page.tsx`                                                                                                                                                                 
  - `Alicia/frontend/hooks/use-alicia-actions.ts` (apenas se necessário)                                                                                                                           
                                                                                                                                                                                                   
  #### Checklist                                                                                                                                                                                   
  - [ ] Remover execução automática de `/review` no clique do item REVIEW                                                                                                                          
  - [ ] Garantir que clique apenas abra `activePanel = "review"`                                                                                                                                   
  - [ ] Manter botão explícito `Run /review` dentro do `ReviewMode`                                                                                                                                
  - [ ] Preservar refresh de workspace changes ao abrir painel                                                                                                                                     
                                                                                                                                                                                                   
  ### Paralelo B (Frontend B)                                                                                                                                                                      
  **Escopo:** layout docked full-area                                                                                                                                                              
                                                                                                                                                                                                   
  #### Arquivos                                                                                                                                                                                    
  - `Alicia/frontend/app/page.tsx`                                                                                                                                                                 
  - `Alicia/frontend/components/alicia/review-mode.tsx`                                                                                                                                            
                                                                                                                                                                                                   
  #### Checklist                                                                                                                                                                                   
  - [ ] Remover estilo modal/overlay do `ReviewMode`                                                                                                                                               
  - [ ] Integrar `ReviewMode` como área principal docked                                                                                                                                           
  - [ ] Ajustar grid/colunas para máximo aproveitamento visual                                                                                                                                     
  - [ ] Garantir responsividade desktop/mobile (stack em breakpoints menores)                                                                                                                      
                                                                                                                                                                                                   
  ### Gate da fase                                                                                                                                                                                 
  - [ ] Abrir REVIEW não dispara `/review`                                                                                                                                                         
  - [ ] Painel ocupa área principal disponível                                                                                                                                                     
                                                                                                                                                                                                   
  ---                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 2 — Feed de review orientado a diff (Frontend C + Frontend D em paralelo)                                                                                                                
  ### Paralelo C (Frontend C)                                                                                                                                                                      
  **Escopo:** normalização/parsing para feed                                                                                                                                                       
                                                                                                                                                                                                   
  #### Arquivos                                                                                                                                                                                    
  - `Alicia/frontend/lib/alicia-runtime-helpers.ts`                                                                                                                                                
  - `Alicia/frontend/lib/alicia-types.ts` (se necessário)                                                                                                                                          
                                                                                                                                                                                                   
  #### Checklist                                                                                                                                                                                   
  - [ ] Criar tipo `ReviewFeedItem`                                                                                                                                                                
  - [ ] Criar helper `buildReviewFeedItems(messages)`                                                                                                                                              
  - [ ] Extrair apenas blocos diff/patch parseáveis                                                                                                                                                
  - [ ] Gerar item de estado curto quando não houver diff                                                                                                                                          
  - [ ] Cobrir casos com múltiplos blocos no mesmo conteúdo                                                                                                                                        
                                                                                                                                                                                                   
  ### Paralelo D (Frontend D)                                                                                                                                                                      
  **Escopo:** render do feed com `DiffViewer`                                                                                                                                                      
                                                                                                                                                                                                   
  #### Arquivos                                                                                                                                                                                    
  - `Alicia/frontend/components/alicia/review-mode.tsx`                                                                                                                                            
  - `Alicia/frontend/components/alicia/diff-viewer.tsx` (ajustes opcionais)                                                                                                                        
                                                                                                                                                                                                   
  #### Checklist                                                                                                                                                                                   
  - [ ] Renderizar feed usando `ReviewFeedItem` (não `TerminalMessage` bruto)                                                                                                                      
  - [ ] Mostrar apenas `diff + estado`                                                                                                                                                             
  - [ ] Usar `DiffViewer` em todos os diffs do feed                                                                                                                                                
  - [ ] Mostrar fallback curto `no diff` quando aplicável                                                                                                                                          
                                                                                                                                                                                                   
  ### Gate da fase                                                                                                                                                                                 
  - [ ] Feed não mostra textos longos                                                                                                                                                              
  - [ ] Diffs aparecem no `DiffViewer` no review                                                                                                                                                   
                                                                                                                                                                                                   
  ---                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 3 — UX fina: auto-scroll + comentários colapsáveis (Frontend E, paralelo interno)                                                                                                        
  ### Responsável                                                                                                                                                                                  
  - `alicia-frontend`                                                                                                                                                                              
                                                                                                                                                                                                   
  #### Arquivos                                                                                                                                                                                    
  - `Alicia/frontend/components/alicia/review-mode.tsx`                                                                                                                                            
                                                                                                                                                                                                   
  #### Checklist                                                                                                                                                                                   
  - [ ] Implementar auto-scroll “seguir só no fim”                                                                                                                                                 
  - [ ] Detectar quando usuário saiu do fim da lista                                                                                                                                               
  - [ ] Adicionar indicador “New updates” quando houver novas entradas fora da viewport                                                                                                            
  - [ ] Colapsar comentários por padrão                                                                                                                                                            
  - [ ] Expandir comentários por clique                                                                                                                                                            
  - [ ] Preservar estado de comentário por arquivo selecionado                                                                                                                                     
                                                                                                                                                                                                   
  ### Gate da fase                                                                                                                                                                                 
  - [ ] Auto-scroll respeita posição do usuário                                                                                                                                                    
  - [ ] Comentários não ocupam espaço quando vazios                                                                                                                                                
                                                                                                                                                                                                   
  ---                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 4 — Canal de mensagens e histórico por sessão (Frontend F + Reviewer em paralelo)                                                                                                        
  ### Paralelo F (Frontend F)                                                                                                                                                                      
  **Escopo:** consistência de canal review/chat e histórico por sessão                                                                                                                             
                                                                                                                                                                                                   
  #### Arquivos                                                                                                                                                                                    
  - `Alicia/frontend/lib/alicia-event-handlers.ts`                                                                                                                                                 
  - `Alicia/frontend/app/page.tsx`                                                                                                                                                                 
                                                                                                                                                                                                   
  #### Checklist                                                                                                                                                                                   
  - [ ] Manter mensagens de review no canal `review`                                                                                                                                               
  - [ ] Confirmar que chat principal não recebe conteúdo de review                                                                                                                                 
  - [ ] Exibir último review da sessão ativa ao abrir painel                                                                                                                                       
  - [ ] Troca de sessão troca histórico exibido corretamente                                                                                                                                       
                                                                                                                                                                                                   
  ### Paralelo Reviewer                                                                                                                                                                            
  - `alicia-reviewer` revisa regressões de roteamento e estado                                                                                                                                     
                                                                                                                                                                                                   
  ### Gate da fase                                                                                                                                                                                 
  - [ ] Histórico por sessão funciona                                                                                                                                                              
  - [ ] Sem vazamento de mensagens entre chat/review                                                                                                                                               
                                                                                                                                                                                                   
  ---                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 5 — Validação e hardening (Test + Reviewer, serial)                                                                                                                                      
  ### Responsável                                                                                                                                                                                  
  - `alicia-test`                                                                                                                                                                                  
  - `alicia-reviewer`                                                                                                                                                                              
                                                                                                                                                                                                   
  ### Checklist
  - [ ] `cd Alicia/frontend && pnpm exec tsc --noEmit`                                                                                                                                             
  - [ ] `cd Alicia/frontend && pnpm run build`                                                                                                                                                     
  - [ ] `cd Alicia/frontend && pnpm run lint` (ou registrar bloqueio de ambiente)                                                                                                                  
  - [ ] Testes de helper para `buildReviewFeedItems`                                                                                                                                               
  - [ ] Smoke test manual completo:                                                                                                                                                                
    - [ ] abrir REVIEW sem iniciar execução                                                                                                                                                        
    - [ ] iniciar review pelo botão                                                                                                                                                                
    - [ ] verificar feed diff-only                                                                                                                                                                 
    - [ ] verificar auto-scroll inteligente                                                                                                                                                        
    - [ ] verificar comentários colapsados                                                                                                                                                         
    - [ ] verificar histórico por sessão                                                                                                                                                           
  - [ ] Revisão final por `alicia-reviewer` (bugs/regressões/segurança)                                                                                                                            
                                                                                                                                                                                                   
  ## Sequência de execução multi-agent (resumo)
  1. `alicia-planner` (plano final)
  2. Paralelo: Frontend A + Frontend B
  3. Paralelo: Frontend C + Frontend D
  4. Frontend E
  5. Paralelo: Frontend F + Reviewer parcial
  6. `alicia-test`
  7. `alicia-reviewer` final
  8. Consolidação final (arquivos, validação, riscos remanescentes)

  ---

  ## Definição de pronto (DoD)
  - REVIEW abre sem executar `/review`
  - Botão interno executa `/review`
  - Feed mostra apenas diff + estado
  - Diffs renderizados com `DiffViewer`
  - Auto-scroll segue apenas quando usuário está no fim
  - Comentários colapsados por padrão
  - Painel docked full-area
  - Histórico por sessão ativa funcionando
  - Build/typecheck OK e revisão final sem bloqueios