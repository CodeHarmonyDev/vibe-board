import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listWorkspaceRepos = query({
  args: {
    workspaceId: v.id('workspaces'),
    enabledOnly: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      workspaceRepoId: v.id('workspaceRepos'),
      workspaceId: v.id('workspaces'),
      repoId: v.string(),
      repoName: v.string(),
      targetBranch: v.string(),
      enabled: v.boolean(),
      sortOrder: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows =
      args.enabledOnly === true
        ? await (ctx.db as any)
            .query('workspaceRepos')
            .withIndex(
              'by_workspace_id_and_enabled_and_sort_order',
              (q: any) =>
                q.eq('workspaceId', args.workspaceId).eq('enabled', true),
            )
            .order('asc')
            .collect()
        : await (ctx.db as any)
            .query('workspaceRepos')
            .withIndex('by_workspace_id_and_sort_order', (q: any) =>
              q.eq('workspaceId', args.workspaceId),
            )
            .order('asc')
            .collect();

    return rows.map((repo: any) => ({
        workspaceRepoId: repo._id,
        workspaceId: repo.workspaceId,
        repoId: repo.repoId,
        repoName: repo.repoName,
        targetBranch: repo.targetBranch,
        enabled: repo.enabled,
        sortOrder: repo.sortOrder,
        createdAt: repo.createdAt,
        updatedAt: repo.updatedAt,
      }));
  },
});

export const updateWorkspaceRepo = mutation({
  args: {
    workspaceRepoId: v.id('workspaceRepos'),
    enabled: v.optional(v.boolean()),
    targetBranch: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.object({
    workspaceRepoId: v.id('workspaceRepos'),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const workspaceRepo = await ctx.db.get(args.workspaceRepoId);
    if (!workspaceRepo) {
      throw new Error(`Workspace repo ${args.workspaceRepoId} not found`);
    }

    const now = Date.now();
    await ctx.db.patch(args.workspaceRepoId, {
      enabled: args.enabled ?? workspaceRepo.enabled,
      targetBranch: args.targetBranch ?? workspaceRepo.targetBranch,
      sortOrder: args.sortOrder ?? workspaceRepo.sortOrder,
      updatedAt: now,
    });

    return {
      workspaceRepoId: args.workspaceRepoId,
      updatedAt: now,
    };
  },
});

export const setActiveWorkspaceRepo = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    workspaceRepoId: v.id('workspaceRepos'),
  },
  returns: v.object({
    workspaceId: v.id('workspaces'),
    workspaceRepoId: v.id('workspaceRepos'),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const workspaceRepo = await ctx.db.get(args.workspaceRepoId);
    if (!workspaceRepo || workspaceRepo.workspaceId !== args.workspaceId) {
      throw new Error(
        `Workspace repo ${args.workspaceRepoId} does not belong to workspace ${args.workspaceId}`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(args.workspaceId, {
      activeWorkspaceRepoId: args.workspaceRepoId,
      updatedAt: now,
    });

    return {
      workspaceId: args.workspaceId,
      workspaceRepoId: args.workspaceRepoId,
      updatedAt: now,
    };
  },
});
