  ## Exec Plan Operacional — Review UX v2 (Multi-Agents)                                                                                                                                           
                                                                                                                                                                                                   
  ### Resumo                                                                                                                                                                                       
                                                                                                                                                                                                   
  Plano executável para implementação em fases com agentes paralelos, incluindo prompts prontos, critérios de aprovação por fase e política de merge incremental sem decisões abertas.             
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Regras de execução                                                                                                                                                                            
                                                                                                                                                                                                   
  1. Cada agente altera somente arquivos do próprio escopo.                                                                                                                                        
  2. Merge por fase: só avança após passar nos critérios da fase.                                                                                                                                  
  3. Conflitos entre agentes: prioridade para quem “dono” do arquivo na fase.                                                                                                                      
  4. Sempre rodar validação mínima ao fim de cada fase.                                                                                                                                            
  5. Revisor técnico roda em checkpoints (fase 2 e fase final).                                                                                                                                    
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 0 — Planejamento técnico fechado (serial)                                                                                                                                                
                                                                                                                                                                                                   
  ### Spawn                                                                                                                                                                                        
                                                                                                                                                                                                   
  - alicia-planner                                                                                                                                                                                 
  - alicia-reviewer                                                                                                                                                                                
                                                                                                                                                                                                   
  ### Prompt (planner)                                                                                                                                                                             
                                                                                                                                                                                                   
  “Mapeie os arquivos de Review UX v2, riscos de regressão, e checklist de validação por fase para: abertura sem /review, layout docked full-area, feed diff-only, auto-scroll inteligente,        
  comentários colapsados e histórico por sessão.”                                                                                                                                                  
                                                                                                                                                                                                   
  ### Critério de saída                                                                                                                                                                            
                                                                                                                                                                                                   
  - Lista final de arquivos + riscos + checklist aprovados pelo reviewer.                                                                                                                          
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 1 — Entrada + layout base (paralelo)                                                                                                                                                     
                                                                                                                                                                                                   
  ### Agente A (entrada do fluxo)                                                                                                                                                                  
                                                                                                                                                                                                   
  - Tipo: alicia-frontend                                                                                                                                                                          
  - Escopo:                                                                                                                                                                                        
      - Alicia/frontend/components/alicia/sidebar.tsx                                                                                                                                              
      - Alicia/frontend/app/page.tsx                                                                                                                                                               
  - Prompt:                                                                                                                                                                                        
    “Remova auto-disparo de /review no clique da sidebar; clique apenas abre activePanel=review e refresh de changes. Mantenha botão ‘Run /review’ no painel.”                                     
                                                                                                                                                                                                   
  ### Agente B (layout docked)                                                                                                                                                                     
                                                                                                                                                                                                   
  - Tipo: alicia-frontend                                                                                                                                                                          
  - Escopo:                                                                                                                                                                                        
      - Alicia/frontend/app/page.tsx                                                                                                                                                               
      - Alicia/frontend/components/alicia/review-mode.tsx                                                                                                                                          
  - Prompt:                                                                                                                                                                                        
    “Refatore ReviewMode de modal para docked full-area no conteúdo principal, maximizando área de diff e mantendo ações de approve/reject/commit.”                                                
                                                                                                                                                                                                   
  ### Critérios                                                                                                                                                                                    
                                                                                                                                                                                                   
  - Clique em REVIEW não inicia review.                                                                                                                                                            
  - Painel abre docked e ocupa área principal.                                                                                                                                                     
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 2 — Feed diff-only + DiffViewer (paralelo)                                                                                                                                               
                                                                                                                                                                                                   
  ### Agente C (normalização de feed)                                                                                                                                                              
                                                                                                                                                                                                   
  - Tipo: alicia-frontend                                                                                                                                                                          
  - Escopo:                                                                                                                                                                                        
      - Alicia/frontend/lib/alicia-runtime-helpers.ts                                                                                                                                              
  - Prompt:                                                                                                                                                                                        
    “Crie ReviewFeedItem + buildReviewFeedItems(messages) para extrair apenas blocos diff/patch parseáveis e estados curtos.”                                                                      
                                                                                                                                                                                                   
  ### Agente D (render de feed)                                                                                                                                                                    
                                                                                                                                                                                                   
  - Tipo: alicia-frontend                                                                                                                                                                          
  - Escopo:                                                                                                                                                                                        
      - Alicia/frontend/components/alicia/review-mode.tsx                                                                                                                                          
  - Prompt:                                                                                                                                                                                        
    “Substitua render atual de mensagens por feed dedicado diff-only. Todo diff deve usar DiffViewer; texto longo não deve aparecer.”                                                              
                                                                                                                                                                                                   
  ### Checkpoint reviewer                                                                                                                                                                          
                                                                                                                                                                                                   
  - Tipo: alicia-reviewer                                                                                                                                                                          
  - Prompt:                                                                                                                                                                                        
    “Validar se feed mostra somente diff+estado e se DiffViewer é usado em todos os diffs.”                                                                                                        
                                                                                                                                                                                                   
  ### Critérios                                                                                                                                                                                    
                                                                                                                                                                                                   
  - Feed sem mensagens longas.                                                                                                                                                                     
  - Diffs do review renderizados por DiffViewer.                                                                                                                                                   
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 3 — UX fina (serial curto)                                                                                                                                                               
                                                                                                                                                                                                   
  ### Agente E                                                                                                                                                                                     
                                                                                                                                                                                                   
  - Tipo: alicia-frontend                                                                                                                                                                          
  - Escopo:                                                                                                                                                                                        
      - Alicia/frontend/components/alicia/review-mode.tsx                                                                                                                                          
  - Prompt:                                                                                                                                                                                        
    “Implemente auto-scroll ‘seguir só no fim’ e indicador de novas entradas quando usuário estiver fora do fim; comentários colapsados por padrão.”                                               
                                                                                                                                                                                                   
  ### Critérios                                                                                                                                                                                    
                                                                                                                                                                                                   
  - Auto-scroll não rouba posição ao revisar histórico.                                                                                                                                            
  - Comentários não ocupam área quando vazios.                                                                                                                                                     
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 4 — Sessão/histórico e consistência de canal (paralelo)                                                                                                                                  
                                                                                                                                                                                                   
  ### Agente F                                                                                                                                                                                     
                                                                                                                                                                                                   
  - Tipo: alicia-frontend                                                                                                                                                                          
  - Escopo:                                                                                                                                                                                        
      - Alicia/frontend/lib/alicia-event-handlers.ts                                                                                                                                               
      - Alicia/frontend/app/page.tsx                                                                                                                                                               
  - Prompt:                                                                                                                                                                                        
    “Garantir histórico de review por sessão ativa e isolamento chat/review sem vazamento de mensagens.”                                                                                           
                                                                                                                                                                                                   
  ### Reviewer parcial                                                                                                                                                                             
                                                                                                                                                                                                   
  - Tipo: alicia-reviewer                                                                                                                                                                          
  - Prompt:                                                                                                                                                                                        
    “Revisar regressões de roteamento de canal e troca de sessão.”                                                                                                                                 
                                                                                                                                                                                                   
  ### Critérios                                                                                                                                                                                    
                                                                                                                                                                                                   
  - Abrir review sem rodar comando mostra último review da sessão ativa.                                                                                                                           
  - Mensagens de review não aparecem no chat principal.                                                                                                                                            
                                                                                                                                                                                                   
  ———                                                                                                                                                                                              
                                                                                                                                                                                                   
  ## Fase 5 — Testes e aprovação final (serial)                                                                                                                                                    
                                                                                                                                                                                                   
  ### Agente Test                                                                                                                                                                                  
                                                                                                                                                                                                   
  - Tipo: alicia-test                                                                                                                                                                              
  - Prompt:                                                                                                                                                                                        
    “Rodar pnpm exec tsc --noEmit, pnpm run build, pnpm run lint (reportar bloqueio de ambiente), e smoke do fluxo review.”                                                                        
                                                                                                                                                                                                   
  ### Agente Reviewer final                                                                                                                                                                        
                                                                                                                                                                                                   
  - Tipo: alicia-reviewer                                                                                                                                                                          
  - Prompt:                                                                                                                                                                                        
    “Revisão final de bugs/regressões/risco funcional na Review UX v2.”                                                                                                                            
                                                                                                                                                                                                   
  ### Critérios finais (DoD)                                                                                                                                                                       
                                                                                                                                                                                                   
  - REVIEW abre sem iniciar execução.                                                                                                                                                              
  - Botão interno inicia review.                                                                                                                                                                   
  - Feed = somente diff + estado curto.                                                                                                                                                            
  - Diffs no review usam DiffViewer.                                                                                                                                                               
  - Auto-scroll inteligente aplicado.                                                                                                                                                              
  - Build/typecheck ok; reviewer sem bloqueio crítico.
  ———

  ## Checklist operacional rápida (para acompanhar execução)

  - [x] F0 concluída e aprovada
  - [x] F1 A concluída
  - [x] F1 B concluída
  - [x] Gate F1 aprovado
  - [x] F2 C concluída
  - [x] F2 D concluída
  - [x] Checkpoint reviewer F2 aprovado
  - [x] F3 E concluída
  - [x] Gate F3 aprovado
  - [x] F4 F concluída
  - [x] Checkpoint reviewer F4 aprovado
  - [x] Testes F5 executados
  - [x] Reviewer final aprovado
  - [x] Consolidação final entregue (arquivos, validações, riscos)

  ## Registro de execução (2026-02-21)

  - F0 concluída: planner + reviewer definiram riscos e checklist fechado.
  - F1 concluída: clique em `REVIEW` abre painel sem disparar `/review`; `Run /review` ficou como ação explícita no painel.
  - F2 concluída: feed de review ficou diff-only e toda renderização de diff usa `DiffViewer`.
  - F3 concluída: auto-scroll inteligente implementado (segue no fim, com contador de novas entradas fora do fim) e comentários colapsados por padrão.
  - F4 concluída: histórico de review separado por sessão ativa e isolamento chat/review mantido.
  - Ajustes de corretude pós-review: expansão de paths para rename/copy com `fromPath`, bloqueio de commit quando há `unmerged` no workspace, classificação completa de conflitos git (`DD`, `AA`, `UU`, etc.), e exigência de sessão ativa para comandos git de review.
  - Validações executadas: `pnpm exec tsc --noEmit` (ok), `pnpm run build` (ok), `cargo test` (ok), `pnpm run lint` (falha por ambiente: `eslint` indisponível).

  ## Assunções travadas

  - Feed de review = Only diffs.
  - Layout = Tela inteira docked.
  - Comentários = Colapsada por padrão.
  - Auto-scroll = Seguir só no fim.
  - Histórico = Sessão atual.
