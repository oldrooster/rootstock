# Feature Ideas

Numbered so you can reference them in future sessions. Grouped by area.

---

## Apply / Infrastructure

**1. ✅ Parsed Terraform plan diff viewer**
Instead of streaming raw `terraform plan` output, parse the JSON plan (`terraform show -json`) and render a structured diff — resources to add/change/destroy with colour coding. Much easier to read than wall-of-text logs.
> `POST /api/apply/terraform/plan-diff` runs `terraform plan -out tfplan.binary` then `terraform show -json`, parses `resource_changes` into structured add/change/destroy diff. Frontend "Plan Diff" button on Apply page shows summary bar + collapsible per-resource field diffs with colour-coded before/after values.

**2. ✅ Confirmation gate for Terraform Destroy**
"Destroy" currently runs on a single click. Add a two-step modal that lists the resources that will be destroyed (from the plan output) before allowing the action to proceed.
> Backend: `POST /api/apply/terraform/destroy-preview` runs `terraform plan -destroy` and parses resource names. Frontend: clicking Destroy runs the preview, shows the resource list, then requires "Confirm Destroy".

**3. ✅ Per-scope apply history / log archive**
Store the last N apply runs (timestamp, scope, exit code, truncated log) in a JSON file in the homelab repo. Surface this as a simple log history panel on the Apply page so you can see what ran and when without checking git.
> `apply_history.py` + `GET /api/apply/history`. Terraform apply and all Ansible scopes call `record_run()`.

**4. Auto-apply on git pull**
Add an optional setting: after a successful `git pull` that changes specific config files, automatically trigger the relevant apply scopes. Useful for fleet updates pushed from another machine.

**5. ✅ Rollback to previous state**
Before each Terraform apply, snapshot the state file. Add a "Rollback" button that restores the previous snapshot, for cases where an apply partially succeeds.
> `snapshot_state()` / `rollback_state()` in `terraform_executor.py`. `POST /api/apply/terraform/rollback` and `GET /api/apply/terraform/rollback-status`. "Rollback" button with confirmation in the Terraform section of the Apply page.

---

## VMs & Containers

**6. ✅ VM / container status live badges**
Poll the Proxmox API and Docker daemon to show live running/stopped/error badges on the VM and Container list pages, rather than just the declared config state.
> Containers page polls `GET /api/containers/status/all` on load and via "Refresh Status" button. Badges: healthy/unhealthy/starting/running/partial/stopped/not provisioned/disabled. VMs page polls Proxmox power status per VM.

**7. ✅ Bulk enable/disable with checkboxes**
Add a checkbox column to VM and Container list tables. A toolbar appears when items are selected with bulk actions: enable, disable, delete, change host.
> Checkboxes on each container card, sticky bulk toolbar with Enable / Disable / Delete. Selected cards highlighted with blue outline.

**8. ✅ Container log viewer with search**
The streaming log modal could support:
- Text search / highlight
- Follow vs. scroll-to-top toggle
- Download log as file
- Clear / refresh
> Search input filters lines and highlights matches. Follow checkbox toggles auto-scroll. Download button saves log as file.

**9. ✅ One-click VM/container clone**
"Duplicate" button on a VM or container that pre-fills the create form with the same settings, just a different name.
> `POST /api/vms/{name}/clone?new_name=` and `POST /api/containers/{name}/clone?new_name=` endpoints added.

**10. Resource usage display per VM**
If Proxmox API credentials are configured, show CPU / RAM / disk usage for each VM inline in the list and in a detail panel. Already partially supported via the Stats page; surface it in context.

---

## Hosts & Nodes

**11. Node connectivity dashboard**
A dedicated view that pings each host via SSH and shows: reachable/unreachable, SSH latency, disk/memory from a lightweight remote command. One-stop health check for the whole fleet.

**12. SSH key push to new hosts**
A guided workflow for onboarding a new host: enter root password once, Rootstock pushes the SSH key and runs initial setup — rather than doing it manually before adding the node.

**13. Host labels / tags**
Free-form tags on hosts (e.g. `prod`, `storage`, `proxmox`) that can be used to filter which hosts roles or containers are targeted at. Useful as the fleet grows.

---

## DNS & Ingress

