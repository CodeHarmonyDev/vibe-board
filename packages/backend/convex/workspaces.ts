import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';

const workspaceStatus = v.union(
  v.literal('running'),
  v.literal('idle'),
  v.literal('needs_attention'),
  v.literal('error'),
);

const workspaceInputValidator = v.object({
  repoId: v.string(),
  repoName: v.string(),
  targetBranch: v.string(),
  enabled: v.optional(v.boolean()),
  sortOrder: v.optional(v.number()),
});

export const createWorkspace = mutation({
  args: {
    ownerUserId: v.string(),
    organizationId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    name: v.string(),
    branch: v.string(),
    repos: v.array(workspaceInputValidator),
    initialSessionTitle: v.optional(v.string()),
  },
  returns: v.object({
    workspaceId: v.id('workspaces'),
    sessionId: v.id('sessions'),
    workspaceRepoIds: v.array(v.id('workspaceRepos')),
  }),
  handler: async (ctx, args) => {
    if (args.repos.length === 0) {
      throw new Error('Workspace must include at least one repository');
    }

    const now = Date.now();

    const workspaceId = await ctx.db.insert('workspaces', {
      ownerUserId: args.ownerUserId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      name: args.name,
      branch: args.branch,
      status: 'idle',
      archived: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });

    const workspaceRepoIds: Array<Id<'workspaceRepos'>> = [];

    for (const [index, repo] of args.repos.entries()) {
      const workspaceRepoId = await ctx.db.insert('workspaceRepos', {
        workspaceId,
        repoId: repo.repoId,
        repoName: repo.repoName,
        targetBranch: repo.targetBranch,
        enabled: repo.enabled ?? true,
        sortOrder: repo.sortOrder ?? index,
        createdAt: now,
        updatedAt: now,
      });
      workspaceRepoIds.push(workspaceRepoId);
    }

    const sessionId = await ctx.db.insert('sessions', {
      workspaceId,
      title: args.initialSessionTitle,
      status: 'idle',
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(workspaceId, {
      activeSessionId: sessionId,
      activeWorkspaceRepoId: workspaceRepoIds[0],
      updatedAt: now,
    });

    return {
      workspaceId,
      sessionId,
      workspaceRepoIds,
    };
  },
});

export const getWorkspace = query({
  args: {
    workspaceId: v.id('workspaces'),
  },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id('workspaces'),
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
    }),
  ),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return null;
    }

    return {
      workspaceId: workspace._id,
      ownerUserId: workspace.ownerUserId,
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
      name: workspace.name,
      branch: workspace.branch,
      status: workspace.status,
      archived: workspace.archived,
      pinned: workspace.pinned,
      activeSessionId: workspace.activeSessionId,
      activeWorkspaceRepoId: workspace.activeWorkspaceRepoId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  },
});

export const listWorkspacesByOwner = query({
  args: {
    ownerUserId: v.string(),
    archived: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      workspaceId: v.id('workspaces'),
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
    }),
  ),
  handler: async (ctx, args) => {
    const archived = args.archived ?? false;
    const rows = await (ctx.db as any)
      .query('workspaces')
      .withIndex('by_owner_user_id_and_archived_and_updated_at', (q: any) =>
        q.eq('ownerUserId', args.ownerUserId).eq('archived', archived),
      )
      .order('desc')
      .collect();

    rows.sort((a: any, b: any) => {
      if (a.pinned === b.pinned) {
        return b.updatedAt - a.updatedAt;
      }
      return a.pinned ? -1 : 1;
    });

    return rows.map((workspace: any) => ({
      workspaceId: workspace._id,
      ownerUserId: workspace.ownerUserId,
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
      name: workspace.name,
      branch: workspace.branch,
      status: workspace.status,
      archived: workspace.archived,
      pinned: workspace.pinned,
      activeSessionId: workspace.activeSessionId,
      activeWorkspaceRepoId: workspace.activeWorkspaceRepoId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }));
  },
});

export const updateWorkspace = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    name: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    pinned: v.optional(v.boolean()),
    status: v.optional(workspaceStatus),
    activeSessionId: v.optional(v.id('sessions')),
    activeWorkspaceRepoId: v.optional(v.id('workspaceRepos')),
  },
  returns: v.object({
    workspaceId: v.id('workspaces'),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const now = Date.now();

    await ctx.db.patch(args.workspaceId, {
      name: args.name ?? workspace.name,
      archived: args.archived ?? workspace.archived,
      pinned: args.pinned ?? workspace.pinned,
      status: args.status ?? workspace.status,
      activeSessionId: args.activeSessionId ?? workspace.activeSessionId,
      activeWorkspaceRepoId:
        args.activeWorkspaceRepoId ?? workspace.activeWorkspaceRepoId,
      updatedAt: now,
    });

    return {
      workspaceId: args.workspaceId,
      updatedAt: now,
    };
  },
});
