# Rootstock Implementation Plan

## Current State Summary

The codebase already has foundational pieces:
- **Services** (`ServiceDefinition`): single-container definitions with host, image, ports, volumes, env, ingress, dns, secrets — this becomes the basis for **Containers**
- **DNS service**: derives records from services + static `dns/records.yml`, generates Pi-hole `custom.list`
- **Caddy service**: generates Caddyfile from services with ingress config
- **Inventory service**: generates Ansible inventory from VMs grouped by role (singular `role` field)
- **Apply router**: generates Terraform, Caddyfile, Pi-hole DNS, Ansible inventory — with streaming Terraform plan/apply
- **VMs**: have a singular `role` field (string) — needs to become multi-role

---

## Phase 1: Roles & Ansible Foundation

**Goal**: Manage Ansible roles as code in the UI, assign roles to nodes/VMs, generate and execute Ansible playbooks.

### 1.1 Data Model

**Role definition** — stored as `roles/{role_name}/role.yml`:
```yaml
name: docker
description: "Install and configure Docker Engine"
```

**Role file structure** — each role follows Ansible convention, stored under `roles/{role_name}/`:
```
roles/docker/
  role.yml          # metadata (name, description)
  tasks/main.yml    # required
  handlers/main.yml # optional
  templates/        # optional .j2 files
  vars/main.yml     # optional
  defaults/main.yml # optional
  files/            # optional static files
```

**Role assignment** — stored on the node/VM definitions:
- `NodeDefinition.roles: list[str] = []` (replaces nothing, new field)
- `VMDefinition.roles: list[str] = []` (replaces singular `role: str`)
- Migration: existing VMs with `role: "container_host"` → `roles: ["container_host"]`

### 1.2 Backend

- **`models/role.py`**: `RoleDefinition(name, description)`, `RoleCreate`, `RoleUpdate`
- **`services/role_store.py`**: CRUD for role metadata + file management (list files in a role, read/write/delete individual files)
- **`routers/roles.py`**:
  - `GET /roles/` — list all roles
  - `GET /roles/{name}` — get role metadata
  - `POST /roles/` — create role (scaffolds directory structure)
  - `PATCH /roles/{name}` — update metadata
  - `DELETE /roles/{name}` — delete role (only if unassigned)
  - `GET /roles/{name}/files` — list files in role
  - `GET /roles/{name}/files/{path}` — read file content
  - `PUT /roles/{name}/files/{path}` — write file content
  - `DELETE /roles/{name}/files/{path}` — delete file
  - `GET /roles/matrix` — returns assignment matrix (all roles × all nodes/VMs)
  - `POST /roles/matrix` — bulk update assignments
- **Update `NodeDefinition`**: add `roles: list[str] = []`
- **Update `VMDefinition`**: replace `role: str` with `roles: list[str] = []`
- **Update `inventory_service.py`**: generate inventory grouped by roles (a host appears in multiple groups if it has multiple roles); include both nodes and VMs

### 1.3 Frontend

- **`pages/Roles.tsx`**:
  - Role list with create/edit/delete
  - Per-role view: file tree sidebar + Monaco code editor for editing role files
  - Assignment matrix tab: grid of roles × hosts with checkboxes
- **Update `Nodes.tsx`**: add `roles` multi-select/tag field to node form
- **Update `VMs.tsx`**: replace `role` text input with `roles` multi-select/tag field

### 1.4 Ansible Executor

- **`services/ansible_service.py`**:
  - `generate_inventory()` — expanded to include nodes (with `ansible_host` from endpoint, `ansible_user` from `ssh_user`) and VMs
  - `generate_playbook(target: str)` — generates a playbook that applies roles to hosts based on assignments
  - `prepare_workspace()` — writes inventory, playbook, and symlinks/copies role dirs into an Ansible workspace
  - `run_ansible(args, cwd)` — async generator streaming ansible-playbook output (same pattern as `run_terraform`)
