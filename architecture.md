# Rootstock Architecture

This document describes how Rootstock works internally. It serves as a reference for understanding the codebase and as context for AI-assisted development.

## Overview

Rootstock is a two-tier web application (React frontend + FastAPI backend) that manages homelab infrastructure declaratively. Users define their desired state through the GUI, Rootstock generates IaC artifacts (Terraform HCL, Ansible playbooks, Docker Compose files, Caddyfiles, DNS configs), and applies them to the target infrastructure.

```
┌─────────────────────────────────────────────────────────┐
│  Browser (React + TypeScript)                           │
│  Pages: Dashboard, Containers, VMs, Nodes, Templates,   │
│         Images, Roles, DNS, Ingress, Backups, Git,      │
│         Apply, Secrets, Settings                        │
└────────────────────┬────────────────────────────────────┘
                     │ REST API + WebSocket
┌────────────────────▼────────────────────────────────────┐
│  FastAPI Backend (Python 3.12)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Routers  │ │ Services │ │ Models   │ │ Config    │  │
│  │ (17 API  │ │ (25 biz  │ │ (Pydantic│ │ (env vars)│  │
│  │  groups) │ │  logic)  │ │  schemas)│ │           │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Execution Engines                                │   │
│  │  Terraform ─► Proxmox (VMs)                      │   │
│  │  Ansible   ─► Hosts (containers, DNS, ingress,   │   │
│  │               roles)                             │   │
│  │  Paramiko  ─► SSH (backups, status, terminal)    │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Persistence (YAML files in Git repo)             │   │
│  │  /homelab/  ─► nodes, vms, containers, roles,    │   │
│  │               dns, ingress, secrets.enc,          │   │
│  │               terraform/tfstate                   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Core Concepts

### Git as Source of Truth

Every definition change (VM created, container updated, DNS record added) is persisted as a YAML file in a Git repository mounted at `/homelab`. The backend commits changes automatically. Users can push to a remote (GitHub) for off-site backup.

### Declarative State, Imperative Apply

Users declare what they want (a VM with 4 cores, a container running nginx). The backend generates the IaC artifacts and applies them. The "Apply" system tracks which areas have pending changes by comparing file modification times against last-apply timestamps.

### Store Pattern

Each entity type has a dedicated store service (`VMStore`, `ContainerStore`, `NodeStore`, etc.) that handles YAML persistence. Stores read/write individual YAML files in the homelab repo:

```python
# Example: VMStore writes to /homelab/vms/{name}.yml
class VMStore:
    def list_all(self) -> list[VMDefinition]: ...
    def get(self, name: str) -> VMDefinition: ...
    def write(self, vm: VMDefinition) -> None: ...
    def delete(self, name: str) -> None: ...
