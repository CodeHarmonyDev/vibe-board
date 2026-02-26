# Convex Migration Task Plan (Rust Backend Replacement)

## 1) Objective
Migrate backend control/data plane from Rust services to Convex while preserving:
- Functional parity (workspace/session/execution lifecycle)
- API compatibility (frontend + MCP integrations)
- Local execution capabilities (git/worktree/shell/PTY)
- Security invariants and failure safety
- Auth migration to Clerk without regressions in access control

This plan assumes a hybrid architecture:
- Convex = authoritative state and API/query/mutation/subscription plane
- Local runner = privileged local execution plane

Related auth-focused plan:
- `migration-auth.md` (Clerk migration track)

## 2) Program structure

### Phase 0: Baseline and freeze
- [ ] Capture current API behavior snapshots for critical endpoints.
- [ ] Capture representative end-to-end workflow traces (create workspace, run setup, coding, cleanup, PR, reset, archive).
- [ ] Freeze contract changes during migration window.

Acceptance criteria:
- Baseline fixtures exist for request/response and stream event ordering.
- Known-good regression scenarios are documented and replayable.

### Phase 1: Convex foundation
- [ ] Create Convex project scaffolding with environment separation.
- [ ] Define auth strategy (token verification, identity mapping, org/user boundaries).
- [ ] Add strict schema validators for all public functions.
- [ ] Establish internal/public function boundaries (`internal*` vs public APIs).

Acceptance criteria:
- Convex functions compile with explicit args/returns validators.
- Auth checks are centralized and covered by tests.

### Phase 1A: Clerk auth migration
- [ ] Implement Clerk integration plan from `migration-auth.md`.
- [ ] Add dual-auth feature flag and phased rollout gates.
- [ ] Validate org/role authorization parity against current behavior.

Acceptance criteria:
- Clerk-authenticated flows are stable in staging.
- Authz regressions are blocked by automated tests.

### Phase 2: Data model port
- [ ] Model core tables in Convex:
- workspaces, workspaceRepos, sessions, executionProcesses, executionProcessRepoStates, codingAgentTurns, repos, merges, scratch, images, workspaceImages, approvals, queuedMessages.
- [ ] Add required indexes for query patterns from Rust routes.
- [ ] Backfill/migration scripts from SQLite to Convex documents.
- [ ] Add idempotent import and verification tooling.

Acceptance criteria:
- Full data import with deterministic counts/checksums.
- Query latency acceptable for key list/detail endpoints.

### Phase 3: Local runner protocol
- [ ] Define typed protocol between Convex and local runner:
- execution start/stop
- log streaming
- diff/stat updates
- repo state snapshots (`before_head_commit`, `after_head_commit`)
- approvals/questions
- [ ] Implement heartbeat and lease ownership for running executions.
- [ ] Implement retry semantics and dedup keys for command dispatch.

Acceptance criteria:
- Runner reconnect/restart does not duplicate execution side effects.
- In-flight executions recover to correct terminal state.

### Phase 4: Workspace/worktree lifecycle parity
- [ ] Port workspace create/ensure/delete orchestration state to Convex.
- [ ] Preserve multi-repo workspace semantics.
- [ ] Preserve cleanup safety rules (`.vibe-kanban-workspaces` subdir behavior for custom workspace dirs).
- [ ] Preserve orphan/expired workspace cleanup policies.

Acceptance criteria:
- Worktree creation and cleanup remain race-safe.
- No destructive cleanup beyond managed directories.

### Phase 5: Execution lifecycle parity
- [ ] Port execution state machine and transitions.
- [ ] Preserve setup-chain behavior (parallel vs sequential).
- [ ] Preserve queued follow-up consumption semantics.
- [ ] Preserve session reset-to-process behavior.
- [ ] Preserve `dropped` semantics and UI visibility behavior.

Acceptance criteria:
- State transitions match baseline traces.
- Reset/retry flows produce identical repo state outcomes.

### Phase 6: API compatibility layer
- [ ] Implement compatibility API surface (or frontend refactor with strict mapping).
- [ ] Preserve endpoints used by MCP (`/containers/attempt-context`, workspace/session management, remote bridge operations).
- [ ] Preserve WS/subscription behavior equivalents.

Acceptance criteria:
- Frontend works end-to-end without breaking regressions.
- MCP tools continue functioning with equivalent semantics.

### Phase 7: Git/PR and remote sync parity
- [ ] Keep mutable git operations in local runner.
- [ ] Port PR metadata lifecycle to Convex documents.
- [ ] Port PR monitor logic (polling/status transitions/archive behavior).
- [ ] Port remote sync triggers and idempotency protections.

Acceptance criteria:
- PR create/attach/comment/status/archive flows match baseline.
- No duplicate remote writes under retries.

### Phase 8: Security hardening uplift
- [ ] Replace any unverified identity decisions with verified auth path.
- [ ] Revalidate origin/path traversal defenses at API edge.
- [ ] Harden preview proxy boundaries if retained.
- [ ] Add audit trail for approvals, privileged actions, and runner commands.

