# Plano de Entrega Open Source

## Governança inicial
1. Licença Apache-2.0 no repositório.
2. `CONTRIBUTING.md` com fluxo de PR e revisão.
3. `CODE_OF_CONDUCT.md`.
4. Template de issue para bug/feature.

## Estratégia de releases
1. Tag semanal para preview (`v0.1.x-alpha`).
2. Release candidata após estabilidade do MVP.
3. Release `v1.0.0` após hardening cross-platform.

## Qualidade para release MVP
1. Build reproduzível em 3 SO.
2. Testes de política e aprovação passando.
3. Documentação de instalação e troubleshooting.
4. Exemplo de workflow completo em vídeo/GIF (opcional).
5. Fluxo E2E feliz + negação/expiração validado em CI.

Guia operacional detalhado:
1. `Alicia/12-guia-mvp-instalacao-troubleshooting-checklist.md`

## Checklist pré-release
1. Verificar regressão de performance.
2. Validar logs sem dados sensíveis.
3. Testar bloqueio fora do workspace.
4. Revisar changelog.
5. Confirmar compatibilidade mínima dos adapters.
6. Confirmar `alicia-ci` verde nos jobs `suite_minima`, `policy_approval_scenarios` e `e2e_flow` em Windows/macOS/Linux.
