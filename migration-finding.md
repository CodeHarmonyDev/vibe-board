# Rust Backend Migration Findings (Convex Planning)

## 1) Scope and intent
This document analyzes the Rust backend surface in `crates/` for migration planning from Rust backend services to a Convex-backed architecture. It focuses on runtime behavior, persistence, API contracts, orchestration semantics, and security-critical behavior that must be preserved.

Related auth-focused plan:
- `migration-auth.md` (Clerk migration track)

### In-scope crates
- `crates/server`
- `crates/deployment`
- `crates/local-deployment`
- `crates/services`
- `crates/db`
- `crates/git`
- `crates/git-host`
- `crates/executors`
- `crates/mcp`
- `crates/api-types`
- `crates/utils`
- `crates/review` (secondary, CLI product)

### Out-of-scope for immediate parity
- `crates/remote` runtime internals (workspace excludes `crates/remote` from Cargo workspace)
- Frontend migration details (covered elsewhere)

## 2) Workspace and crate topology
Root Cargo workspace members:
- `api-types`
- `server`
- `mcp`
- `db`
- `executors`
- `services`
- `utils`
- `git`
- `git-host`
- `local-deployment`
- `deployment`
- `review`

`crates/remote` exists but is explicitly excluded in root `Cargo.toml`.

## 3) Runtime architecture (current Rust backend)

### 3.1 Server startup and lifecycle (`crates/server/src/main.rs`)
Startup sequence:
1. Install rustls crypto provider.
2. Initialize Sentry/tracing.
3. Ensure assets directory exists.
4. One-time DB file upgrade copy: `db.sqlite` -> `db.v2.sqlite` if needed.
5. Build deployment (`DeploymentImpl = LocalDeployment`).
6. Run startup maintenance:
- `cleanup_orphan_executions`
- `backfill_before_head_commits`
- `backfill_repo_names`
7. Start main API server and preview proxy server (separate listeners).
8. Write port file with both main/proxy ports.
9. On shutdown: kill running execution processes.

### 3.2 Deployment abstraction
`Deployment` trait (`crates/deployment/src/lib.rs`) centralizes access to:
- Config
- DB
- Analytics
- Container service
- Git/repo/image/filesystem/events
- Approvals and queued messages
- Auth context and optional remote client

`LocalDeployment` (`crates/local-deployment/src/lib.rs`) composes all local services and owns cross-service startup behavior.

### 3.3 LocalDeployment boot behavior
- Runs one-time migration from DB-stored execution logs to filesystem JSONL.
- Loads/migrates config (`v8` schema currently).
- Optionally sets custom workspace base dir override.
- Creates DB with SQLite update hooks for event streaming.
- Initializes image service and orphan image cleanup background task.
- Loads OAuth refresh credentials from disk.
- Optionally initializes remote client (`VK_SHARED_API_BASE`).
- Starts PR monitor background task.
- Creates PTY service.

## 4) API surface inventory

### 4.1 Router composition (`/api`)
`crates/server/src/routes/mod.rs` mounts:
- `/health`
- `/config/*`
- `/containers/*`
- `/task-attempts/*`
- `/execution-processes/*`
- `/tags/*`
- `/auth/*` (oauth)
- `/organizations/*`
- `/filesystem/*`
- `/repos/*`
- `/events/*`
- `/approvals/*`
- `/scratch/*`
- `/search`
- `/migration/*`
- `/sessions/*`
- `/terminal/ws`
- `/remote/*`
- `/images/*`

Routing density:
- ~137 route/nest declarations under server routes.

### 4.2 API middleware and security gates
- API routes are wrapped with custom origin validation middleware (`ValidateRequestHeaderLayer::custom(validate_origin)`).
- `Origin: null` is blocked.
- Loopback normalization (`localhost`, `127.0.0.1`, `::1`) is implemented.
- Configurable allowlist from `VK_ALLOWED_ORIGINS`.

### 4.3 High-value route groups
- `task_attempts`: core workspace orchestration, git operations, PR, dev server, streams, link/unlink remote, summary.
- `sessions`: follow-up, reset-to-process, review execution, queue handling.
- `execution_processes`: status/log streams/stop/repo-state retrieval.
- `containers`: workspace context lookup by path (used by MCP and integrations).
- `migration`: local-to-remote migration endpoint (`/migration/start`).
- `oauth`: handoff init/redeem, status, token, current user, logout.
- `remote`: proxy/bridge endpoints for remote resources.
- `terminal`: WS PTY transport.