- **`routers/apply.py`**: add `POST /apply/ansible/run` endpoint with streaming output
- SSH key resolution: use existing node/VM SSH keys from SecretStore, write temporary key files for Ansible to use (`ansible_ssh_private_key_file` in inventory)

### 1.5 Sidebar & Navigation

- Add "Roles" under Infrastructure group (after Templates)

---

## Phase 2: Containers (Evolve Services)

**Goal**: Evolve the existing Services model into a full container/compose management system.

### 2.1 Data Model Changes

Rename and extend `ServiceDefinition` → `ContainerService`:

```yaml
# containers/{name}.yml
name: unifi
enabled: true
hosts: ["vm-docker1"]                  # explicit host list
host_rule: ""                          # OR role-based: "role:docker"
image: "lscr.io/linuxserver/unifi-network-application:latest"
compose_extras: {}                     # additional services (e.g., mongo sidecar)
ports:
  - host: 8443
    container: 8443
volumes:
  - host_path: "${DOCKER_VOLS}/unifi/config"
    container_path: "/config"
    backup: true
env:
  PUID: "1000"
  PGID: "1000"
secrets: ["unifi/mongo_password"]      # refs into SecretStore
dns_name: "unifi.cbf.nz"
ingress_mode: "caddy"                  # "caddy" | "direct" | "none"
ingress_port: 8443                     # backend port for Caddy reverse_proxy
external: false                        # expose via Cloudflare tunnel
```

**Key changes from current `ServiceDefinition`**:
- `host: str` → `hosts: list[str]` + `host_rule: str` (explicit or role-based)
- `ingress: IngressConfig | None` + `dns: DNSConfig | None` → simplified to `dns_name`, `ingress_mode`, `ingress_port`, `external`
- DNS IP is **derived** from the host the container runs on (no manual IP entry)
- Add `compose_extras: dict` for multi-container services (sidecar definitions)
- Add `external: bool` for Cloudflare tunnel flag
- Volume `host_path` supports `${DOCKER_VOLS}` variable (default: `/var/docker_vols`)

**`compose_extras` example** for Unifi (app + mongo):
```yaml
compose_extras:
  mongo:
    image: "mongo:7.0"
    volumes:
      - "${DOCKER_VOLS}/unifi/db:/data/db"
    environment:
      MONGO_INITDB_ROOT_USERNAME: "unifi"
```

**Settings** — add global `docker_vols_base: str = "/var/docker_vols"` to app settings.

### 2.2 Backend

- **Rename** `services/service_store.py` → `services/container_store.py` (update imports)
- **Rename** `routers/services.py` → `routers/containers.py`
- **API prefix**: `/api/services/` → `/api/containers/` (keep `/api/services/` as alias during transition if needed)
- **`services/compose_service.py`** (new):
  - `generate_compose(host, containers)` — generates `docker-compose.yml` content for a given host, assembling all containers assigned to it
  - Handles `${DOCKER_VOLS}` substitution
  - Includes sidecar containers from `compose_extras`
  - Adds Caddy and cloudflared as auto-managed services where needed
  - Resolves secrets from SecretStore into env vars
- **Host resolution logic**:
  - If `hosts` is set: use those hosts
  - If `host_rule` starts with `role:`: find all nodes/VMs with that role
  - Both can coexist (union)

### 2.3 Frontend

- **Rename** `pages/Services.tsx` → `pages/Containers.tsx`
- Rebuild the form:
  - Name, image, enabled
  - Host assignment: multi-select from nodes/VMs OR role-based rule input
  - DNS name (single text field)
  - Ingress mode: dropdown (caddy / direct / none)
  - Ingress port (shown when mode=caddy)
  - External toggle (shown when mode=caddy)
  - Ports: dynamic list of host:container mappings
  - Volumes: dynamic list with `${DOCKER_VOLS}` prefix hint, backup checkbox per volume
  - Environment variables: key-value editor
  - Secret references: multi-select from SecretStore keys
  - Compose extras: code editor (YAML) for advanced sidecar definitions