**14. DNS record browser**
Read the current Pi-hole custom list and show all records in a searchable table with inline edit/delete, instead of only showing what Rootstock manages.

**15. ✅ Ingress service health check**
For each Caddy reverse proxy entry, make an HTTP request to the upstream and show a green/red badge. Surfaces broken upstreams before users notice.
> `GET /api/ingress/health` async-probes all upstreams and returns `{name, hostname, backend, status, http_code, latency_ms}`.

**16. ✅ Cloudflare tunnel status panel**
Show whether each configured tunnel is connected, its last heartbeat, and traffic stats from the Cloudflare API.
> `GET /api/ingress/tunnel-status` fetches tunnel connection data from Cloudflare API.

---

## Secrets & Security

**17. Secret expiry / rotation tracking**
Add optional `expires_at` and `last_rotated` metadata fields to secrets. Show a warning badge on the Secrets page for secrets past their expiry.

**18. Secret audit log**
Log every read and write of the secrets store (secret name, operation, timestamp) to an append-only file. Surfaced in the UI as a simple access log.

**19. Multiple user accounts**
The auth system currently supports one user. Add basic multi-user support with a read-only role (can view config, cannot apply or change secrets).

---

## Git & Config

**20. Visual git diff viewer**
On the Git page, show the diff of uncommitted changes in a syntax-highlighted side-by-side view, not just the raw status. Lets you review what Rootstock has changed before pushing.

**21. Scheduled git push**
Option to automatically push the homelab repo on a cron schedule (e.g. every night), so changes are backed up to a remote without manual action.

**22. Config file editor**
Escape hatch: a code editor (Monaco or CodeMirror) for directly editing the raw YAML config files in the homelab repo, for settings the UI doesn't expose.

---

## UI / Layout

**23. ✅ Global search / command palette**
`Ctrl+K` opens a fuzzy-search palette across all VMs, containers, hosts, roles, and secrets. Selecting a result jumps to the relevant page. Makes navigation much faster as the fleet grows.
> `CommandPalette.tsx` — fuzzy search with ⌘K/Ctrl+K, arrow navigation, category grouping, keyboard shortcuts.

**24. Dashboard customisation**
Let users pin/reorder the widget cards on the Dashboard page (last apply times, dirty-state counts, resource totals). Currently the layout is fixed.

**25. ✅ Dark/light theme toggle**
The app is hard-coded dark. A toggle (stored in localStorage) for a lighter theme would help on high-brightness displays.
> `ThemeContext.tsx` with CSS custom properties. Theme persisted in localStorage. Toggle button in Sidebar.

**26. ✅ Mobile-friendly layout**
The current sidebar + table layout doesn't work on small screens. A collapsible sidebar and responsive table (cards on mobile) would make it usable from a phone for quick checks.
> Sidebar has hamburger button + slide-out drawer on screens <768px. Overlay backdrop to close.

**27. Apply page: expandable scope cards**
Instead of all five scopes always visible, collapse each scope into a card. Expand a card to see the dirty file list and run controls. Reduces visual noise when most scopes are clean.

**28. ✅ Notification / toast system**
Currently success/error feedback is inline per action. A global toast system (top-right corner) for async operations (apply completed, backup finished) would be more consistent and visible.
> `ToastContext.tsx` — `useToast()` hook, `ToastProvider`, auto-dismiss at 5s, success/error/info/warning types.

---

## Backups

**29. ✅ Backup schedule UI**
The backup cron configuration is spread across settings. Consolidate into a visual schedule builder (select days/time) rather than raw cron strings.
> Inline schedule builder on Backups page: day picker (Sun-Sat buttons), hour/minute selectors, live cron description preview. Saves to global_settings.

**30. ✅ Backup restore workflow**
A guided restore flow: pick a backup file, pick target host, confirm and stream the restore output — rather than requiring manual SSH.
> Restore dialog already present with host selection, snapshot listing by date, volume selection, and streamed restore steps via WebSocket.

**31. ✅ Backup size tracking over time**
Show a simple chart of backup size per target over time, to spot runaway growth before storage fills up.
> "Backup Size by Path" horizontal bar chart: paths sorted by size, colour-coded (blue/amber/red by relative fill level), size labels on right. Backed by `GET /api/backups/stats`.