## 5) Execution orchestration model (core behavior)

### 5.1 Primary abstraction
`ContainerService` (`crates/services/src/services/container.rs`) defines orchestration contract:
- Workspace/container creation and cleanup
- Execution lifecycle start/stop
- Session reset to prior process
- Setup/cleanup/archive action chains
- Diff/log streaming
- Startup maintenance backfills

### 5.2 Local implementation (`crates/local-deployment/src/container.rs`)
Execution flow details:
- `start_execution` creates execution record first, including per-repo `before_head_commit` snapshot.
- `start_execution_inner` spawns executor process with `ExecutionEnv` and injected context vars:
- `VK_WORKSPACE_ID`
- `VK_WORKSPACE_BRANCH`
- `VK_SESSION_ID`
- Exit monitor handles process completion, status update, optional commit, next-action chaining, queue consumption, finalization, remote sync, analytics.
- Per-repo `after_head_commit` updated post-execution.

### 5.3 Action chaining semantics
`ExecutorAction` supports linked actions (`next_action`) for:
- Setup scripts
- Coding agent execution
- Cleanup scripts
- Archive scripts

Setup behavior:
- If all setup scripts are `parallel_setup_script=true`, setup actions start independently and coding action starts separately.
- Otherwise setup scripts chain into coding action.

### 5.4 Session reset semantics
`reset_session_to_process`:
- Uses `ExecutionProcessRepoState.before_head_commit` (or previous process fallback) to reconcile repo state.
- Can perform/skip git reset, can force when dirty.
- Drops process history at and after target process.

### 5.5 Queue semantics
Per-session queued follow-up message exists in memory (`QueuedMessageService`):
- Consumed only when current execution finalizes successfully.
- Cleared/discarded on failed/killed execution.

## 6) Workspace and worktree management

### 6.1 Multi-repo workspace model
- Workspace contains one or more repos via `workspace_repos`.
- Physical layout: `workspace_dir/{repo_name}` per repo worktree.

### 6.2 Worktree safety (`worktree_manager.rs`)
- Per-worktree async locking to avoid race conditions.
- Comprehensive cleanup of filesystem + git worktree metadata before recreation.
- Uses git CLI for mutable worktree operations.
- Safety rule for custom workspace dir override:
- actual managed location is nested `.vibe-kanban-workspaces` under user override.
- prevents orphan cleanup from touching arbitrary user directories.

### 6.3 Cleanup jobs
- Periodic cleanup of expired workspaces.
- Orphan workspace detection/cleanup.
- `DISABLE_WORKTREE_CLEANUP` env can disable cleanup behavior.

## 7) Git and PR integration

### 7.1 Git service strategy
`crates/git` deliberately uses hybrid model:
- CLI for mutable operations (checkout/rebase/merge/worktree/add/commit/push)
- libgit2 for read/query/diff graph operations

Rationale in `git/src/cli.rs`:
- safer working tree semantics
- sparse-checkout correctness
- cross-platform stability

### 7.2 Git host provider abstraction (`crates/git-host`)
Providers:
- GitHub (`gh` CLI)
- Azure DevOps (`az` CLI)

Behavior:
- PR creation/status/list/comments via provider adapters
- Retries with exponential backoff for transient failures
- Azure gap: `list_open_prs` currently returns `UnsupportedProvider` (TODO)

### 7.3 PR/workspace coupling
- PR create and attach update `merges` table.
- PR merged events can archive workspace when no open PRs remain.
- PR monitor background service polls every minute for open PR status transitions.

## 8) Persistence model (SQLite + SQLx)

### 8.1 DB runtime
`crates/db/src/lib.rs`:
- SQLite at assets path: `db.v2.sqlite`
- SQLx migrations on startup
- journal mode: `DELETE`
- Windows-only migration checksum mismatch workaround

### 8.2 Model inventory
Main DB model files:
- `workspace`
- `workspace_repo`
- `session`
- `execution_process`
- `execution_process_repo_state`
- `coding_agent_turn`
- `repo`
- `merge`
- `scratch`
- `image` + `workspace_images`
- `migration_state`
- legacy/shared: `project`, `task`, `tag`