```

## Backend Structure

### Routers (`backend/app/routers/`)

API route handlers organised by domain. Each router mounts under `/api/{prefix}`.

| Router | Prefix | Purpose |
|--------|--------|---------|
| `apply.py` | `/apply` | Terraform plan/apply/destroy, Ansible execution per scope, apply-all orchestration |
| `backups.py` | `/backups` | Backup paths, manual paths, stats (cached), snapshots, backup/restore via WebSocket |
| `containers.py` | `/containers` | Container CRUD, docker-compose generation, status polling, discovery, logs, shell, migration |
| `dashboard.py` | `/dashboard` | Aggregated counts and recent git commits |
| `dns.py` | `/dns` | DNS settings, static records, Pi-hole custom list and TOML preview |
| `git.py` | `/git` | Repo status, commit and push |
| `hosts.py` | `/hosts` | All managed hosts with live SSH connectivity status |
| `images.py` | `/images` | Cloud image definitions, sync from upstream, reconcile with VMs |
| `ingress.py` | `/ingress` | Caddy rules, manual rules, Caddyfile/tunnel config preview, Caddy restart/logs |
| `nodes.py` | `/nodes` | Proxmox hypervisor registration, SSH setup, connection testing |
| `roles.py` | `/roles` | Ansible role CRUD, file editor, role-to-host matrix, execution ordering |
| `secrets.py` | `/secrets` | Encrypted key-value store, SSH key pair generation |
| `settings_router.py` | `/settings` | Global settings, full export/import with encrypted tfstate and secrets |
| `templates.py` | `/templates` | VM template definitions (CPU, memory, disk, network, cloud image) |
| `terminal.py` | `/terminal` | WebSocket-based SSH terminal to any managed host |
| `vms.py` | `/vms` | VM CRUD, Proxmox discovery, SSH setup, bulk operations |

### Services (`backend/app/services/`)

Business logic layer. Services are stateless functions or lightweight classes.

**Persistence services** (store pattern):
- `container_store.py`, `vm_store.py`, `node_store.py`, `template_store.py`, `image_store.py`, `role_store.py` -- YAML file CRUD for each entity type
- `secret_store.py` -- Fernet-encrypted JSON store (`secrets.enc`)
- `global_settings.py` -- Global app settings (`settings.yml`)
- `ingress_service.py` -- Ingress settings and manual proxy rules
- `dns_service.py` -- DNS settings and static records
- `backup_service.py` -- Manual backup paths, backup path aggregation from containers

**Generation services** (produce IaC artifacts):
- `terraform_service.py` -- Generates `main.tf` with bpg/proxmox provider blocks, VM resources, cloud-init, image downloads, GPU passthrough
- `compose_service.py` -- Generates `docker-compose.yml` per host from container definitions
- `caddy_service.py` -- Generates Caddyfile per host with reverse proxy rules and Cloudflare DNS challenge
- `cloudflare_service.py` -- Generates tunnel config, manages Cloudflare API (tunnel creation, DNS records)
- `inventory_service.py` -- Generates Ansible inventory from nodes/VMs
- `dns_service.py` -- Also generates Pi-hole custom lists and TOML configs

**Execution services** (run infrastructure tools):
- `terraform_executor.py` -- Prepares workspace (main.tf + tfvars with resolved secrets), streams `terraform plan/apply/destroy`. Snapshots `terraform.tfstate` before each apply for rollback.
- `ansible_executor.py` -- Thin coordinator: prepares workspace, delegates to per-scope executors, streams `ansible-playbook`
- `roles_executor.py`, `containers_executor.py`, `dns_executor.py`, `ingress_executor.py`, `backups_executor.py` -- Per-scope playbook generation using `playbook_util.dump_playbook()` (dict + ruamel.yaml)
- `playbook_util.py` -- `dump_playbook(plays)`, `task()`, `literal()` helpers for structured YAML generation
- `git_service.py` -- GitPython wrapper for init, commit, push
- `ssh_service.py` -- Shared SSH helpers (`ssh_exec`, `open_ssh_client`, `load_private_key`) used by containers, backups, and ingress routers

**Other services**:
- `apply_state.py` -- Tracks dirty areas by comparing file mtimes vs last-apply timestamps
- `apply_history.py` -- JSON log of apply runs (timestamp, scope, exit code, truncated log)
- `yaml_service.py` -- YAML read/write using ruamel.yaml (preserves formatting)
- `move_service.py` -- Container migration between hosts

### Models (`backend/app/models/`)

Pydantic schemas for API request/response validation and YAML serialisation. Key models:

- `ContainerDefinition` -- name, image, hosts, ports, volumes, env vars, devices, dns_name, ingress_mode, external flag, backup settings
- `VMDefinition` -- name, node, template, cpu/memory/disk, ip, image, roles, gpu_passthrough
- `NodeDefinition` -- name, type, endpoint, node_name, token_name, ssh_user
- `TemplateDefinition` -- name, cpu/memory/disk, cloud_image, network config, ssh_key_secret
- `RoleDefinition` -- name, description (files managed separately by RoleStore)

## Apply System

The Apply system is the core orchestration layer. It has five scopes:

### 1. Terraform (VMs)

```
VM/Node/Template/Image definitions
  → terraform_service.generate_main_tf()     # Generates HCL
  → terraform_executor.prepare_workspace()   # Writes main.tf + tfvars
  → terraform_executor.snapshot_state()      # Copies tfstate before apply
  → terraform plan / apply / destroy         # Streamed to frontend
  → POST /api/apply/terraform/rollback       # Restores pre-apply snapshot
