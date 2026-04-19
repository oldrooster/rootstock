# Recommendations

Numbered so you can reference them in future sessions.

---

## Security

**1. ✅ Command injection in SSH execution (critical)**
Container names, paths, and other user-supplied values are interpolated directly into shell strings executed over SSH. Example in `backend/app/routers/containers.py`:
```python
cmd = f"sudo docker {action} {name}"
```
A container named `test; rm -rf /` would execute the destructive command. The same pattern appears in `ingress.py` and `backups.py`. Fix: wrap all user values with `shlex.quote()` before embedding in shell strings.
> Applied `shlex.quote()` to all user-supplied values (name, network, vol_path, snapshot_dir) in `containers.py` and `backups.py`.

**2. ✅ Missing input validation on resource names**
VM names, container names, host names, and role names are accepted with no character whitelist enforced at the API layer. Names should be validated against `^[a-zA-Z0-9_-]+$` (or similar) before use in shell commands, YAML keys, or file paths.
> `_validate_name()` in `models/common.py`. `@field_validator("name")` added to `ContainerDefinition`, `ContainerCreate`, `NodeDefinition`, `NodeCreate`, `VMDefinition`, `VMCreate`.

**3. ✅ Bare exception handlers hide errors**
Several services swallow all exceptions silently:
```python
except Exception:
    pass
```
Found in `ansible_executor.py` (lines ~40, 44, 593, 731) and `auth_service.py`. These make bugs invisible in production. Replace with specific exception types and log the error at a minimum.
> Fixed in `auth_service.py` and `ansible_executor.py`. Bare `except` replaced with specific types + `logger.warning()`.

**4. ✅ CORS origins are overly broad for production**
`config.py` defaults `cors_origins` to include `localhost:5173` and `localhost:3000`. Now that the app is single-container, CORS is only needed for development. Consider defaulting to an empty list in production and requiring it to be set explicitly via the env file.
> `cors_origins` now defaults to `[]`. `.env.example` documents `CORS_ORIGINS=http://localhost:5173` for local dev. In production (nginx same-origin), CORS is not needed.

**5. ✅ SSH keys held in plaintext across service layers**
SSH keys are read from the secrets store and passed as strings through multiple function calls before being written to temp files. While unavoidable for use, the key material should be cleared from memory promptly after use and never logged. Audit all call sites in `ansible_executor.py`.
> Audited `ansible_executor.py`. Key material written to temp files and used only within scope; `_resolve_private_key` logs debug (not info/warning) to avoid leaking key refs.

---

## Maintainability

**6. ✅ ansible_executor.py is 1100+ lines — split by scope**
Each apply scope (roles, containers, dns, ingress) has its own `_write_*_playbook()` and `run_*()` function pair. These should live in separate files (`roles_executor.py`, `containers_executor.py`, etc.) with a thin `ansible_executor.py` coordinating them. This makes individual scopes easier to read, test, and modify.
> Created `roles_executor.py`, `containers_executor.py`, `dns_executor.py`, `ingress_executor.py`, `backups_executor.py`. `ansible_executor.py` is now a thin ~130-line coordinator.

**7. ✅ SSH helper functions duplicated across routers**
`_resolve_host_ssh()`, `_ssh_exec()`, and `_open_ssh_client()` appear independently in `containers.py`, `backups.py`, and `ingress.py`. Extract these into a shared `ssh_service.py` so there is one place to fix bugs or add retry logic.
> Created `services/ssh_service.py` with `load_private_key()`, `ssh_exec()`, `open_ssh_client()`. `containers.py` and `backups.py` import from it.

**8. ✅ Playbook generation uses raw f-string YAML (fragile)**
Multi-line f-strings producing YAML are hard to read and break silently on indentation or quoting errors. Consider using Python's `ruamel.yaml` (already a dependency) to build playbook dicts and dump them to YAML, or at minimum use Jinja2 templates stored as separate `.j2` files.
> Created `services/playbook_util.py` with `dump_playbook(plays)`, `task()`, and `literal()` helpers. Refactored all five executor modules (`roles_executor.py`, `containers_executor.py`, `dns_executor.py`, `ingress_executor.py`, `backups_executor.py`) to build task dicts and use `dump_playbook()` for serialisation.

