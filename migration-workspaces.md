# Workspace Migration Spec (Convex + Web + Go Runner)

## 1) Purpose
Define the canonical workspace behavior that must be preserved when replacing the Rust backend with:
- Convex as control/data/realtime backend
- Website frontend connected directly to Convex
- Local Go worker for privileged local execution (git, shell, PTY)

This document is implementation-facing and should be treated as a parity/security contract.

## 2) Canonical workspace concept (product behavior to preserve)

### 2.1 Domain model
- `Project`: a configured grouping of repositories.
- `Workspace`: a task execution environment tied to a project and branch namespace.
- `Repository`: one git repository included in a workspace (single or multi-repo).
- `Session`: one conversation thread with a coding agent inside a workspace.

Required relationship rules:
- One workspace can include one or more repositories.
- One workspace can include multiple sessions.
- Repository git state is tracked independently per repository inside the same workspace.
- Sessions share the workspace files but keep independent conversation history/context.

### 2.2 Isolation and git guarantees
- Creating a workspace creates git worktrees for selected repositories on a workspace branch.
- The user’s original checked-out repo working directory is not modified directly.
- Changes are isolated to workspace worktrees until user-triggered git actions (commit/push/PR).
- Multiple workspaces are independent (branch state, sessions, changes, execution status).
- Agent execution must not auto-push or auto-merge without explicit user action.

### 2.3 Workspace creation behavior
Must support:
- Selecting project.
- Selecting one or many repositories.
- Entering task prompt/title.
- Choosing branch name (auto-generated or custom, with conflict checks).
- Choosing coding provider/model/planning mode (as applicable).
- Auto-starting first session after successful workspace creation.

Validation requirements:
- Reject branch conflicts for selected repos when configured policy requires uniqueness.
- Fail atomically: no partial workspace persisted as "ready" if repo worktrees fail.
- Capture enough metadata for deterministic recreation/retry.

### 2.4 Workspace lifecycle behavior
Must support:
- Switch workspace.
- Rename workspace.
- Pin/unpin workspace.
- Archive workspace (soft-delete semantics).
- Delete workspace (hard-delete semantics).

Archive behavior:
- Removed from active view by default.
- Workspace history remains recoverable.
- Branch/worktree retention policy must be explicit and reversible.

Delete behavior:
- Removes workspace metadata from active dataset.
- Cleans local managed worktree paths only.
- Must never delete user repos outside managed workspace directories.

### 2.5 Repository panel behavior
Must support per-repo:
- Enable/disable for agent execution scope.
- Repo-scoped git status visibility.
- Repo-specific working directory context.
- Repo-scoped operations in multi-repo workspaces.

Routing rule:
- Commands without explicit repo target use active repo context.
- Explicit repo targeting (`/repo-name ...`) overrides active repo.

### 2.6 Session behavior
Must support:
- Create new session in existing workspace.
- Switch between sessions without losing history.
- Keep session-specific conversation context and metadata.
- Resume follow-ups in same session.

Execution/state behavior:
- Session status surfaced as `running`, `idle`, `needs_attention`, `error` (or equivalent mapped states).
- If user sends message while a run is active, follow-up is queued and executed after current run terminal success path (with explicit failure behavior).

### 2.7 Chat behavior
Must support:
- Message history (user/assistant/system/approval).
- Prompt submission and run status indicators.
- Approval requests and user responses.
- Retry/edit flows on previous messages.
- Streaming output and completion markers.

Reliability requirement:
- Queue and approval state are durable across frontend refresh and service restart.

### 2.8 Slash command behavior
Must preserve slash-command-driven workflows used in workspace UI.
Observed command categories to preserve:
- Session: `/new-session`, `/follow-up`, `/summary`
- Execution: `/run`
- Git/PR: `/commit`, `/pr`, `/attach`, `/diff`, `/git-status`
- Repo context: `/set-active-repo` and repo-prefixed command routing (`/repo-name ...`)

