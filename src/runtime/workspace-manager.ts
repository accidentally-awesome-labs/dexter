import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { spawn } from "node:child_process";
import type { WorkspaceStrategy } from "../protocols/types.js";

interface WorkspaceInfo {
  strategy: Exclude<WorkspaceStrategy, "shared">;
  path: string;
  cleanup: boolean;
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function hasGit(rootDir: string): Promise<boolean> {
  if (!(await fs.pathExists(path.join(rootDir, ".git")))) {
    return false;
  }
  return (await run("sh", ["-lc", "command -v git"])) === 0;
}

async function createCopyWorkspace(rootDir: string, workspacePath: string): Promise<void> {
  await fs.copy(rootDir, workspacePath, {
    filter: (item) => {
      const rel = path.relative(rootDir, item);
      if (!rel) {
        return true;
      }
      return ![
        ".git",
        "node_modules",
        "dist",
        "runs",
        "state",
      ].some((blocked) => rel === blocked || rel.startsWith(`${blocked}${path.sep}`));
    },
  });
}

export async function prepareTaskWorkspace(
  rootDir: string,
  runDir: string,
  taskId: string,
  preferred: WorkspaceStrategy = "git-worktree",
): Promise<WorkspaceInfo> {
  const base = path.join(runDir, "workspaces");
  await fs.ensureDir(base);
  const workspacePath = path.join(base, taskId);

  if (preferred === "shared") {
    return {
      strategy: "copy",
      path: rootDir,
      cleanup: false,
    };
  }

  const canWorktree = preferred === "git-worktree" && (await hasGit(rootDir));
  if (canWorktree) {
    const addCode = await run("git", ["-C", rootDir, "worktree", "add", "--detach", workspacePath]);
    if (addCode === 0) {
      return {
        strategy: "git-worktree",
        path: workspacePath,
        cleanup: true,
      };
    }
  }

  const copyWorkspacePath = workspacePath.startsWith(rootDir)
    ? await fs.mkdtemp(path.join(os.tmpdir(), `dexter-workspace-${taskId}-`))
    : workspacePath;
  await fs.ensureDir(copyWorkspacePath);
  await createCopyWorkspace(rootDir, copyWorkspacePath);
  return {
    strategy: "copy",
    path: copyWorkspacePath,
    cleanup: true,
  };
}

export async function cleanupTaskWorkspace(rootDir: string, workspace: WorkspaceInfo): Promise<void> {
  if (!workspace.cleanup || workspace.path === rootDir) {
    return;
  }
  if (workspace.strategy === "git-worktree") {
    const removeCode = await run("git", ["-C", rootDir, "worktree", "remove", "--force", workspace.path]);
    if (removeCode !== 0) {
      await run("git", ["-C", rootDir, "worktree", "prune"]);
      const retryCode = await run("git", ["-C", rootDir, "worktree", "remove", "--force", workspace.path]);
      if (retryCode !== 0) {
        throw new Error(`Failed to clean git worktree at ${workspace.path}`);
      }
    }
  }
  await fs.remove(workspace.path);
}