Acceptance criteria:
- Security checklist passes threat-model review.
- High-risk flows have tests for abuse cases.

### Phase 9: Observability and operations
- [ ] Instrument distributed traces: frontend -> Convex -> runner.
- [ ] Add structured event logs for execution lifecycle.
- [ ] Add dashboards/alerts for stuck executions, retry storms, auth failures.
- [ ] Add data integrity monitor jobs (state invariants).

Acceptance criteria:
- Incident triage can identify root cause within one trace chain.
- Operational SLOs defined and measured.

### Phase 10: Cutover and rollback
- [ ] Introduce dual-write / shadow-read period.
- [ ] Compare Rust-vs-Convex outputs on live traffic cohorts.
- [ ] Progressive rollout by feature flags.
- [ ] Define rollback guardrails and emergency switch.

Acceptance criteria:
- Rollout can pause or revert without data loss.
- No critical severity regressions at full traffic.

## 3) Detailed task checklist by domain

### A) Schema and indexing
- [ ] Encode entity constraints and enum domains.
- [ ] Add indexes for:
- workspace list/filter/sort
- session by workspace + last-used ordering
- execution process by session/status/run_reason
- merges by workspace/status
- scratch by composite identity
- [ ] Define archive and TTL policies where needed.

### B) Workflow invariants
- [ ] Exactly one terminal status per execution.
- [ ] `before_head_commit` captured before execution start.
- [ ] `after_head_commit` captured after finalization.
- [ ] Queue consumption only on successful completion path.
- [ ] Reset operation drops post-target execution history deterministically.

### C) Eventing and subscriptions
- [ ] Replace SQLite hook-driven patches with Convex subscriptions.
- [ ] Preserve frontend assumptions for ready/snapshot/update semantics.
- [ ] Ensure out-of-order update tolerance.

### D) Approvals and queue durability
- [ ] Persist pending approvals in Convex with timeout timestamps.
- [ ] Persist queued follow-ups in Convex.
- [ ] Recover pending approvals and queue items after restart.

### E) Runner protocol safety
- [ ] Signed/validated command envelopes.
- [ ] Idempotency keys for start/stop/append log actions.
- [ ] Lease renewal + orphan execution sweeper.

### F) OAuth and remote bridge
- [ ] Secure token verification boundaries.
- [ ] Preserve refresh behavior and lock semantics.
- [ ] Keep credential-at-rest protections on local side.

### G) Clerk migration
- [ ] Execute all checklist items in `migration-auth.md`.
- [ ] Remove legacy OAuth handoff endpoints from active path.
- [ ] Confirm frontend, MCP, and runner interactions are Clerk-compatible.

## 4) Testing matrix (must-pass)

### Functional
- [ ] Create workspace (single-repo + multi-repo).
- [ ] Setup scripts (parallel/sequential) and coding action chain.
- [ ] Follow-up and queued follow-up.
- [ ] Session reset to process.
- [ ] PR create/attach/comments/merged archive path.
- [ ] Scratch create/update/delete/stream.
- [ ] Image upload/serve/delete and workspace image association.
- [ ] Terminal WS create/input/resize/close.

### Concurrency and race conditions
- [ ] Concurrent `ensure_workspace_exists` for same workspace.
- [ ] Concurrent execution start/stop/retry requests.
- [ ] PR monitor updates while user actions run.

### Failure injection
- [ ] Runner crash mid-execution.
- [ ] Network partition between runner and Convex.
- [ ] Convex transient failures/retries.
- [ ] Auth token expiry during remote sync.

### Security
- [ ] Origin validation abuse attempts.
- [ ] Path traversal attempts for image serving.
- [ ] Unauthorized approval responses.
- [ ] Token forgery/malformed token scenarios.

### Data integrity
- [ ] Imported entity count match (SQLite vs Convex).
- [ ] Referential integrity checks.
- [ ] Execution repo-state consistency checks.

## 5) Cutover strategy recommendation
1. Stand up Convex in shadow mode.
2. Mirror writes from Rust to Convex (or controlled replay).
3. Validate parity dashboards and sampled response diffs.
4. Switch read paths incrementally (internal users -> beta -> full).
5. Keep rollback to Rust available until stability window passes.

## 6) Rollback requirements
- Rollback trigger thresholds:
- data inconsistency
- execution state corruption
- critical workflow failure (workspace/session/execution)
- security regression
- Required rollback assets:
- immutable migration snapshots
- replayable command/event logs
- feature flags for immediate traffic reroute

## 7) Completion gates
Migration is complete only if all are true:
- [ ] Functional parity test suite green.
- [ ] Security review sign-off complete.
- [ ] Observability and on-call runbooks updated.
- [ ] MCP and frontend compatibility confirmed.
- [ ] Rollback drill executed successfully.