```

**Generated Terraform includes:**
- Provider blocks per enabled hypervisor (with aliases for multi-node)
- SSH config blocks for each node
- Cloud image download resources (deduplicated per node+image)
- VM resources with CPU, memory, disk, network, cloud-init
- GPU passthrough via Proxmox resource mappings
- q35 machine type for all VMs
- Variables for API tokens, SSH keys, public keys (resolved from secret store)

### 2. Ansible: Roles

Generates a playbook that applies Ansible roles to hosts based on the role-to-host matrix. Role ordering is configurable.

### 3. Ansible: Containers

```
Container definitions
  → compose_service.generate_compose()     # docker-compose.yml per host
  → ansible_executor generates playbook:
      1. Copy docker-compose.yml
      2. docker compose up -d
```

### 4. Ansible: DNS

```
DNS settings + container DNS names + static records
  → dns_service generates Pi-hole configs
  → ansible_executor generates playbook:
      1. Write custom.list / pihole.toml
      2. Restart Pi-hole DNS
```

### 5. Ansible: Ingress

```
Ingress settings + container ingress rules + manual rules
  → caddy_service.generate_caddyfile()         # Per host
  → cloudflare_service.generate_tunnel_config() # Per host (if external)
  → cloudflare_service.ensure_tunnel_for_host() # Auto-provision via CF API
  → ansible_executor generates playbook:
      Play 1: Deploy Caddy (Docker container)
        - Copy Caddyfile, Dockerfile, .env
        - Build caddy-cloudflare image
        - Create/restart container on docker network
      Play 2: Deploy cloudflared (Docker container)
        - Read tunnel token (from secret store / auto-provisioned)
        - Create cloudflared container on same docker network
        - Token-based tunnel mode (--no-autoupdate run --token)
```

### Dirty State Tracking

`apply_state.py` tracks which scopes need re-applying:

```python
AREAS = ["terraform", "roles", "containers", "dns", "ingress"]
```

Each area maps to source directories. When any file in those directories is modified after the last apply timestamp, the area is marked dirty. The frontend shows a yellow dot on the Apply nav item.

## Ingress System

### Internal Services

Caddy runs as a Docker container per host, built with the Cloudflare DNS plugin for automatic HTTPS. Each container with `ingress_mode: "caddy"` gets a reverse proxy rule using the Docker service name as upstream (works because Caddy and app containers share a Docker network).

### External Services

For services marked `external: true`:

1. **Cloudflared** runs as a Docker container on the same Docker network as Caddy
2. **Token mode**: Each host gets its own tunnel, cloudflared connects with `--token`
3. **Auto-provisioning**: If a Cloudflare API token is configured, Rootstock automatically:
   - Creates a tunnel named `rootstock-{hostname}` via the CF API
   - Creates CNAME DNS records pointing to the tunnel
   - Stores the tunnel token in the secret store
4. **Per-host tokens**: Different hosts can use different tunnels. The `tunnel_tokens` map in ingress settings allows per-host overrides, with a default fallback.

### Traffic Flow

```
Internet → Cloudflare → cloudflared container → caddy container → app container
                         (same docker network)   (reverse proxy)
```

## Backup System

### Backup Paths

Paths are derived from two sources:
1. **Container volumes** with `backup: true` -- automatically collected from container definitions
2. **Manual paths** -- user-defined paths on specific hosts

### Backup Execution

Backups run via WebSocket for real-time progress streaming:

```
For each host:
  SSH to host
  For each volume:
    rsync -a --delete {source}/ {target}/{host}/{slug}/latest/
    cp -al latest/ {target}/{host}/{slug}/{date}/  # hardlink snapshot
