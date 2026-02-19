# Alicia (Tauri)

Estrutura do projeto:

- `frontend/`: UI Next.js
- `backend/`: runtime Tauri (Rust)

## Rodar em desenvolvimento (frontend + backend conectados)

No diretório `alicia/`:

```powershell
pnpm run setup
pnpm run dev
```

Isso inicia:

- Next.js em `http://localhost:3000`
- Runtime Rust/Tauri do `backend/`
- Janela desktop da Alicia conectada ao backend via Tauri IPC

## Build desktop

No diretório `alicia/`:

```powershell
pnpm run build
```
