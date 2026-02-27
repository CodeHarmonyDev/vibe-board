import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

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

const sessionStatus = v.union(
  v.literal('running'),
  v.literal('idle'),
  v.literal('needs_attention'),
  v.literal('error'),
);

function mapExecutionToSessionStatus(
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'dropped',
): 'running' | 'idle' | 'needs_attention' | 'error' {
  if (status === 'pending' || status === 'running') {
    return 'running';
  }
  if (status === 'failed' || status === 'killed') {
    return 'needs_attention';
  }
  return 'idle';
}

export const startExecution = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    sessionId: v.id('sessions'),
    runReason: executionRunReason,
    executor: v.optional(v.string()),
  },
  returns: v.object({
    executionProcessId: v.id('executionProcesses'),
    startedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    const now = Date.now();
    const executionProcessId = await ctx.db.insert('executionProcesses', {
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      runReason: args.runReason,
      status: 'running',
      executor: args.executor,
      queuedFollowUpConsumed: false,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.sessionId, {
      status: 'running',
      lastUsedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.workspaceId, {
      status: 'running',
      activeSessionId: args.sessionId,
      updatedAt: now,
    });

    return {
      executionProcessId,
      startedAt: now,
    };
  },
});

export const setExecutionStatus = mutation({
  args: {
    executionProcessId: v.id('executionProcesses'),
    status: executionStatus,
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({
    executionProcessId: v.id('executionProcesses'),
    status: executionStatus,
    sessionStatus: sessionStatus,
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const process = await ctx.db.get(args.executionProcessId);
    if (!process) {
      throw new Error(`Execution process ${args.executionProcessId} not found`);
    }

    const now = Date.now();
    const terminal =
      args.status === 'completed' ||
      args.status === 'failed' ||
      args.status === 'killed' ||
      args.status === 'dropped';
    const mappedSessionStatus = mapExecutionToSessionStatus(args.status);

    await ctx.db.patch(args.executionProcessId, {
      status: args.status,
      errorMessage: args.errorMessage,
      completedAt: terminal ? now : process.completedAt,
      updatedAt: now,
    });
    await ctx.db.patch(process.sessionId, {
      status: mappedSessionStatus,
      lastUsedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(process.workspaceId, {
      status: mappedSessionStatus,
      updatedAt: now,
    });

    return {
      executionProcessId: args.executionProcessId,
      status: args.status,
      sessionStatus: mappedSessionStatus,
      updatedAt: now,
    };
  },
});

export const markQueuedFollowUpConsumed = mutation({
  args: {
    executionProcessId: v.id('executionProcesses'),
  },
  returns: v.object({
    executionProcessId: v.id('executionProcesses'),
    queuedFollowUpConsumed: v.boolean(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const process = await ctx.db.get(args.executionProcessId);
    if (!process) {
      throw new Error(`Execution process ${args.executionProcessId} not found`);
    }

    const now = Date.now();
    await ctx.db.patch(args.executionProcessId, {
      queuedFollowUpConsumed: true,
      updatedAt: now,
    });

    return {
      executionProcessId: args.executionProcessId,
      queuedFollowUpConsumed: true,
      updatedAt: now,
    };
  },
});

export const listExecutionProcessesBySession = query({
  args: {
    sessionId: v.id('sessions'),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      executionProcessId: v.id('executionProcesses'),
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
    }),
  ),
  handler: async (ctx, args) => {
    const queryBuilder = (ctx.db as any)
      .query('executionProcesses')
      .withIndex('by_session_id_and_started_at', (q: any) =>
        q.eq('sessionId', args.sessionId),
      )
      .order('desc');

    const rows =
      args.limit === undefined
        ? await queryBuilder.collect()
        : await queryBuilder.take(args.limit);

    return rows.map((row: any) => ({
      executionProcessId: row._id,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId,
      runReason: row.runReason,
      status: row.status,
      executor: row.executor,
      queuedFollowUpConsumed: row.queuedFollowUpConsumed,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const upsertExecutionRepoState = mutation({
  args: {
    executionProcessId: v.id('executionProcesses'),
    workspaceRepoId: v.id('workspaceRepos'),
    beforeHeadCommit: v.optional(v.string()),
    afterHeadCommit: v.optional(v.string()),
    repoState: v.optional(v.string()),
  },
  returns: v.object({
    executionProcessRepoStateId: v.id('executionProcessRepoStates'),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await (ctx.db as any)
      .query('executionProcessRepoStates')
      .withIndex('by_execution_process_id_and_workspace_repo_id', (q: any) =>
        q
          .eq('executionProcessId', args.executionProcessId)
          .eq('workspaceRepoId', args.workspaceRepoId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        beforeHeadCommit: args.beforeHeadCommit ?? existing.beforeHeadCommit,
        afterHeadCommit: args.afterHeadCommit ?? existing.afterHeadCommit,
        repoState: args.repoState ?? existing.repoState,
        updatedAt: now,
      });
      return {
        executionProcessRepoStateId: existing._id,
        updatedAt: now,
      };
    }

    const executionProcessRepoStateId = await ctx.db.insert(
      'executionProcessRepoStates',
      {
        executionProcessId: args.executionProcessId,
        workspaceRepoId: args.workspaceRepoId,
        beforeHeadCommit: args.beforeHeadCommit,
        afterHeadCommit: args.afterHeadCommit,
        repoState: args.repoState,
        createdAt: now,
        updatedAt: now,
      },
    );

    return {
      executionProcessRepoStateId,
      updatedAt: now,
    };
  },
});