```

### Backup Stats

The stats endpoint calculates backup sizes and set counts per path. Results are cached in-memory with a 1-hour TTL. A single SSH command per host batches all `du` and directory count operations.

### Export / Import

Full application state can be exported as JSON from the Backups page:

| Data | Protection |
|------|-----------|
| All definitions (nodes, VMs, containers, etc.) | Plaintext |
| Roles (metadata + all files) | Plaintext |
| DNS static records | Plaintext |
| Ingress manual rules | Plaintext |
| Backup manual paths | Plaintext |
| Apply state | Plaintext |
| Secrets (`secrets.enc` blob) | Fernet-encrypted |
| Terraform state | Fernet-encrypted with `ROOTSTOCK_SECRET_KEY` |

Recovery requires the same `ROOTSTOCK_SECRET_KEY` to decrypt secrets and tfstate.

## Secret Store

Secrets are stored in a single Fernet-encrypted JSON file (`secrets.enc`). The encryption key (`ROOTSTOCK_SECRET_KEY`) is an environment variable that must be managed separately (e.g., in a password vault).

Common secret patterns:
- `proxmox/{node}/api_token` -- Proxmox API tokens
- `proxmox/{node}/ssh_private_key` -- SSH keys for Terraform
- `ssh/{name}/private_key` and `ssh/{name}/public_key` -- Generated SSH key pairs
- `cloudflare/api_token` -- Cloudflare API token for DNS and tunnels
- `cloudflare/tunnel_token_{host}` -- Auto-provisioned tunnel tokens

## Frontend Structure

### Pages (`frontend/src/pages/`)

Each page is a self-contained React component with inline styles (no CSS framework). Pages follow a consistent pattern: fetch data on mount, render cards/tables, handle CRUD with forms.

| Page | Key Features |
|------|-------------|
| `Dashboard.tsx` | Host status, entity counts, recent commits |
| `Containers.tsx` | CRUD, compose import, discovery, status, logs, shell, migration |
| `VMs.tsx` | CRUD, Proxmox discovery, SSH setup, template defaults |
| `Nodes.tsx` | Proxmox registration, connection testing, SSH key setup |
| `Templates.tsx` | VM template CRUD with network config |
| `Images.tsx` | Cloud image registry, sync, reconcile |
| `Roles.tsx` | Role CRUD, file editor (tasks/handlers/templates), matrix, ordering |
| `DNS.tsx` | Static records, Pi-hole settings, preview |
| `Ingress.tsx` | Rules table, manual rules, settings, tunnel tokens, Caddyfile preview |
| `Backups.tsx` | Paths with stats, manual paths, backup/restore dialogs, export/import |
| `Git.tsx` | Status, push |
| `Apply.tsx` | Dirty indicators, scoped apply, streaming output, plan diff viewer, Terraform rollback button |
| `Secrets.tsx` | Key list with filter, add/update/delete, SSH key generation |
| `Settings.tsx` | Global settings form |

### Components

- `Layout.tsx` -- Main layout with sidebar and persistent Apply modal
- `Sidebar.tsx` -- Navigation menu with dirty-state indicator, dark/light theme toggle, hamburger on mobile
- `Terminal.tsx` -- xterm.js WebSocket terminal component
- `CommandPalette.tsx` -- `Ctrl+K` fuzzy search across all entities

### Hooks

- `useUnsavedChanges.ts` -- Warns on navigation when forms have unsaved changes. Patches `history.pushState` directly (React Router's `useBlocker` caused blank pages).

### Routing

React Router v6 with a nested layout. All routes are children of the `Layout` component. The frontend proxies `/api` to the backend via Vite dev server or nginx in production.

## Docker Setup

### Development

```yaml
services:
  backend:
    build: ./backend
    command: uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    volumes:
      - ./backend/app:/app/app       # Hot reload
      - homelab_repo:/homelab        # Managed repo
    ports: ["8000:8000"]

  frontend:
    build: ./frontend
    target: dev                       # Vite dev server
    volumes:
      - ./frontend/src:/app/src      # Hot reload
    ports: ["5173:5173"]
```

### Production

The frontend builds to static files served by nginx. Nginx handles WebSocket upgrades and streaming response proxying for terminal, backup, container logs, and ingress log endpoints.

### Backend Container

The backend Dockerfile includes:
- Python 3.12 with uv package manager
- Git, SSH client
- Terraform 1.9.8
- ansible-core with ansible.posix collection

## Key Dependencies

### Backend
- `fastapi` + `uvicorn` -- HTTP framework and ASGI server
- `pydantic` + `pydantic-settings` -- Schema validation and env config
- `gitpython` -- Git operations
- `ruamel.yaml` -- YAML with comment/formatting preservation
- `httpx` -- HTTP client for Cloudflare API
- `cryptography` -- Fernet encryption for secrets
- `paramiko` -- SSH client for backups, status checks, terminal

### Frontend
- `react` + `react-dom` -- UI framework
- `react-router-dom` -- Client-side routing
- `@xterm/xterm` + `@xterm/addon-fit` -- Terminal emulator
- `js-yaml` -- YAML parsing for compose import
- `vite` -- Build tool and dev server