Compatibility rule:
- Existing commands can be remapped internally, but user-visible behavior and safety gates must remain equivalent.

### 2.9 Command bar behavior
Must support command-bar actions for:
- Workspace actions (create/open/archive/delete)
- Session actions (new/open)
- Git actions (commit/push/create PR)
- Execution actions (start/stop agent)
- UI navigation/focus actions

Command bar must remain a first-class fast path, not a secondary feature.

### 2.10 Multi-repo session behavior
Must preserve:
- Simultaneous context over multiple repositories in one workspace.
- Repo-specific command execution plus cross-repo reasoning.
- Per-repo changed-files visibility.
- Ability to focus an active repo while still exposing full workspace context.

### 2.11 Changes and git-operations behavior
Must support:
- Per-repo and workspace-wide changed file views.
- Diff inspection with status (add/modify/delete).
- Inline review comments that feed back into subsequent agent instructions.
- Commit/push/PR workflow and attach-existing-PR workflow.
- Pre-action safety checks (clean/dirty status, branch info, conflict visibility).

## 3) Target architecture mapping

### 3.1 Convex responsibilities
Convex is authoritative for:
- Workspace/session/repo metadata.
- Execution state machine and transitions.
- Durable queue + approvals + agent turns.
- Realtime updates for UI and worker coordination.
- Authorization policy checks before command dispatch.

Convex must not execute local shell/git directly.

### 3.2 Website responsibilities
Website owns:
- Workspace UX surface (sidebar, details, sessions, chat, changes, command bar).
- Real-time subscription wiring to Convex documents/events.
- User input validation before mutation calls.
- Explicit confirmations for high-risk operations.

### 3.3 Go worker responsibilities
Go worker owns:
- Local worktree lifecycle operations.
- Local command execution for allowed command types.
- Git mutable operations and repo-state snapshots.
- PTY and streaming adapters.
- Durable delivery acknowledgements/idempotent progress reporting to Convex.

## 4) Security and trust model (mandatory)

### 4.1 Threat
An unauthorized caller attempts to trigger local machine execution by calling Convex APIs.

### 4.2 Required controls
- Execution jobs require authenticated Clerk principal and org context.
- Job must include `target_device_id` and be authorized for that user/org/device tuple.
- Go worker executes only jobs matching its enrolled `device_id`.
- Job envelope requires nonce/idempotency key and TTL to block replay.
- Command type allowlist only; reject raw arbitrary shell payloads from public APIs.
- Local user approvals for high-risk command classes.
- Immediate revocation path disables device from receiving new work.
- Full audit trail for who requested what, when, and from which device.

## 5) Convex data model requirements (workspace-focused)

Required collections/tables (names illustrative):
- `workspaces`
- `workspaceRepos`
- `sessions`
- `sessionMessages`
- `executionProcesses`
- `executionProcessRepoStates`
- `codingAgentTurns`
- `approvals`
- `queuedMessages`
- `workspaceEvents`
- `deviceEnrollments`
- `runnerLeases`

Required workspace fields:
- workspace identity, org/user ownership, project linkage
- lifecycle flags (`archived`, `pinned`, etc.)
- display metadata (name/title, created/updated timestamps)
- branch/worktree metadata needed by worker
- active session and active repo pointers (or derivable)

Required indexes:
- workspaces by org/user + archived + pinned + recency
- sessions by workspace + recency
- execution processes by session + status + run reason + created_at
- approvals by workspace/session/process + pending status
- queued messages by session + created_at
- workspace repos by workspace + repo ordering/enabled state

## 6) Eventing and contract requirements

### 6.1 Realtime contracts
Must provide deterministic subscriptions for:
- workspace list/detail updates
- session list/message updates
- execution lifecycle and logs
- approval lifecycle
- queue lifecycle
- per-repo change summaries

### 6.2 Ordering and idempotency
- Events must be idempotent at consumer side.
- Terminal execution state must be unique and monotonic.
- Duplicate worker acknowledgements must not duplicate side effects.