### 8.3 Data shape highlights
- `Workspace`: lifecycle flags (`archived`, `pinned`), `container_ref`, branch, optional name.
- `Session`: executor affinity for follow-ups.
- `ExecutionProcess`: run reason enum (`setup/cleanup/archive/coding_agent/devserver`), status enum, dropped flag.
- `ExecutionProcessRepoState`: before/after/merge commit per repo.
- `CodingAgentTurn`: stores prompt/summary + agent session/message ids + seen flag.
- `Repo`: script/config fields moved to repo-level (`setup/cleanup/archive/dev_server/copy_files/parallel/default branch/workdir`).
- `Merge`: discriminated direct merge vs PR merge.
- `Scratch`: typed UI/runtime draft state store.

### 8.4 Migration chronology (important)
Observed migration themes:
- Early `task_attempts` model refactored to `workspaces + sessions`.
- Multi-repo support introduced via repo junction tables.
- Script config moved from projects/project_repos to repos.
- Execution logs moved from DB rows to filesystem JSONL.
- `migration_state` introduced for local->remote migration tracking.
- `workspace_images` junction introduced.

Important migrations examined:
- `20250617183714_init.sql` (base schema)
- `20251216142123_refactor_task_attempts_to_workspaces_sessions.sql`
- `20260107000000_move_scripts_to_repos.sql`
- `20260217120312_remove_task_fk_from_workspaces.sql`

## 9) Streaming/event architecture

### 9.1 Event source
`EventService` uses SQLite hooks (`preupdate` + `update`) to produce JSON patch updates for:
- workspaces
- execution processes
- scratch
- approvals (via approvals patch stream integration)

### 9.2 Transport endpoints
- WS/SSE streams across workspaces, execution processes, logs, diffs, approvals, events.
- `LogMsg` protocol includes stdout/stderr/json_patch/session_id/message_id/ready/finished.

### 9.3 Log storage model
- Runtime logs buffered in memory (`MsgStore`) with bounded history bytes.
- Persisted to JSONL files per execution.
- Legacy DB logs migration path retained as fallback read path.

## 10) OAuth, auth, and remote sync

Detailed Clerk migration planning is tracked in `migration-auth.md`.

### 10.1 OAuth flow
`/auth/handoff/init` -> `/auth/handoff/complete` via remote OAuth service.
- Stores pending handoff verifier in-memory keyed by UUID.
- Redeems auth code to access + refresh token.
- Saves credentials to disk (refresh token only persisted).

### 10.2 Credential persistence
`OAuthCredentials`:
- stores refresh token in JSON file
- Unix permissions set to `0600`
- corrupt file renamed to `.bad`

### 10.3 Remote client behavior
`RemoteClient`:
- typed wrappers around `/v1/*` endpoints
- auth token refresh with lock and leeway
- retries for transient transport/5xx errors
- optional remote mode depending on `VK_SHARED_API_BASE`

### 10.4 Post-login synchronization
On login, background sync pushes linked workspace/PR state to remote via `remote_sync`.

## 11) Terminal subsystem
- PTY sessions per workspace over WebSocket.
- Base64 framed input/output/resize commands.
- Working dir selects single repo subdir when applicable.
- Shell-specific startup behavior and env markers.

## 12) MCP coupling
`crates/mcp` task server depends on backend HTTP APIs:
- Reads backend port file or env URL.
- Calls `/api/containers/attempt-context` for startup context.
- Uses `/api/*` endpoints for workspace/session/remote issue/project/tag/org operations.

Implication: Backend API compatibility is part of migration scope even if internal implementation changes.

## 13) Security and reliability findings (Rust baseline)

### Finding A: JWT claims parsed with insecure decode
Location: `crates/utils/src/jwt.rs`
- Uses `jsonwebtoken::dangerous::insecure_decode` for `exp` and `sub` extraction without signature verification.
- Current usage is for token metadata handling (expiration/subject extraction), not trust validation against app-issued signatures.
- Risk: accidental future misuse could treat unverified claims as trusted auth context.

Migration requirement:
- Keep strict boundary: claim parsing must never be treated as proof of identity.
- In Convex migration, verify tokens via trusted provider/JWKS where identity decisions are made.

### Finding B: Preview proxy intentionally strips browser protections
Location: `crates/server/src/preview_proxy/mod.rs`
- Removes CSP, X-Frame-Options, and related headers for proxied preview content.
- Injects helper/devtools scripts.
- This is functional for embedded preview UX but expands attack surface if boundaries fail.

Migration requirement:
- Preserve isolation boundary with explicit hardening if feature retained.
- Ensure strict host/port routing validation and never expose this channel beyond local trusted context.

