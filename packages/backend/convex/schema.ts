import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const workspaceStatus = v.union(
  v.literal('running'),
  v.literal('idle'),
  v.literal('needs_attention'),
  v.literal('error'),
);

const sessionStatus = v.union(
  v.literal('running'),
  v.literal('idle'),
  v.literal('needs_attention'),
  v.literal('error'),
);

const executionStatus = v.union(
  v.literal('pending'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('killed'),
  v.literal('dropped'),
);

const executionRunReason = v.union(
  v.literal('setup'),
  v.literal('coding_agent'),
  v.literal('cleanup'),
  v.literal('archive'),
  v.literal('dev_server'),
  v.literal('review'),
  v.literal('system'),
);

const queueState = v.union(
  v.literal('queued'),
  v.literal('consumed'),
  v.literal('discarded'),
);

const approvalStatus = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('expired'),
  v.literal('cancelled'),
);

export default defineSchema({
  workspaces: defineTable({
    ownerUserId: v.string(),
    organizationId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    name: v.string(),
    branch: v.string(),
    status: workspaceStatus,
    archived: v.boolean(),
    pinned: v.boolean(),
    activeSessionId: v.optional(v.id('sessions')),
    activeWorkspaceRepoId: v.optional(v.id('workspaceRepos')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner_user_id_and_archived_and_pinned', [
      'ownerUserId',
      'archived',
      'pinned',
    ])
    .index('by_owner_user_id_and_archived_and_updated_at', [
      'ownerUserId',
      'archived',
      'updatedAt',
    ])
    .index('by_project_id_and_archived', ['projectId', 'archived'])
    .index('by_status_and_updated_at', ['status', 'updatedAt']),

  workspaceRepos: defineTable({
    workspaceId: v.id('workspaces'),
    repoId: v.string(),
    repoName: v.string(),
    targetBranch: v.string(),
    enabled: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace_id_and_sort_order', ['workspaceId', 'sortOrder'])
    .index('by_workspace_id_and_enabled_and_sort_order', [
      'workspaceId',
      'enabled',
      'sortOrder',
    ]),

  sessions: defineTable({
    workspaceId: v.id('workspaces'),
    title: v.optional(v.string()),
    status: sessionStatus,
    lastUsedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace_id_and_last_used_at', ['workspaceId', 'lastUsedAt'])
    .index('by_workspace_id_and_status_and_last_used_at', [
      'workspaceId',
      'status',
      'lastUsedAt',
    ]),

  executionProcesses: defineTable({
    workspaceId: v.id('workspaces'),
    sessionId: v.id('sessions'),
    runReason: executionRunReason,
    status: executionStatus,
    executor: v.optional(v.string()),
    queuedFollowUpConsumed: v.boolean(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace_id_and_started_at', ['workspaceId', 'startedAt'])
    .index('by_session_id_and_started_at', ['sessionId', 'startedAt'])
    .index('by_session_id_and_status_and_started_at', [
      'sessionId',
      'status',
      'startedAt',
    ])
    .index('by_status_and_started_at', ['status', 'startedAt']),

  executionProcessRepoStates: defineTable({
    executionProcessId: v.id('executionProcesses'),
    workspaceRepoId: v.id('workspaceRepos'),
    beforeHeadCommit: v.optional(v.string()),
    afterHeadCommit: v.optional(v.string()),
    repoState: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_execution_process_id_and_workspace_repo_id', [
    'executionProcessId',
    'workspaceRepoId',
  ]),

  queuedMessages: defineTable({
    sessionId: v.id('sessions'),
    message: v.string(),
    executor: v.optional(v.string()),
    variant: v.optional(v.string()),
    state: queueState,
    enqueueingProcessId: v.optional(v.id('executionProcesses')),
    queuedAt: v.number(),
    consumedAt: v.optional(v.number()),
    discardedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_session_id_and_state_and_queued_at', [
    'sessionId',
    'state',
    'queuedAt',
  ]),

  approvals: defineTable({
    workspaceId: v.id('workspaces'),
    sessionId: v.id('sessions'),
    executionProcessId: v.id('executionProcesses'),
    kind: v.string(),
    prompt: v.string(),
    status: approvalStatus,
    requestedAt: v.number(),
    respondedAt: v.optional(v.number()),
    respondedBy: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_execution_process_id_and_status_and_requested_at', [
      'executionProcessId',
      'status',
      'requestedAt',
    ])
    .index('by_session_id_and_status_and_requested_at', [
      'sessionId',
      'status',
      'requestedAt',
    ]),
});