- **Preview panel**: show generated `docker-compose.yml` for the selected host

### 2.4 Sidebar

- Rename "Services" → "Containers"

---

## Phase 3: DNS

**Goal**: Full DNS management — derived records from containers + static records + Pi-hole deployment.

### 3.1 Data Model

**DNS is mostly derived**, but needs:

**Static DNS records** — stored in `dns/records.yml` (already exists):
```yaml
static_records:
  - hostname: pve.cbf.nz
    ip: 10.0.0.5
    description: "Proxmox Web UI"
  - hostname: router.cbf.nz
    ip: 192.168.1.1
    description: "Home router"
```

**DNS settings** — stored in `dns/settings.yml`:
```yaml
zones:
  - name: cbf.nz
    internal: true    # Pi-hole
    external: true    # Cloudflare
pihole:
  host: pi1           # node/VM name where Pi-hole runs
  config_path: /etc/pihole/pihole.toml
```

### 3.2 Derived DNS Logic (update `dns_service.py`)

For each enabled container:
1. If `dns_name` is set and `ingress_mode == "caddy"`: A record → Caddy host IP (the node/VM the container runs on, since Caddy runs alongside)
2. If `dns_name` is set and `ingress_mode == "direct"`: A record → docker host IP directly
3. If `dns_name` is set and `ingress_mode == "none"`: no DNS record
4. If `external == true`: also needs Cloudflare CNAME → tunnel

### 3.3 Backend

- **Update `routers/dns.py`**:
  - `GET /dns/records` — all records (derived + static) — already exists, update logic
  - `GET /dns/static` — list static records
  - `POST /dns/static` — add static record
  - `PUT /dns/static/{hostname}` — update static record
  - `DELETE /dns/static/{hostname}` — delete static record
  - `GET /dns/settings` — get DNS settings (zones, Pi-hole config)
  - `PUT /dns/settings` — update DNS settings
- **Update `dns_service.py`**:
  - Update `get_all_records()` to use new container model and derive IPs from host assignments
  - `generate_pihole_toml_block(records)` — generate the CNAME/local DNS section for pihole.toml
  - Add `description` field to `DNSRecord`

### 3.4 Frontend

- **Rebuild `pages/DNS.tsx`**:
  - **Records tab**: table showing all DNS records (derived + static) with source column and host column
  - **Static records section**: CRUD for manual static records (hostname, IP, description)
  - **Settings section**: configure zones, Pi-hole host, config path
  - **Apply DNS button**: triggers Ansible DNS playbook → redirects to Apply page

---

## Phase 4: Ingress (Caddy + Cloudflare Tunnels)

**Goal**: Auto-generate Caddy configs per host, manage Cloudflare tunnels, support non-container reverse proxy rules.

### 4.1 Data Model

**Ingress is mostly derived from containers**, but needs:

**Manual proxy rules** — stored in `ingress/rules.yml`:
```yaml
manual_rules:
  - name: proxmox-ui
    hostname: pve.cbf.nz
    backend: "https://10.0.0.5:8006"
    caddy_host: vm-docker1      # which Caddy instance handles this
    external: false
  - name: home-assistant
    hostname: ha.cbf.nz
    backend: "http://10.0.0.20:8123"
    caddy_host: vm-docker1
    external: true
```

**Ingress settings** — stored in `ingress/settings.yml`:
```yaml
wildcard_domain: "*.cbf.nz"
cloudflare_api_token_secret: "cloudflare/api_token"  # ref to SecretStore
acme_email: "you@example.com"
```

### 4.2 Caddy Generation (update `caddy_service.py`)

Per docker host, generate a Caddyfile:
```
{
    email {acme_email}
    acme_dns cloudflare {cf_token}
}

unifi.cbf.nz {
    reverse_proxy unifi:8443
}

# manual proxy rules assigned to this host
pve.cbf.nz {
    reverse_proxy https://10.0.0.5:8006 {
        transport http {
            tls_insecure_skip_verify
        }
    }
}
```

