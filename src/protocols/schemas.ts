import { z } from "zod";

export const ideaInputSchema = z.object({
  project: z.string().min(2),
  idea: z.string().min(10),
  constraints: z.array(z.string()).default([]),
  targetUsers: z.array(z.string()).default([]),
});

export const taskSpecSchema = z.object({
  id: z.string().min(2),
  title: z.string().min(3),
  description: z.string().min(5),
  mode: z.enum(["AFK", "HITL"]),
  dependencies: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).min(1),
  nfrTags: z.array(z.string()).default([]),
  backendHint: z.string().optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  workspaceStrategy: z.enum(["git-worktree", "copy", "shared"]).optional(),
  commands: z.array(
    z.object({
      type: z.enum(["shell", "agent"]),
      command: z.string().optional(),
      prompt: z.string().optional(),
    }),
  ).optional(),
  acceptanceChecks: z.array(
    z.object({
      type: z.enum(["shell", "file-exists"]),
      command: z.string().optional(),
      path: z.string().optional(),
    }),
  ).optional(),
});