## 7) Migration implementation checklist by surface

### 7.1 Convex checklist
- [ ] Implement workspace/session/repo schema with validators.
- [ ] Implement workspace create mutation with atomic orchestration state.
- [ ] Implement archive/delete mutations with explicit policy semantics.
- [ ] Implement session create/switch/list and message queue durability.
- [ ] Implement approvals store with timeout/expiry handling.
- [ ] Implement execution dispatch API with device-target authorization.
- [ ] Implement command-bar/slash-command mutation endpoints (or mapped API).
- [ ] Implement per-repo enable/disable and active-repo selection state.
- [ ] Implement audit event writes for privileged operations.

### 7.2 Website checklist
- [ ] Render workspace sidebar with status/pin/archive semantics.
- [ ] Implement workspace creation wizard (project/repos/branch/provider/mode).
- [ ] Implement repository panel with enabled state + status summaries.
- [ ] Implement session panel with create/switch/history semantics.
- [ ] Implement chat panel with queue/approval/retry behavior.
- [ ] Implement command bar action parity.
- [ ] Implement slash command UX and parser integration with Convex mutations.
- [ ] Implement changes panel parity (per-repo views, diff metadata, review comments).
- [ ] Implement git operation UI flows (commit/push/PR/attach).

### 7.3 Go worker checklist
- [ ] Implement managed workspace root policy and safe path checks.
- [ ] Implement idempotent workspace worktree creation per repo.
- [ ] Implement repo-state snapshots (`before_head_commit`, `after_head_commit`).
- [ ] Implement command execution by typed operation, not raw free-form shell command.
- [ ] Implement streaming logs and terminal state reporting to Convex.
- [ ] Implement approval wait/resume hooks for blocked operations.
- [ ] Implement recovery flow after worker restart (re-lease/reconcile in-flight tasks).
- [ ] Implement cleanup jobs for orphaned/expired managed worktrees.

## 8) Must-pass parity tests (workspace-focused)
- [ ] Create workspace (single repo) -> run agent -> review changes -> commit -> PR.
- [ ] Create workspace (multi repo) -> repo-scoped command routing works.
- [ ] Session switch preserves distinct history and execution state.
- [ ] Message sent while running is queued and later consumed with correct semantics.
- [ ] Approval required path blocks execution until explicit user response.
- [ ] Archive/unarchive preserves expected history and visibility.
- [ ] Delete cleans only managed workspace paths.
- [ ] Command bar + slash command parity on key workflows.
- [ ] Worker restart does not duplicate or lose execution lifecycle transitions.
- [ ] Unauthorized user/device cannot enqueue or execute jobs.

## 9) Dependencies and linked documents
- Current-state backend findings: `migration-finding.md`
- Program-level implementation tasks: `migration-task.md`
- Auth migration to Clerk: `migration-auth.md`
- MCP integration migration: `migration-mcp.md`

External product docs reviewed for this spec:
- [Workspaces Overview](https://www.vibekanban.com/docs/workspaces)
- [Creating Workspaces](https://www.vibekanban.com/docs/workspaces/creating-workspaces)
- [Managing Workspaces](https://www.vibekanban.com/docs/workspaces/managing-workspaces)
- [Repositories](https://www.vibekanban.com/docs/workspaces/repositories)
- [Sessions](https://www.vibekanban.com/docs/workspaces/sessions)
- [Chat Interface](https://www.vibekanban.com/docs/workspaces/chat-interface)
- [Slash Commands](https://www.vibekanban.com/docs/workspaces/slash-commands)
- [Workspace Interface](https://www.vibekanban.com/docs/workspaces/interface)
- [Command Bar](https://www.vibekanban.com/docs/workspaces/command-bar)
- [Multi-Repo Sessions](https://www.vibekanban.com/docs/workspaces/multi-repo-sessions)
- [Changes](https://www.vibekanban.com/docs/workspaces/changes)
- [Git Operations](https://www.vibekanban.com/docs/workspaces/git-operations)
