# Infraestrutura Tauri backend para bridge com Codex CLI (ALICIA-MVP-013/015)

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` updated as work proceeds.

This plan follows `.agent/PLANS.md` from repository root.

## Purpose / Big Picture

Criar a base `src-tauri` em `Alicia/egui-rust-integration` para integrar a UI com `codex` via comandos Tauri estaveis. O comportamento observavel apos este trabalho sera: iniciar sessao interativa, enviar input, parar sessao, executar comando one-shot, abrir seletor nativo de imagem e expor snapshot estatico de ajuda de comandos.

## Progress

- [x] (2026-02-18 18:01Z) Pedido mapeado e escopo tecnico confirmado no app `Alicia/egui-rust-integration`.
- [x] (2026-02-18 18:01Z) Mapeados IDs de backlog relacionados: `ALICIA-MVP-013` (adapter codex-cli) e `ALICIA-MVP-015` (terminal integrado).
- [x] (2026-02-18 18:06Z) Estrutura `src-tauri` criada com `Cargo.toml`, `build.rs`, `tauri.conf.json` e `src/main.rs`.
- [x] (2026-02-18 18:09Z) Implementados os 6 comandos Tauri com estado global protegido por `Mutex` e emissao de eventos `codex://stdout`, `codex://stderr`, `codex://lifecycle`.
- [x] (2026-02-18 18:14Z) Integracao minima de package ajustada (`tauri:dev`, `tauri:build`, `@tauri-apps/cli`) e assets minimos para build Tauri no Windows (`src-tauri/icons/icon.ico`, `dist/index.html`).
- [ ] (2026-02-18 18:15Z) Validacao local parcial (concluido: `cargo check`; restante: `cargo fmt` bloqueado por ausencia de `rustfmt` no host).
- [x] (2026-02-18 18:15Z) Secoes vivas atualizadas com resultados, evidencias e limitacoes.
- [x] (2026-02-18 18:24Z) Backend expandido com `update_codex_config` e `pick_mention_file`; defaults de runtime agora alimentam `start_codex_session` quando args nao sao enviados.
- [x] (2026-02-18 18:24Z) Build integrado `pnpm tauri build --debug` concluido com sucesso e `frontendDist` migrado para `../out` com `next output=export`.

## Surprises & Discoveries

- Observation: O projeto `Alicia/egui-rust-integration` ainda nao tinha nenhuma infraestrutura Tauri.
  Evidence: busca por `tauri`, `src-tauri` e `tauri.conf.json` retornou sem matches.

- Observation: `cargo fmt` nao pode ser executado neste host porque o componente `rustfmt` nao esta instalado para a toolchain `stable-x86_64-pc-windows-msvc`.
  Evidence: `cargo fmt` retornou `cargo-fmt.exe is not installed for the toolchain`.

- Observation: `tauri-build` no Windows exige `src-tauri/icons/icon.ico` durante compilacao, mesmo com `bundle.active=false`.
  Evidence: primeiro `cargo check` falhou com `icons/icon.ico not found`.

- Observation: usar `frontendDist: ../` fez o macro `generate_context!` tentar ler arquivo lock em `src-tauri/target` e falhar por lock de processo.
  Evidence: erro `failed to read asset ... target/debug/.cargo-lock ... os error 33`.

## Decision Log

- Decision: Implementar backend com Tauri v2 e dialogo nativo via crate `rfd` para reduzir dependencia de plugin adicional.
  Rationale: Mantem setup minimo e atende ao requisito de seletor nativo de imagem sem ampliar superficie de configuracao.
  Date/Author: 2026-02-18 / Codex

- Decision: Tratar estado de sessao ativa com `State<AppState>` + `Mutex<Option<ActiveSession>>` + `session_id` monotonic.
  Rationale: Garante sincronizacao clara para start/send/stop e evita que watcher antigo limpe sessao nova.
  Date/Author: 2026-02-18 / Codex

## Outcomes & Retrospective

Infraestrutura backend Tauri concluida no escopo solicitado: crate `src-tauri` criado, comandos de sessao/one-shot/file-picker/help expostos, eventos de stdout/stderr/lifecycle implementados e sincronizacao por `Mutex`/`State` com `session_id` para evitar limpeza indevida de sessoes. O backend agora tambem recebe atualizacao de configuracao em runtime (`update_codex_config`) e permite marcar arquivos para mencao (`pick_mention_file`). Validacoes passaram com `cargo check` e build integrado `pnpm tauri build --debug`.

