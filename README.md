<p align="center">
  <img src="docs/logo.png" alt="Rootstock" width="400">
</p>

# Rootstock

A self-hosted web application for managing homelab infrastructure through a GUI over declarative IaC. Rootstock manages the full lifecycle of Proxmox VMs and Docker containers, generating and applying Terraform + Ansible configurations with Git as the source of truth.

## Architecture

```
Browser
  └── FastAPI (serves React SPA + API)
        ├── Terraform  ──► Proxmox API       (VM lifecycle)
        ├── Ansible    ──► Container hosts    (Docker, DNS, ingress, roles)
        ├── Caddy      ──► Reverse proxy      (Cloudflare DNS challenge)
        ├── Cloudflared ──► Cloudflare Tunnels (external access)
        ├── Secrets    ──► Fernet-encrypted store (ROOTSTOCK_SECRET_KEY)
        └── Git        ──► Local repo + optional GitHub remote
```

See [architecture.md](architecture.md) for a detailed breakdown.

## Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.12, FastAPI, Gunicorn + Uvicorn workers |
| **Frontend** | React 18, TypeScript, React Router, Vite (build only), xterm.js |
| **Infrastructure** | Terraform (bpg/proxmox), Ansible, Docker Compose |
| **Secrets** | Fernet symmetric encryption (cryptography library) |
| **Ingress** | Caddy with Cloudflare DNS plugin, Cloudflare Tunnels |
| **DNS** | Pi-hole integration, static records |
| **Deployment** | Single Docker container, multi-stage build |

## Features

- **VM Management** — Define VMs with templates, cloud images, static IPs, GPU passthrough. Terraform handles provisioning on Proxmox. Start/Stop power control for all VMs via Proxmox API. Import unmanaged VMs for power-only control.
- **Container Management** — Define Docker containers with ports, volumes, environment variables, devices. Ansible generates and deploys docker-compose stacks per host. Deploy to selected hosts.
- **Nodes** — Register Proxmox hypervisors and bare-metal hosts with API tokens, SSH keys, and per-node snippets storage.
- **Templates** — Reusable VM defaults (CPU, memory, disk, network, cloud image, SSH key).
- **Images** — Cloud image registry with download URLs for VM provisioning.
- **Roles** — Ansible roles with a matrix UI mapping roles to hosts. Includes a file editor for tasks, handlers, and templates.
- **DNS** — Container-derived and static DNS records. Pi-hole custom list generation and deployment.
- **Ingress** — Caddy reverse proxy with automatic HTTPS via Cloudflare DNS challenge. Per-host Caddyfile generation. Cloudflare Tunnel auto-provisioning for external access.
- **Backups** — rsync-based volume backups with snapshot retention. Container-derived and manual backup paths.
- **Stats** — Live node, VM, and container stats with CPU/memory/disk gauges and CPU sparklines. Configurable poll interval, start/stop controls.
- **Secrets** — Encrypted key-value store for API tokens, SSH keys, and tunnel tokens. SSH key pair generation.
- **Apply** — Scoped apply across Terraform, Ansible roles, containers, DNS, and ingress. Real-time streaming output. Dirty-state tracking. Ansible options: `--diff`, verbosity, parallel strategy. Role and host filtering.
- **Git** — Every change is committed. Push to a remote for off-site backup.
- **Terminal** — Browser-based SSH terminal to any managed host via xterm.js + WebSocket.
- **Dashboard** — Overview of hosts, VMs, containers, and recent git activity.
- **Export / Import** — Full config export as a single JSON file including encrypted secrets and Terraform state.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A Proxmox hypervisor (for VM management)
- A `ROOTSTOCK_SECRET_KEY`:
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```

### Configuration

```bash
cp .env.example .env
# Edit .env:
#   ROOTSTOCK_SECRET_KEY=<your-fernet-key>   (required)
#   HOMELAB_REPO_PATH=/homelab               (default)
#   HOMELAB_REMOTE_URL=<git-remote>          (optional)
```

### Run

```bash
docker compose up --build
```

Rootstock is available at **http://localhost:8000**. On first load you'll be prompted to set a username and password.

### Development

For local development with hot reload, use the two-service override:

```bash
docker compose -f compose.yml -f compose.prod.yml up --build
```

Or create a `compose.override.yml` for LAN access to Proxmox/SSH hosts:

```yaml
services:
  app:
    network_mode: host
```

## Export / Import

Export all definitions from the Backups page:

- All infrastructure definitions (nodes, VMs, templates, images, containers, roles)
- DNS settings and static records
- Ingress settings and manual rules
- Backup manual paths
- Encrypted secrets (requires same `ROOTSTOCK_SECRET_KEY` on import)
- Terraform state
- Apply state

To recover on a new server: deploy fresh, set the same `ROOTSTOCK_SECRET_KEY`, import the JSON, and apply.

## Project Structure

```
rootstock/
├── Dockerfile                  # Multi-stage: Node (frontend build) → Python (backend + static)
├── compose.yml                 # Single-container production stack
├── .env.example                # Required/optional env vars
├── architecture.md             # Detailed architecture documentation
├── backend/
│   ├── pyproject.toml
│   └── app/
│       ├── main.py             # FastAPI app, lifespan, middleware, router mounts, StaticFiles
│       ├── config.py           # Settings (pydantic-settings, env vars)
│       ├── models/             # Pydantic request/response schemas
│       ├── routers/            # API route handlers
│       └── services/           # Business logic and store layer
├── frontend/
│   └── src/
│       ├── App.tsx             # React Router with nested layout
│       ├── components/         # Layout, Sidebar, Terminal
│       ├── hooks/              # useUnsavedChanges
│       └── pages/              # Page components
├── tests/                      # pytest integration tests
└── homelab-template/           # Example YAML schemas for the managed repo
```

### Managed Homelab Repo Structure

The backend manages a Git repository (mounted at `/homelab`) with this layout:

```
/homelab/
├── settings.yml                # Global settings (backup target, schedule, stats config)
├── secrets.enc                 # Fernet-encrypted secrets
├── auth.json                   # Hashed credentials + JWT secret
├── nodes/                      # Proxmox hypervisor and bare-metal host definitions
├── vms/                        # VM definitions
├── templates/                  # VM template defaults
├── images.yml                  # Cloud image registry
├── containers/                 # Container/service definitions
├── roles/                      # Ansible roles (each with role.yml + tasks/)
├── dns/
│   ├── settings.yml            # DNS zones, Pi-hole config
│   └── records.yml             # Static DNS records
├── ingress/
│   ├── settings.yml            # Ingress settings (domain, CF token, network)
│   └── rules.yml               # Manual proxy rules
├── backups/
│   └── paths.yml               # Manual backup paths
├── apply/
│   └── state.yml               # Dirty-state tracking per scope
└── terraform/
    ├── main.tf                 # Generated Terraform config
    ├── terraform.tfvars        # Generated variables
    └── terraform.tfstate       # Terraform state
```

## License

MIT
