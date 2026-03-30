<p align="center">
  <img src="docs/logo.png" alt="Rootstock" width="400">
</p>

# Rootstock

A self-hosted web application for managing homelab infrastructure through a GUI over declarative IaC. Rootstock manages the full lifecycle of Proxmox VMs and Docker containers, generating and applying Terraform + Ansible configurations with Git as the source of truth.

## Architecture

```
Browser
  └── React Frontend (Vite, TypeScript)
        └── FastAPI Backend (Python 3.12)
              ├── Terraform  ──► Proxmox API  (VM lifecycle)
              ├── Ansible    ──► Container hosts (Docker, DNS, ingress, roles)
              ├── Caddy      ──► Reverse proxy with Cloudflare DNS challenge
              ├── Cloudflared ──► Cloudflare Tunnels (external access)
              ├── Secrets    ──► Fernet-encrypted store (ROOTSTOCK_SECRET_KEY)
              └── Git        ──► Local repo + optional GitHub remote
```

See [architecture.md](architecture.md) for a detailed breakdown of how the application works.

## Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.12, FastAPI, Uvicorn, GitPython, Paramiko |
| **Frontend** | React 18, TypeScript, React Router, Vite, xterm.js |
| **Infrastructure** | Terraform (bpg/proxmox), Ansible, Docker Compose |
| **Secrets** | Fernet symmetric encryption (cryptography library) |
| **Ingress** | Caddy with Cloudflare DNS plugin, Cloudflare Tunnels |
| **DNS** | Pi-hole integration, static records |
| **Containerisation** | Docker, Docker Compose |

## Features

- **VM Management** -- Define VMs with templates, cloud images, static IPs, GPU passthrough. Terraform handles provisioning on Proxmox.
- **Container Management** -- Define Docker containers with ports, volumes, environment variables, devices. Ansible generates and deploys docker-compose stacks per host.
- **Nodes** -- Register Proxmox hypervisors with API tokens and SSH keys for Terraform and Ansible access.
- **Templates** -- Reusable VM defaults (CPU, memory, disk, network, cloud image, SSH key).
- **Images** -- Cloud image registry with download URLs for VM provisioning.
- **Roles** -- Ansible roles with a matrix UI mapping roles to hosts. Includes a file editor for tasks, handlers, and templates.
- **DNS** -- Container-derived and static DNS records. Pi-hole custom list generation and deployment.
- **Ingress** -- Caddy reverse proxy with automatic HTTPS via Cloudflare DNS challenge. Per-host Caddyfile generation. Cloudflare Tunnel auto-provisioning for external access.
- **Backups** -- rsync-based volume backups with snapshot retention. Container-derived and manual backup paths. Backup stats with caching. Full settings export/import.
- **Secrets** -- Encrypted key-value store for API tokens, SSH keys, and tunnel tokens. SSH key pair generation.
- **Apply** -- One-click or scoped apply across Terraform, Ansible roles, containers, DNS, and ingress. Real-time streaming output. Dirty-state tracking.
- **Git** -- Every change is committed. Push to a remote for off-site backup.
- **Terminal** -- Browser-based SSH terminal to any managed host via xterm.js + WebSocket.
- **Dashboard** -- Overview of hosts, VMs, containers, and recent git activity.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A Proxmox hypervisor (for VM management)
- A `ROOTSTOCK_SECRET_KEY` (generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)

### Configuration

```bash
cp .env.example .env
# Edit .env with your settings:
#   HOMELAB_REPO_PATH=/homelab
#   ROOTSTOCK_SECRET_KEY=<your-fernet-key>
#   HOMELAB_REMOTE_URL=<optional-git-remote>
```

### Run (production)

```bash
docker compose up --build
```

### Run (development)

For local development, create a `compose.override.yml` to enable host networking on the backend (needed for routing to LAN devices like Proxmox hosts):

```yaml
services:
  backend:
    network_mode: host
  frontend:
    extra_hosts:
      - "backend:host-gateway"
```

Then start normally -- Compose merges the override automatically:

```bash
docker compose up --build
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API docs**: http://localhost:8000/docs

## Export / Import

Rootstock can export all definitions as a single JSON file from the Backups page:

- All infrastructure definitions (nodes, VMs, templates, images, containers, roles)
- DNS settings and static records
- Ingress settings and manual rules
- Backup manual paths
- Encrypted secrets (requires same `ROOTSTOCK_SECRET_KEY` on import)
- Terraform state (encrypted with `ROOTSTOCK_SECRET_KEY`)
- Apply state

To recover on a new server: deploy fresh, set the same `ROOTSTOCK_SECRET_KEY`, import the JSON, run `terraform init`, and apply.

## Project Structure

```
rootstock/
├── compose.yml                 # Docker Compose stack
├── architecture.md             # Detailed architecture documentation
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── app/
│       ├── main.py             # FastAPI app, lifespan, CORS, router mounting
│       ├── config.py           # Settings (pydantic-settings, env vars)
│       ├── models/             # Pydantic request/response schemas
│       ├── routers/            # API route handlers (~17 routers)
│       └── services/           # Business logic layer (~25 services)
├── frontend/
│   ├── Dockerfile              # Multi-stage: dev (Vite) + prod (nginx)
│   ├── nginx.conf              # Production reverse proxy with WebSocket support
│   └── src/
│       ├── App.tsx             # React Router with nested layout
│       ├── components/         # Layout, Sidebar, Terminal
│       ├── hooks/              # useUnsavedChanges
│       └── pages/              # 15 page components
└── homelab-template/           # Example YAML schemas for the managed repo
```

### Managed Homelab Repo Structure

The backend manages a Git repository (mounted at `/homelab`) with this layout:

```
/homelab/
├── settings.yml                # Global settings (backup target, schedule, docker vols path)
├── secrets.enc                 # Fernet-encrypted secrets
├── nodes/                      # Proxmox hypervisor definitions (*.yml)
├── vms/                        # VM definitions (*.yml)
├── templates/                  # VM template defaults (*.yml)
├── images.yml                  # Cloud image registry
├── containers/                 # Container/service definitions (*.yml)
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
│   └── state.yml               # Dirty-state tracking per area
└── terraform/
    ├── main.tf                 # Generated Terraform config
    ├── terraform.tfvars        # Generated variables (from secrets)
    └── terraform.tfstate       # Terraform state
```

## License

MIT