### Finding C: Script execution surface is high-privilege
- Repo-level scripts (`setup/cleanup/archive/dev`) execute in local environment.
- Agent/executor runs shell-based tools.

Migration requirement:
- Convex side must not attempt to execute untrusted shell scripts.
- Keep local runner with explicit approvals/sandbox controls.

### Finding D: Approvals are in-memory
- Approval lifecycle state is runtime memory; restart loses pending requests.

Migration opportunity:
- Persist approvals in Convex for resilience and auditability.

### Finding E: Queue state is in-memory
- Queued follow-up message is in-memory only.

Migration opportunity:
- Move queue state into durable Convex table with session/workspace scope.

## 14) Critical migration constraints for Convex

### 14.1 What cannot be moved directly into Convex runtime
- Long-running local process orchestration
- PTY management
- Local filesystem worktree lifecycle
- Native git worktree mutation via CLI

These require a local sidecar/agent runner service, with Convex as state/control plane.

### 14.2 Required control-plane capabilities in Convex
Convex must own at least:
- Durable source of truth for entities/state transitions
- Event stream semantics for frontend updates
- Workflow state machine for execution lifecycle
- Approval and queue durability
- API shape compatibility for frontend and MCP tools

### 14.3 Local runner responsibilities after migration
- Execute scripts/agents on developer machine
- Manage worktree/container_ref physical directories
- Stream logs/diff metadata to Convex
- Perform git mutable operations

## 15) API compatibility and contract obligations

### 15.1 Type contract source
TypeScript contract is generated from Rust via `crates/server/src/bin/generate_types.rs`.
It exports a large set of models and API payload types consumed by frontend and integrations.

Migration requirement:
- Introduce a canonical schema contract (likely TypeScript-first for Convex) and enforce backward-compatible response shapes for existing clients.

### 15.2 Compatibility targets
Must preserve or provide controlled migration path for:
- `/api/task-attempts/*` behavior
- `/api/sessions/*` behavior
- `/api/execution-processes/*` streams
- `/api/containers/attempt-context`
- `/api/approvals/*`
- `/api/scratch/*`
- `/api/repos/*`
- `/api/remote/*` bridge endpoints (if still needed)

## 16) Domain model mapping candidates (Rust -> Convex)

### Core entities
- `Workspace`
- `WorkspaceRepo`
- `Session`
- `ExecutionProcess`
- `ExecutionProcessRepoState`
- `CodingAgentTurn`
- `Repo`
- `Merge`
- `Scratch`
- `Image` + `WorkspaceImage`
- `Approval`
- `QueuedMessage`

### Legacy/bridge entities
- `Project`, `Task`, `Tag`, `MigrationState` (still present for remote migration and historical compatibility)

## 17) High-risk parity behaviors to preserve
- Multi-repo setup chaining semantics (parallel vs sequential).
- Session follow-up continuity using agent session/message ids.
- `before_head_commit` / `after_head_commit` semantics for reset/reconciliation.
- Auto-archive behavior on merged PR with open-PR count checks.
- Process drop/reset semantics (`dropped` visibility rules).
- Workspace cleanup safety rules (never over-delete user directories).
- Image path traversal protections and canonical path checks.
- Origin validation policy for API routes.

## 18) Notable technical debt discovered
- Migration service still depends on `workspace.task_id` chains; this legacy coupling should be retired in Convex-native model.
- Azure provider missing open PR listing support parity.
- Approvals and queue are non-durable in memory.
- Heavy coupling between backend API shapes and MCP tools means hidden migration blast radius.

## 19) Recommended migration architecture (from findings)

### Recommended target split
- Convex: authoritative data model, API/query/mutation layer, durable workflow states, subscriptions.
- Local runner service (Node/Rust sidecar): executes local git/shell/PTY workloads and reports state/logs back to Convex.

### Why this split
- Matches Convex strengths (state + realtime + transactions).
- Avoids forcing unsupported local compute semantics into Convex runtime.
- Preserves existing UX/workflow model while reducing backend complexity over time.

## 20) Definition of done for parity/security
The migration should only be considered complete when:
1. All critical workspace/session/execution flows behave equivalently.
2. Frontend and MCP contracts are backward compatible or versioned with migration path.
3. Security controls (origin validation, path safety, approval gates, token handling boundaries) are maintained or improved.
4. Durable state replaces in-memory-only operational data where correctness matters.
5. Failure/restart behavior is deterministic and test-covered for queued work, approvals, and execution states.