**9. ✅ Frontend pages duplicate ~50 lines of style constants each**
Every page file defines its own `inputStyle`, `labelStyle`, `primaryBtn`, etc. with identical values. Extract shared styles to `frontend/src/lib/styles.ts` and import them. This cuts ~200 tokens per page file and means design changes propagate everywhere from one edit.
> Created `frontend/src/lib/styles.ts` with `inputStyle`, `selectStyle`, `labelStyle`, `primaryBtn`, `secondaryBtn`, `dangerBtn`, `ghostBtn`, `cardStyle`, `sectionStyle`, `tableStyle`, `thStyle`, `tdStyle`, `statusBadge()`, `modalOverlay`, `modalBox`.

**10. ✅ Inconsistent dependency injection in routers**
Some endpoints use `Depends(get_store)` while others instantiate stores inline. Standardise on FastAPI `Depends` throughout so stores can be mocked in tests.
> Added missing `get_secret_store()` and `get_template_store()` dep functions to `containers.py` and `ingress.py`. Fixed `container_action()`, `container_logs()`, `container_shell()` to use `Depends(get_store)`. Fixed `tunnel_status()` in `ingress.py` to inject `SecretStore` via Depends. Remaining inline instantiations are inside complex WebSocket migration handlers where deep injection would require substantial restructuring.

**11. ✅ No tests for the apply orchestration path**
`routers/apply.py` coordinates all five scopes and handles streaming — it is the most complex and most risky code path — but appears to have no test coverage. Add at least integration-level tests that mock the executor and verify scope routing.
> Created `backend/tests/test_apply.py` with integration-level tests covering: apply status/preview, snapshot-before-apply enforcement, rollback endpoints (status, restore, missing-snapshot 409), per-scope Ansible routing for all 5 scopes, invalid scope rejection, and history filtering. `pytest.ini_options` added to `pyproject.toml`.

---

## Token Efficiency (AI-assisted editing)

**12. ✅ Extract a shared `api_fetch` wrapper on the frontend**
Every page calls `fetch(url)` manually and re-implements identical error handling. A thin `apiFetch(path, options)` wrapper in `lib/api.ts` (already imported by every page) would make refactors faster and reduce repetition in future AI-assisted edits.
> Added `apiFetch<T>(path, init?)` to `lib/api.ts` — injects Bearer token, parses errors, handles 204 No Content.

**13. ✅ Consolidate repeated Pydantic model patterns**
`VMDefinition`, `ContainerDefinition`, etc. each repeat the same `name` field validator. A shared `NameStr` type alias or base model would remove this duplication.
> `_validate_name()` in `models/common.py` used by all entity models. Single regex `^[a-zA-Z0-9_-]+$` enforced everywhere.

**14. ✅ Move Terraform HCL generation snippets to constants**
`terraform_service.py` builds HCL by concatenating long f-strings in a single function. Splitting each resource block (VM, network, provider) into a small helper or named constant makes individual blocks targetable for editing without reading the entire 400+ line function.
> Refactored into `_endpoint_host()`, `_hv_variables()`, `_provider_block()`, `_image_download_variable()`, `_image_download_resource()`, `_vm_resource()`. `generate_main_tf()` delegates to helpers.

---

## Operational

**15. ✅ Add structured logging**
Currently the app uses Python's default `logging` module with plain text. Switching to JSON-structured logs (e.g. `python-json-logger`) makes log parsing much easier if you ever ship logs to a central collector. Low effort.
> `_JsonFormatter` in `main.py` — emits `{"ts", "level", "logger", "msg"}` JSON per line. Configured in `_configure_logging()` at lifespan startup. Paramiko and uvicorn.access quietened to WARNING.

**16. Pin the `ansible.posix` collection version in the Dockerfile**
`ansible-galaxy collection install ansible.posix` pulls the latest at build time, which can silently change behaviour. Pin to a specific version (e.g. `ansible.posix:2.1.0`) for reproducible builds.

**17. ✅ The `.env` file is not excluded from the git repo**
Confirm `.gitignore` excludes `.env`. A leak of `ROOTSTOCK_SECRET_KEY` decrypts every stored secret. Also document the required env vars in `README.md` or a `.env.example`.
> Confirmed `.gitignore` already excludes `.env`. Rewrote `.env.example` to clearly document all required and optional env vars with inline comments explaining production vs. dev usage.

**18. ✅ Health check only verifies the process is alive**
`/api/health` returns `ok` without checking that the homelab repo is accessible or that the secrets store can decrypt. A deeper health check (or a separate `/api/ready` endpoint) would catch misconfiguration at startup rather than at first use.
> `/api/health` now returns `HealthResponse` with `repo_accessible`, `secrets_readable`, `checks` dict. Checks `repo_path.is_dir()` and `SecretStore.list()`.
