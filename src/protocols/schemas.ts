import { z } from "zod";

export const ideaInputSchema = z.object({
  project: z.string().min(2),
  idea: z.string().min(10),
  constraints: z.array(z.string()).default([]),
  targetUsers: z.array(z.string()).default([]),
});

const taskCommandSchema = z
  .object({
    type: z.enum(["shell", "agent"]),
    command: z.string().optional(),
    prompt: z.string().optional(),
  })
  .superRefine((command, ctx) => {
    if (command.type === "shell" && !command.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shell command entries must include a non-empty command",
      });
    }
    if (command.type === "agent" && !command.prompt?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agent command entries must include a non-empty prompt",
      });
    }
  });

const acceptanceCheckSchema = z
  .object({
    type: z.enum(["shell", "file-exists"]),
    command: z.string().optional(),
    path: z.string().optional(),
  })
  .superRefine((check, ctx) => {
    if (check.type === "shell" && !check.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shell acceptance checks must include a non-empty command",
      });
    }
    if (check.type === "file-exists" && !check.path?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "file-exists acceptance checks must include a non-empty path",
      });
    }
  });

export const taskSpecSchema = z
  .object({
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
  commands: z.array(taskCommandSchema).optional(),
  acceptanceChecks: z.array(acceptanceCheckSchema).optional(),
})
  .superRefine((task, ctx) => {
    if (task.mode !== "AFK") {
      return;
    }
    if (!task.maxAttempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AFK tasks must define maxAttempts",
      });
    }
    if (!task.commands || task.commands.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AFK tasks must define at least one command",
      });
    }
    if (!task.acceptanceChecks || task.acceptanceChecks.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AFK tasks must define at least one acceptance check",
      });
    }
  });