Key points:
- Container services use Docker service name (not IP) since they're on the same compose network
- Manual rules use the full backend URL
- Wildcard cert via Cloudflare DNS challenge
- One Caddyfile per host

### 4.3 Cloudflare Tunnel Generation

Per docker host with external services, generate `cloudflared` config:
```yaml
tunnel: <tunnel-name>
credentials-file: /etc/cloudflared/credentials.json
ingress:
  - hostname: ha.cbf.nz
    service: https://caddy:443
  - service: http_status:404
```

- **`services/cloudflare_service.py`** (new):
  - `generate_tunnel_config(host, containers, manual_rules, settings)` — generates cloudflared config YAML
  - Tunnel credentials stored in SecretStore

### 4.4 Backend

- **Update `routers/ingress.py`**:
  - `GET /ingress/rules` — all rules (derived + manual) — update existing
  - `GET /ingress/manual` — list manual proxy rules
  - `POST /ingress/manual` — add manual rule
  - `PUT /ingress/manual/{name}` — update manual rule
  - `DELETE /ingress/manual/{name}` — delete manual rule
  - `GET /ingress/settings` — get ingress settings
  - `PUT /ingress/settings` — update ingress settings
  - `GET /ingress/preview/{host}` — preview generated Caddyfile for a host
  - `GET /ingress/tunnel-preview/{host}` — preview cloudflared config for a host
- **Apply Ingress button** → Ansible deploys Caddyfile + cloudflared config

### 4.5 Frontend

- **Rebuild `pages/Ingress.tsx`**:
  - **Rules tab**: table of all ingress rules (derived from containers + manual), grouped by host
  - **Manual rules section**: CRUD for non-container proxy rules
  - **Settings section**: wildcard domain, ACME email, Cloudflare token reference
  - **Per-host preview**: expandable Caddyfile and tunnel config preview
  - **Apply Ingress button**

---

## Phase 5: Backups (Derived Volume Collation)

**Goal**: Automatically derive backup paths from container volumes, allow manual additions, display per-host.

### 5.1 Data Model

**Derived from containers**: any volume with `backup: true` → backup path entry.

**Manual backup paths** — stored in `backups/paths.yml`:
```yaml
manual_paths:
  - host: pi1
    path: /home/pi/scripts
    description: "Custom automation scripts"
  - host: vm-docker1
    path: /var/docker_vols/custom-app
    description: "Legacy app data"
```

### 5.2 Backend

- **Update `routers/backups.py`**:
  - `GET /backups/paths` — all backup paths (derived + manual), grouped by host
  - `POST /backups/paths` — add manual backup path
  - `PUT /backups/paths/{id}` — update manual path
  - `DELETE /backups/paths/{id}` — delete manual path
- **Derive logic**: for each container, for each volume with `backup: true`, resolve host and `${DOCKER_VOLS}` to get absolute path

### 5.3 Frontend

- **Rebuild `pages/Backups.tsx`**:
  - Table grouped by host showing all backup paths
  - Source column: "container: unifi" or "manual"
  - Add manual path form
  - Summary: total volume count per host

---

## Phase 6: Apply System Overhaul

**Goal**: Unified apply with per-feature granularity, dirty state tracking, and Ansible execution.

### 6.1 Apply Architecture

```
Apply Page
├── Terraform (VMs)        — existing, works
├── Ansible: Roles         — run role playbooks on assigned hosts
├── Ansible: Containers    — deploy compose files, Caddy, cloudflared
├── Ansible: DNS           — update Pi-hole config
├── Ansible: Ingress       — deploy Caddyfile + tunnel configs (overlaps with Containers)
└── Apply All              — runs everything in order
```

Each section is independently triggerable. "Apply All" runs them in dependency order:
1. Terraform (provision VMs)
2. Ansible Roles (configure hosts)
3. Ansible Containers (deploy services)
4. Ansible DNS (update Pi-hole — depends on knowing container IPs)

