import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const queueState = v.union(
  v.literal('queued'),
  v.literal('consumed'),
  v.literal('discarded'),
);

const queueStatusValidator = v.union(
  v.object({
    status: v.literal('empty'),
  }),
  v.object({
    status: v.literal('queued'),
    queuedMessageId: v.id('queuedMessages'),
    message: v.string(),
    executor: v.optional(v.string()),
    variant: v.optional(v.string()),
    queuedAt: v.number(),
    enqueueingProcessId: v.optional(v.id('executionProcesses')),
  }),
  v.object({
    status: v.literal('consumed'),
    queuedMessageId: v.id('queuedMessages'),
    message: v.string(),
    executor: v.optional(v.string()),
    variant: v.optional(v.string()),
    queuedAt: v.number(),
    enqueueingProcessId: v.optional(v.id('executionProcesses')),
  }),
);

export const enqueueFollowUp = mutation({
  args: {
    sessionId: v.id('sessions'),
    message: v.string(),
    executor: v.optional(v.string()),
    variant: v.optional(v.string()),
    enqueueingProcessId: v.optional(v.id('executionProcesses')),
  },
  returns: v.object({
    queuedMessageId: v.id('queuedMessages'),
    queuedAt: v.number(),
    state: queueState,
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const existingQueued = await (ctx.db as any)
      .query('queuedMessages')
      .withIndex('by_session_id_and_state_and_queued_at', (q: any) =>
        q.eq('sessionId', args.sessionId).eq('state', 'queued'),
      )
      .order('desc')
      .first();

    if (existingQueued) {
      await ctx.db.patch(existingQueued._id, {
        message: args.message,
        executor: args.executor,
        variant: args.variant,
        enqueueingProcessId: args.enqueueingProcessId,
        queuedAt: now,
        updatedAt: now,
      });

      return {
        queuedMessageId: existingQueued._id,
        queuedAt: now,
        state: 'queued' as const,
      };
    }

    const queuedMessageId = await ctx.db.insert('queuedMessages', {
      sessionId: args.sessionId,
      message: args.message,
      executor: args.executor,
      variant: args.variant,
      enqueueingProcessId: args.enqueueingProcessId,
      state: 'queued',
      queuedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return {
      queuedMessageId,
      queuedAt: now,
      state: 'queued' as const,
    };
  },
});

export const getQueueStatus = query({
  args: {
    sessionId: v.id('sessions'),
  },
  returns: queueStatusValidator,
  handler: async (ctx, args) => {
    const queued = await (ctx.db as any)
      .query('queuedMessages')
      .withIndex('by_session_id_and_state_and_queued_at', (q: any) =>
        q.eq('sessionId', args.sessionId).eq('state', 'queued'),
      )
      .order('desc')
      .first();

    if (!queued) {
      return {
        status: 'empty' as const,
      };
    }

    return {
      status: 'queued' as const,
      queuedMessageId: queued._id,
      message: queued.message,
      executor: queued.executor,
      variant: queued.variant,
      queuedAt: queued.queuedAt,
      enqueueingProcessId: queued.enqueueingProcessId,
    };
  },
});

export const consumeQueuedMessage = mutation({
  args: {
    sessionId: v.id('sessions'),
  },
  returns: queueStatusValidator,
  handler: async (ctx, args) => {
    const queued = await (ctx.db as any)
      .query('queuedMessages')
      .withIndex('by_session_id_and_state_and_queued_at', (q: any) =>
        q.eq('sessionId', args.sessionId).eq('state', 'queued'),
      )
      .order('desc')
      .first();

    if (!queued) {
      return {
        status: 'empty' as const,
      };
    }

    const now = Date.now();
    await ctx.db.patch(queued._id, {
      state: 'consumed',
      consumedAt: now,
      updatedAt: now,
    });

    return {
      status: 'consumed' as const,
      queuedMessageId: queued._id,
      message: queued.message,
      executor: queued.executor,
      variant: queued.variant,
      queuedAt: queued.queuedAt,
      enqueueingProcessId: queued.enqueueingProcessId,
    };
  },
});

export const discardQueuedMessage = mutation({
  args: {
    sessionId: v.id('sessions'),
  },
  returns: queueStatusValidator,
  handler: async (ctx, args) => {
    const queued = await (ctx.db as any)
      .query('queuedMessages')
      .withIndex('by_session_id_and_state_and_queued_at', (q: any) =>
        q.eq('sessionId', args.sessionId).eq('state', 'queued'),
      )
      .order('desc')
      .first();

    if (!queued) {
      return {
        status: 'empty' as const,
      };
    }

    const now = Date.now();
    await ctx.db.patch(queued._id, {
      state: 'discarded',
      discardedAt: now,
      updatedAt: now,
    });

    return {
      status: 'empty' as const,
    };
  },
});