## Context and Orientation

Escopo de edicao fica apenas em `Alicia/egui-rust-integration` e no plano em `Alicia/execplans`. Este app atualmente e Next.js puro, sem `src-tauri`. O backend a ser criado deve conversar com executavel `codex` local via `std::process::Command`.

Arquivos-alvo previstos:
- `Alicia/egui-rust-integration/src-tauri/Cargo.toml`
- `Alicia/egui-rust-integration/src-tauri/build.rs`
- `Alicia/egui-rust-integration/src-tauri/src/main.rs`
- `Alicia/egui-rust-integration/src-tauri/tauri.conf.json`

## Plan of Work

Primeiro montar o crate Tauri minimo com build script e config. Depois implementar comandos e modelos de payload com foco em contrato simples e robustez de concorrencia. Em seguida validar formatacao/compilacao local e registrar limites operacionais (por exemplo dependencia do binario `codex` no PATH).

## Concrete Steps

Working directory: `C:\Users\danie\OneDrive\Documentos\Projetos\Neuromancer`

1. Criar estrutura de arquivos do backend Tauri.

    New-Item -ItemType Directory Alicia/egui-rust-integration/src-tauri/src -Force

   Expected: pasta `src-tauri/src` existente.

2. Implementar entrypoint e comandos.

    # editar src/main.rs, Cargo.toml, tauri.conf.json e build.rs

   Expected: `tauri::Builder` com `invoke_handler` para os 6 comandos.

3. Validar Rust crate.

    cd Alicia/egui-rust-integration/src-tauri
    cargo fmt
    cargo check

   Expected: formatacao aplicada e compilacao sem erros.

4. Atualizar plano e reportar entrega.

    # atualizar secoes Progress/Outcomes/Artifacts

   Expected: plano com status final, evidencias e limites.

## Validation and Acceptance

Criterios de aceite para este escopo:
1. Existe `src-tauri` com os arquivos minimos e crate Tauri compilavel.
2. Comandos `start_codex_session`, `send_codex_input`, `stop_codex_session`, `run_codex_command`, `pick_image_file`, `codex_help_snapshot` estao expostos via `invoke_handler`.
3. Eventos `codex://stdout`, `codex://stderr`, `codex://lifecycle` sao emitidos a partir da sessao interativa.
4. Estado da sessao ativa usa sincronizacao segura (`Mutex`/`State`) sem parser complexo.

## Idempotence and Recovery

A criacao de arquivos e idempotente quando repetida com overwrite controlado. Em caso de erro de compilacao, corrigir apenas o arquivo afetado e rerodar `cargo check`. Nao usar comandos destrutivos de git; manter mudancas locais paralelas intactas.

## Artifacts and Notes

Evidencia inicial de baseline:
- `rg` sem resultados para `tauri` em `Alicia/egui-rust-integration`.
- `Alicia/13-ui-command-config-matrix.md` usado como fonte para `codex_help_snapshot`.

Evidencias de implementacao/validacao:
- `cargo check` em `Alicia/egui-rust-integration/src-tauri` finalizou com sucesso.
- `pnpm tauri build --debug` em `Alicia/egui-rust-integration` gerou executavel em `src-tauri/target/debug/alicia-egui-tauri-backend.exe`.
- Ajustes de build aplicados: `src-tauri/icons/icon.ico`, `next.config.mjs` com `output: "export"` e `frontendDist` em `../out`.

## Interfaces and Dependencies

Interfaces finais esperadas no backend:
- `start_codex_session(config) -> { session_id, pid }`
- `send_codex_input(text) -> ()`
- `stop_codex_session() -> ()`
- `run_codex_command(args, cwd?) -> { stdout, stderr, status, success }`
- `pick_image_file() -> string | null`
- `codex_help_snapshot() -> json`

Dependencias Rust previstas:
- `tauri`
- `serde`
- `rfd`

Update note (2026-02-18 18:01Z): Plano criado para implementar infraestrutura `src-tauri` com contrato minimo de sessao/command bridge para codex CLI.
Update note (2026-02-18 18:15Z): Plano atualizado com implementacao concluida, validacao de compilacao (`cargo check`) e limitacao de ambiente identificada (`rustfmt` ausente).
Update note (2026-02-18 18:24Z): Plano revisado para refletir expansao do contrato (`update_codex_config` e `pick_mention_file`) e validacao integrada do app desktop (`pnpm tauri build --debug`).
