# Auth Migration Plan (Clerk)

## 1) Goal
Replace the current local OAuth handoff + remote token flow with Clerk-based authentication, while preserving local-runner workflows and backend security boundaries during the Rust -> Convex migration.

## 2) Current state summary (Rust)
Current auth flow (to be replaced):
- `/api/auth/handoff/init` and `/api/auth/handoff/complete` broker OAuth via remote service.
- Access token expiration/subject is parsed locally for metadata.
- Refresh token is stored on disk (`credentials.json`) with local file protections.
- Remote sync and remote API access depend on this token lifecycle.

Implication:
- Auth is tightly coupled to remote-client behavior and local persisted credentials.

## 3) Target state (Clerk + Convex)
Target model:
- Clerk is the identity provider.
- Convex validates Clerk identity and enforces authorization in queries/mutations/actions.
- Local runner uses short-lived, scoped tokens/session handoff from Convex-facing app layer.
- Remove dependency on custom handoff endpoints and refresh-token file persistence for app auth.

## 4) Non-negotiable security requirements
- No trust in unverified token claims for authorization decisions.
- Server-side authorization checks on every sensitive operation.
- Strict tenant/org boundary enforcement in all data access patterns.
- Token handling must be least-privilege and short-lived where possible.
- Full auditability for privileged actions (execution start/stop, approvals, repo operations).

## 5) Clerk migration workstreams

### A) Identity and session model
- Define Clerk user mapping to local domain entities (user, org/member, workspace access).
- Define active org/tenant resolution strategy.
- Define service-to-service or machine token needs for runner interactions.

### B) Backend auth middleware/policies
- Replace current OAuth auth routes with Clerk-compatible auth endpoints/flows.
- Add centralized auth guard utilities for Convex functions.
- Add role/permission checks for org/workspace/session operations.

### C) Token lifecycle and storage
- Remove local refresh-token persistence for app auth path.
- Move to Clerk session/JWT validation model.
- Define any local token cache policy (if required) with explicit TTL and revocation handling.

### D) API and client integration
- Update frontend auth bootstrap and session handling to Clerk.
- Update MCP/backend bridge calls to use Clerk-authenticated context.
- Ensure API compatibility where clients expect `/auth/status`-like semantics.

### E) Migration/cutover
- Support dual-auth period (legacy + Clerk) behind feature flags.
- Add user/org mapping migration for existing accounts.
- Add rollback guard for auth outage or permission regressions.

## 6) Detailed implementation checklist
- [ ] Add Clerk project/env configuration for dev/staging/prod.
- [ ] Implement Convex auth integration and identity extraction.
- [ ] Implement authz helpers (org membership, role checks, workspace visibility).
- [ ] Port/replace existing auth status/user endpoints with Clerk-backed equivalents.
- [ ] Update frontend login/session/logout flows to Clerk.
- [ ] Update local runner command authorization handshake to Clerk-aware model.
- [ ] Remove legacy OAuth handoff flow and credential file dependency.
- [ ] Add audit events for auth success/failure and privileged action checks.
- [ ] Add feature flag for phased rollout.
- [ ] Add rollback path to legacy auth while rollout is incomplete.

## 7) Testing requirements

### Functional
- [ ] Login/logout/session refresh behavior in web app.
- [ ] Org switching and scoped data visibility.
- [ ] Protected routes and API calls fail closed when unauthenticated.

### Security
- [ ] Expired/invalid token rejection.
- [ ] Cross-org access attempts blocked.
- [ ] Privileged operations denied without required role.

### Reliability
- [ ] Session continuity across app reloads.
- [ ] Graceful behavior during Clerk/network outages.
- [ ] Dual-auth migration mode correctness.

## 8) Acceptance criteria
- Clerk fully replaces legacy app auth flow.
- No local refresh-token file required for app authentication.
- All sensitive APIs enforce authn/authz correctly.
- Existing workspace/session/execution features remain functional.
- Migration and rollback procedures are documented and tested.

