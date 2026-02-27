import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const sessionStatus = v.union(
  v.literal('running'),
  v.literal('idle'),
  v.literal('needs_attention'),
  v.literal('error'),
);

export const createSession = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    title: v.optional(v.string()),
  },
  returns: v.object({
    sessionId: v.id('sessions'),
    workspaceId: v.id('workspaces'),
    lastUsedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const now = Date.now();
    const sessionId = await ctx.db.insert('sessions', {
      workspaceId: args.workspaceId,
      title: args.title,
      status: 'idle',
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.workspaceId, {
      activeSessionId: sessionId,
      updatedAt: now,
    });

    return {
      sessionId,
      workspaceId: args.workspaceId,
      lastUsedAt: now,
    };
  },
});

export const listSessionsByWorkspace = query({
  args: {
    workspaceId: v.id('workspaces'),
  },
  returns: v.array(
    v.object({
      sessionId: v.id('sessions'),
      workspaceId: v.id('workspaces'),
      title: v.optional(v.string()),
      status: sessionStatus,
      lastUsedAt: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const sessions = await (ctx.db as any)
      .query('sessions')
      .withIndex('by_workspace_id_and_last_used_at', (q: any) =>
        q.eq('workspaceId', args.workspaceId),
      )
      .order('desc')
      .collect();

    return sessions.map((session: any) => ({
      sessionId: session._id,
      workspaceId: session.workspaceId,
      title: session.title,
      status: session.status,
      lastUsedAt: session.lastUsedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  },
});

export const touchSession = mutation({
  args: {
    sessionId: v.id('sessions'),
  },
  returns: v.object({
    sessionId: v.id('sessions'),
    lastUsedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      lastUsedAt: now,
      updatedAt: now,
    });

    return {
      sessionId: args.sessionId,
      lastUsedAt: now,
    };
  },
});

export const setSessionStatus = mutation({
  args: {
    sessionId: v.id('sessions'),
    status: sessionStatus,
  },
  returns: v.object({
    sessionId: v.id('sessions'),
    status: sessionStatus,
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      updatedAt: now,
      lastUsedAt: now,
    });

    return {
      sessionId: args.sessionId,
      status: args.status,
      updatedAt: now,
    };
  },
});
