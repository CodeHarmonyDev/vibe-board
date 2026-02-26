# MCP Migration Plan (Convex + Local Go Worker)

## 1) Objective
Ensure the Vibe Kanban MCP integration remains fully functional after Rust backend migration by preserving:
- External MCP client workflow (Claude Desktop, Raycast, VS Code MCP clients, internal agents)
- Tooling contract and semantics documented publicly
- Local-only execution safety guarantees
- Workspace-aware behavior (context, execution, repo targeting)

This plan covers MCP-specific implementation requirements for Convex + website + local Go worker.

## 2) Source documentation (external contract)
- [Vibe Kanban MCP Server](https://www.vibekanban.com/docs/integrations/vibe-kanban-mcp-server)
- [Connecting MCP Servers](https://www.vibekanban.com/docs/integrations/mcp-server-configuration)
- [Raycast MCP documentation](https://manual.raycast.com/model-context-protocol)

## 3) Public MCP behavior to preserve

### 3.1 Positioning and deployment model
- MCP server is local-only and accessed by locally installed MCP clients.
- Public docs configure client transport via a local command:
  - `npx -y vibe-kanban@latest --mcp`
- MCP usage supports both:
  - external MCP clients
  - coding agents inside Vibe Kanban

### 3.2 Documented tool categories
Documented categories and tools:
- Project operations: `list_projects`, `list_repos`
- Context: `get_context`
- Task management: `list_tasks`, `create_task`, `get_task`, `update_task`, `delete_task`
- Repository management: `list_repos`, `get_repo`, `update_setup_script`, `update_cleanup_script`, `update_dev_server_script`
- Task execution: `start_workspace_session`

Documented execution params:
- `start_workspace_session`: requires `task_id`, `executor`, `repos`; optional `variant`
- `repos` entries require `repo_id`, `base_branch`

Documented supported executors:
- `claude-code`, `amp`, `gemini`, `codex`, `opencode`, `cursor_agent`, `qwen-code`, `copilot`, `droid`

## 4) Current Rust MCP implementation (repo reality)

### 4.1 Runtime model
- MCP server runs over stdio (`crates/mcp/src/bin/mcp_task_server.rs`).
- It discovers backend base URL via:
  - `VIBE_BACKEND_URL`, or
  - host+port envs / port file.
- It calls HTTP backend endpoints directly (`/api/*`).

### 4.2 Tool surface currently implemented
Current router includes tools (non-exhaustive groups):
- Workspaces: `list_workspaces`, `update_workspace`, `delete_workspace`
- Organizations: `list_organizations`, `list_org_members`
- Projects: `list_projects`
- Issues: `list_issues`, `create_issue`, `get_issue`, `update_issue`, `delete_issue`
- Issue helpers: priorities, assignees, tags, relationships
- Repos: `list_repos`, `get_repo`, setup/cleanup/dev script updates
- Execution: `start_workspace_session`, `link_workspace`
- Context: `get_context` (registered only when workspace context exists)

### 4.3 Important mismatch vs public docs
Observed mismatches between public docs and current Rust code:
- Docs use task terms (`list_tasks`, `create_task`, etc.); code exposes issue terms (`list_issues`, `create_issue`, etc.).
- Docs show `start_workspace_session` using `task_id`; code expects `title` + prompt (or `issue_id`) and repo branches.
- Docs describe repo listing scoped by project; code `list_repos` currently lists global repos without project parameter.
- `list_projects` in code requires explicit `organization_id`; docs present simpler project-first workflow.

Migration implication:
- Convex implementation must define and enforce a compatibility strategy (aliases/adapters/versioning), not assume current Rust and public docs already match.

## 5) Required target architecture for MCP

### 5.1 Components
- `mcp-local` (Go): local stdio MCP server process for MCP clients.
- Convex: authz, business state, workflow orchestration, realtime updates, durable operations.
- Go worker: local privileged execution (worktree, git, shell, PTY), already required by broader migration.

### 5.2 Connectivity
- MCP clients talk to local stdio MCP process only.
- MCP process calls Convex APIs (authenticated) for metadata and workflow mutations.
- Convex dispatches local execution jobs to enrolled Go worker via device-targeted queue.
- No inbound public endpoint on local machine for remote execution triggering.

## 6) MCP tool compatibility strategy (mandatory)

### 6.1 Compatibility rules
- Keep existing tool names used by active clients.
- Add documented aliases where mismatches exist.
- Return structured payloads with stable fields and explicit deprecation metadata when applicable.
- Keep behavior deterministic and idempotent for mutation tools.

### 6.2 Recommended alias map
- `list_tasks` -> backed by canonical issue/task store (Convex)
- `create_task` -> create issue/task record
- `get_task` -> issue/task detail
- `update_task` -> issue/task update
- `delete_task` -> issue/task delete
- Preserve `list_issues`/`create_issue` etc. as compatibility aliases if currently in use.

### 6.3 `start_workspace_session` compatibility
Support both request shapes during migration:
- Shape A (documented): `{ task_id, executor, repos, variant? }`
- Shape B (current Rust): `{ title, prompt_override?, executor, repos, issue_id?, variant? }`

Normalize both into one internal command model before dispatch.

## 7) Security model for MCP + Convex (mandatory)

### 7.1 Threat model
- Unauthorized local or remote caller tries to invoke MCP operations that trigger local execution.
- Replay of prior execution requests.
- Cross-device or cross-org command triggering.

### 7.2 Required controls
- Clerk-authenticated identity bound to MCP session and Convex mutations.
- Device enrollment and `target_device_id` enforcement for execution jobs.
- Local MCP process only executes allowed tool handlers; no arbitrary shell passthrough.
- Convex mutation authz checks on every privileged MCP action.
- Job TTL + nonce/idempotency key enforcement.
- Local approval gates for high-risk operations.
- Immediate device/session revocation support.
- Audit log entries for all privileged MCP calls and execution dispatches.

## 8) Convex implementation requirements

### 8.1 API layer
- Define Convex functions for all MCP tools (canonical set + aliases).
- Add strict validators for inputs and outputs.
- Add versioned tool schema metadata for client compatibility checks.
- Preserve workspace-context capability (`get_context`) when active workspace is detectable.

### 8.2 Data requirements
- Durable records for:
  - MCP request audit entries
  - workspace/session/task(issue) entities
  - execution dispatch intents and terminal states
  - approvals and queued follow-ups

### 8.3 Orchestration
- `start_workspace_session` writes orchestration intent in Convex.
- Go worker consumes authorized device-targeted job.
- Worker posts execution lifecycle updates back to Convex for UI/MCP visibility.

## 9) Local MCP process implementation requirements (Go)

### 9.1 Transport/runtime
- stdio MCP server process.
- Command-line launch contract compatible with existing docs (`vibe-kanban --mcp` path retained via wrapper if needed).
- Fast startup and graceful shutdown behavior for desktop MCP clients.

### 9.2 Context resolution
- Preserve "context available only when in active workspace directory/session" semantics for `get_context`.
- Keep local path normalization and safe mapping to workspace identity.

### 9.3 Error model
- Return tool errors as structured, actionable responses.
- Distinguish user errors (bad args) from system errors (network/auth/runtime).

## 10) Gap closure tasks
- [ ] Define canonical MCP tool schema set for Convex era.
- [ ] Decide compatibility mode (documented-task vocabulary primary with issue aliases, or issue vocabulary primary with documented aliases).
- [ ] Implement tool aliasing and deprecation policy.
- [ ] Implement dual-shape `start_workspace_session` normalization.
- [ ] Implement auth-bound MCP session to Clerk/Convex identity.
- [ ] Implement device-bound execution dispatch and replay protection.
- [ ] Implement audit logging for all MCP privileged operations.
- [ ] Validate with Raycast + at least one additional MCP client.

## 11) Must-pass tests
- [ ] MCP startup via local command works with stdio clients.
- [ ] `get_context` present only when workspace context is available.
- [ ] Project/task(repo/issue) listing and CRUD tools return expected schema.
- [ ] `start_workspace_session` works for both documented and legacy request shapes.
- [ ] Unauthorized caller cannot trigger execution dispatch.
- [ ] Cross-device dispatch attempts are rejected.
- [ ] Replay requests are rejected by nonce/TTL/idempotency checks.
- [ ] End-to-end workflow (plan -> create tasks -> start execution) succeeds from MCP client.

## 12) References in this repo
- MCP runtime entrypoint: `crates/mcp/src/bin/mcp_task_server.rs`
- MCP server wiring/context load: `crates/mcp/src/task_server/mod.rs`
- MCP tool instruction surface: `crates/mcp/src/task_server/handler.rs`
- MCP tool implementations: `crates/mcp/src/task_server/tools/*.rs`