### 6.2 Dirty State Indicator

- **Backend**: `GET /apply/status` endpoint returns which areas have changes since last apply
  - Track last-apply timestamp per area in `apply/state.yml`
  - Compare against file modification times in each area's data directory
- **Frontend**: Sidebar "Apply" link shows a dot/badge when any area is dirty
  - Lightweight polling (every 30s) or check on navigation
  - Per-feature Apply buttons on DNS, Ingress, Containers pages also show dirty state

### 6.3 Ansible Execution

The Ansible workspace generated per-run:
```
ansible/
  inventory.yml          # generated from nodes + VMs
  playbook.yml           # generated — applies roles to hosts
  roles/                 # symlinked from repo roles/
  files/
    compose/
      {host}/docker-compose.yml
    caddy/
      {host}/Caddyfile
    cloudflared/
      {host}/config.yml
    dns/
      pihole-custom.conf
```

- **`services/ansible_executor.py`**:
  - `prepare_ansible_workspace(scope)` — generates files for the given scope
  - `run_ansible(playbook, inventory, cwd)` — streams output like Terraform executor
  - SSH keys: writes temp key files from SecretStore, referenced in inventory via `ansible_ssh_private_key_file`

### 6.4 Frontend

- **Rebuild `pages/Apply.tsx`**:
  - Section per apply target with status indicator (clean/dirty)
  - Each section has Plan (dry-run) and Apply buttons
  - Streaming output panel (reuse existing Terraform streaming pattern)
  - "Apply All" button at top
- **Feature-page Apply buttons**: DNS, Ingress, Containers pages get their own Apply buttons that trigger the relevant Ansible scope and redirect to Apply page with output

---

## Phase 7: UX Polish & Cross-cutting

### 7.1 Sidebar Restructure

```
Dashboard
Infrastructure
  ├── Nodes
  ├── VMs
  ├── Images
  ├── Templates
  └── Roles
Containers
DNS
Ingress
Backups
Git
Apply ● (dirty indicator)
Secrets
Settings
```

### 7.2 Apply Dirty Indicator

- Sidebar "Apply" nav item shows a coloured dot when changes are pending
- Any mutation API (create/update/delete on containers, DNS, roles, nodes, VMs) bumps a dirty counter
- Simple approach: backend tracks `last_modified` per area, frontend polls `/apply/status`

### 7.3 Settings Page

Add to existing settings:
- `docker_vols_base`: default volume base path (default: `/var/docker_vols`)
- DNS zones configuration
- Cloudflare API token reference
- ACME email
- Pi-hole host configuration

---

## Implementation Order & Dependencies

```
Phase 1: Roles ──────────────────────────► Foundation for everything
  │
Phase 2: Containers ─────────────────────► Depends on Roles (host_rule: "role:docker")
  │
  ├── Phase 3: DNS ──────────────────────► Depends on Containers (derived records)
  │
  ├── Phase 4: Ingress ──────────────────► Depends on Containers (derived rules)
  │
  └── Phase 5: Backups ──────────────────► Depends on Containers (derived volumes)
  │
Phase 6: Apply Overhaul ─────────────────► Depends on all above
  │
Phase 7: UX Polish ──────────────────────► Final pass
```

Phases 3, 4, 5 can be done in parallel after Phase 2 is complete.

---

## Migration Notes

- **Services → Containers**: rename `services/` directory to `containers/` in homelab repo, update store paths. Old `ServiceDefinition` fields map cleanly to new model. `host` → `hosts: [host]`, `ingress` → derive `ingress_mode`/`ingress_port`, `dns` → derive `dns_name`.
- **VM `role` → `roles`**: one-time migration script, convert string to single-element list.
- **Sidebar "Services" → "Containers"**: update nav entry.
- **API routes**: `/api/services/` → `/api/containers/`. Consider keeping old routes as aliases briefly.
