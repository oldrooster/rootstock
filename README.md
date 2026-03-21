<p align="center">
  <img src="docs/logo.png" alt="Rootstock" width="400">
</p>

# Rootstock

A self-hosted web application that provides a GUI over declarative IaC, managing the full lifecycle of VMs and containers across a homelab. The GUI generates and commits IaC (Terraform + Ansible), which is then applied by the backend. Git is the source of truth.

## Architecture

```
Browser
  └── React Frontend (Vite, TypeScript)
        └── FastAPI Backend (Python 3.12)
              ├── Terraform  ──► Proxmox API  (VM lifecycle)
              ├── Ansible    ──► Container hosts (services, DNS, ingress)
              ├── Infisical  ──► Secrets store
              └── Git        ──► Local repo + GitHub remote
```

## Stack

- **Backend**: Python 3.12, FastAPI, GitPython, ruamel.yaml
- **Frontend**: React 18, TypeScript, React Router, Vite
- **Infrastructure**: Docker Compose, Terraform (bpg/proxmox), Ansible
- **Secrets**: Infisical
- **Ingress**: Caddy with Cloudflare DNS
- **DNS**: Pi-hole

## Getting Started

### Prerequisites

- Docker and Docker Compose

### Configuration

```bash
cp .env.example .env
# Edit .env with your settings
```

### Run (production)

```bash
docker compose up --build
```

### Run (development)

For local development, create a `compose.override.yml` to enable host networking on the backend (needed for routing to LAN devices like Proxmox hosts). The frontend also needs an `extra_hosts` entry so its Vite proxy can resolve `backend` to the host, since `network_mode: host` removes the backend from the Compose bridge network:

```yaml
services:
  backend:
    network_mode: host
  frontend:
    extra_hosts:
      - "backend:host-gateway"
```

Then start normally — Compose merges the override automatically:

```bash
docker compose up --build
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API docs**: http://localhost:8000/docs

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/dashboard` | Dashboard summary (counts, hosts, recent commits) |
| GET | `/services` | List declared services |
| POST | `/services` | Declare a new service |
| GET | `/services/{name}` | Get a service |
| PATCH | `/services/{name}` | Update a service |
| DELETE | `/services/{name}` | Remove a service |
| POST | `/services/{name}/move` | Move service to another host |
| GET | `/vms` | List declared VMs |
| POST | `/vms` | Declare a new VM |
| GET | `/vms/{name}` | Get a VM |
| PATCH | `/vms/{name}` | Update a VM |
| DELETE | `/vms/{name}` | Destroy a VM |
| GET | `/hypervisors` | List Proxmox hypervisors |
| POST | `/hypervisors` | Register a hypervisor |
| GET | `/hypervisors/{name}` | Get a hypervisor |
| PATCH | `/hypervisors/{name}` | Update a hypervisor |
| DELETE | `/hypervisors/{name}` | Remove a hypervisor |
| POST | `/hypervisors/{name}/test` | Test hypervisor connection |
| GET | `/apply` | Preview pending apply |
| POST | `/apply` | Generate Terraform, Ansible, Caddyfile, DNS configs |
| GET | `/git/status` | Repo status (branch, dirty, ahead/behind) |
| POST | `/git/push` | Commit and push to GitHub |
| GET | `/hosts` | All hosts and live status |
| GET | `/backups` | Backup sets and status |
| POST | `/backups/{name}/backup` | Trigger backup |
| POST | `/backups/{name}/restore` | Trigger restore |
| GET | `/secrets` | List secret keys |
| PUT | `/secrets` | Set a secret |
| DELETE | `/secrets/{key}` | Delete a secret |
| GET | `/dns/records` | DNS records (service-derived + static) |
| GET | `/ingress/rules` | Caddy ingress rules from services |
| GET | `/settings` | Application settings |

## Project Structure

```
rootstock/
├── compose.yml                 # Docker Compose stack
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── app/
│       ├── main.py             # FastAPI app, lifespan, CORS
│       ├── config.py           # Settings (pydantic-settings)
│       ├── models/             # Pydantic request/response schemas
│       ├── routers/            # API route handlers
│       └── services/           # Business logic (git, yaml, terraform, caddy, dns)
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf              # Production reverse proxy
│   └── src/
│       ├── App.tsx             # Router with nested layout
│       ├── components/         # Layout, Sidebar
│       └── pages/              # Dashboard, Services, VMs, Hypervisors, DNS,
│                               # Ingress, Backups, Git, Apply, Secrets, Settings
└── homelab-template/           # Example YAML schemas for the managed repo
    ├── services/example.yml
    ├── vms/example.yml
    ├── hypervisors/example.yml
    └── dns/records.yml
```

## License

MIT
