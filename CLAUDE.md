# CLAUDE.md

## Project Overview

Rootstock is a homelab infrastructure management tool. It provides a web GUI over declarative IaC (Terraform + Ansible) to manage Proxmox VMs and Docker containers. See [architecture.md](architecture.md) for the full architecture reference.

## Quick Reference

- **Backend**: `backend/app/` -- FastAPI (Python 3.12)
- **Frontend**: `frontend/src/` -- React 18 + TypeScript + Vite
- **Managed repo**: mounted at `/homelab` inside the container (YAML files, secrets.enc, terraform state)
- **No CSS framework** -- all frontend styles are inline React `CSSProperties`

## Running

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

For development with LAN access (Proxmox, SSH to hosts), add a `compose.override.yml` with `network_mode: host` on the backend.

## Code Patterns

### Backend

- **Store pattern**: Each entity (VM, container, node, etc.) has a `*Store` class in `services/` that reads/writes YAML files in the homelab repo
- **Router -> Service -> Store**: Routers handle HTTP, services contain business logic, stores handle persistence
- **Streaming**: Long-running operations (apply, backups, terminal) use WebSocket or `StreamingResponse`
- **Ansible playbooks**: Generated as Python strings in `ansible_executor.py`, not Jinja templates
- **Terraform HCL**: Generated as Python strings in `terraform_service.py`
- **Secrets**: Fernet-encrypted JSON file. `SecretStore` class handles encrypt/decrypt. `ROOTSTOCK_SECRET_KEY` env var required.

### Frontend

- **Inline styles**: All styling uses `React.CSSProperties` objects. No CSS files, no Tailwind, no styled-components.
- **Self-contained pages**: Each page in `pages/` manages its own state, fetching, and rendering. Minimal shared state.
- **Dark theme**: Background `#0f0f1a`, cards `#1a1a2e`, borders `#2a2a3e`, text `#e0e0e0`, muted `#8890a0`, primary `#7c9ef8`
- **Form pattern**: Pages use local state for forms with `useState`. The `useUnsavedChanges` hook warns on navigation.
- **No emojis in UI** unless the user explicitly requests them.

## Key Files

| What | Where |
|------|-------|
| FastAPI app + all router mounts | `backend/app/main.py` |
| Environment config | `backend/app/config.py` |
| Terraform HCL generation | `backend/app/services/terraform_service.py` |
| Ansible playbook generation | `backend/app/services/ansible_executor.py` |
| Docker Compose generation | `backend/app/services/compose_service.py` |
| Caddyfile generation | `backend/app/services/caddy_service.py` |
| Cloudflare tunnel management | `backend/app/services/cloudflare_service.py` |
| Secret encryption | `backend/app/services/secret_store.py` |
| Export/import | `backend/app/routers/settings_router.py` |
| React routes | `frontend/src/App.tsx` |
| Sidebar navigation | `frontend/src/components/Sidebar.tsx` |
| Unsaved changes hook | `frontend/src/hooks/useUnsavedChanges.ts` |

## Apply System

Five scopes, each tracked independently for dirty state:

1. **terraform** -- VM lifecycle on Proxmox (plan/apply/destroy)
2. **roles** -- Ansible roles applied to hosts via matrix
3. **containers** -- Docker Compose stacks per host
4. **dns** -- Pi-hole custom lists and config
5. **ingress** -- Caddy reverse proxy + Cloudflare tunnels

Apply orchestration: `backend/app/routers/apply.py`
Dirty tracking: `backend/app/services/apply_state.py`

## Common Tasks

### Adding a new entity type
1. Create model in `backend/app/models/`
2. Create store in `backend/app/services/`
3. Create router in `backend/app/routers/`
4. Mount router in `backend/app/main.py`
5. Create page in `frontend/src/pages/`
6. Add route in `frontend/src/App.tsx`
7. Add nav item in `frontend/src/components/Sidebar.tsx`

### Adding a field to an existing entity
1. Add to `*Definition`, `*Create`, and `*Update` models
2. Store handles it automatically (YAML persistence)
3. Update the frontend page form and display

### Modifying generated IaC
- Terraform: edit `terraform_service.py` (`generate_main_tf()`)
- Docker Compose: edit `compose_service.py` (`generate_compose()`)
- Ansible playbooks: edit `ansible_executor.py` (scope-specific `_write_*_playbook()` functions)
- Caddyfile: edit `caddy_service.py` (`generate_caddyfile()`)

## Testing

```bash
cd backend && uv run pytest
```

## Dependencies

Backend deps in `backend/pyproject.toml`. Frontend deps in `frontend/package.json`. The backend Docker image also installs Terraform and ansible-core.
