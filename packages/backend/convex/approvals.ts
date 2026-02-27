import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const approvalStatus = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('expired'),
  v.literal('cancelled'),
);

export const requestApproval = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    sessionId: v.id('sessions'),
    executionProcessId: v.id('executionProcesses'),
    kind: v.string(),
    prompt: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({
    approvalId: v.id('approvals'),
    status: approvalStatus,
    requestedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const approvalId = await ctx.db.insert('approvals', {
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      executionProcessId: args.executionProcessId,
      kind: args.kind,
      prompt: args.prompt,
      status: 'pending',
      requestedAt: now,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.sessionId, {
      status: 'needs_attention',
      updatedAt: now,
      lastUsedAt: now,
    });
    await ctx.db.patch(args.workspaceId, {
      status: 'needs_attention',
      updatedAt: now,
    });

    return {
      approvalId,
      status: 'pending' as const,
      requestedAt: now,
    };
  },
});

export const respondApproval = mutation({
  args: {
    approvalId: v.id('approvals'),
    status: v.union(v.literal('approved'), v.literal('rejected')),
    respondedBy: v.string(),
  },
  returns: v.object({
    approvalId: v.id('approvals'),
    status: approvalStatus,
    respondedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error(`Approval ${args.approvalId} not found`);
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval ${args.approvalId} is not pending`);
    }

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: args.status,
      respondedBy: args.respondedBy,
      respondedAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(approval.sessionId, {
      status: 'idle',
      lastUsedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(approval.workspaceId, {
      status: 'idle',
      updatedAt: now,
    });

    return {
      approvalId: args.approvalId,
      status: args.status,
      respondedAt: now,
    };
  },
});

export const listPendingApprovalsBySession = query({
  args: {
    sessionId: v.id('sessions'),
  },
  returns: v.array(
    v.object({
      approvalId: v.id('approvals'),
      workspaceId: v.id('workspaces'),
      sessionId: v.id('sessions'),
      executionProcessId: v.id('executionProcesses'),
      kind: v.string(),
      prompt: v.string(),
      status: approvalStatus,
      requestedAt: v.number(),
      expiresAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const approvals = await (ctx.db as any)
      .query('approvals')
      .withIndex('by_session_id_and_status_and_requested_at', (q: any) =>
        q.eq('sessionId', args.sessionId).eq('status', 'pending'),
      )
      .order('desc')
      .collect();

    return approvals.map((approval: any) => ({
      approvalId: approval._id,
      workspaceId: approval.workspaceId,
      sessionId: approval.sessionId,
      executionProcessId: approval.executionProcessId,
      kind: approval.kind,
      prompt: approval.prompt,
      status: approval.status,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
    }));
  },
});
