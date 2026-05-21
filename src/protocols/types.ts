export type RiskLevel = "low" | "medium" | "high" | "critical";
export type TaskMode = "AFK" | "HITL";
export type WorkspaceStrategy = "git-worktree" | "copy" | "shared";
export type AcceptanceCheckType = "shell" | "file-exists";
export type RunStage =
  | "discovery"
  | "planning"
  | "policyGate"
  | "provisioning"
  | "execution"
  | "verification"
  | "release";

export interface IdeaInput {
  project: string;
  idea: string;
  constraints: string[];
  targetUsers: string[];
  labels?: string[];
}

export interface DiscoveryArtifact {
  brief: string;
  glossary: Record<string, string>;
  marketEvidence: string[];
  risks: Array<{
    id: string;
    title: string;
    level: RiskLevel;
    mitigation: string;
  }>;
}

export interface TaskExecutionRouting {
  originalMode: TaskMode;
  routedMode: TaskMode;
  reason: string;
  policyVersion: string;
}

export interface TaskRiskPriority {
  riskScore: number;
  priorityScore: number;
  riskLevel: RiskLevel;
  priorityLevel: RiskLevel;
  highRisk: boolean;
  threshold: number;
  dimensions: {
    security: number;
    blastRadius: number;
    complexity: number;
    urgency: number;
  };
  signals: Array<{
    id: string;
    dimension: "security" | "blastRadius" | "complexity" | "urgency";
    weight: number;
    reason: string;
    hits?: number;
  }>;
}

export interface TaskSpec {
  id: string;
  title: string;
  description: string;
  mode: TaskMode;
  dependencies: string[];
  acceptanceCriteria: string[];
  nfrTags: string[];
  backendHint?: string;
  maxAttempts?: number;
  workspaceStrategy?: WorkspaceStrategy;
  commands?: TaskCommand[];
  acceptanceChecks?: AcceptanceCheck[];
  riskPriority?: TaskRiskPriority;
  routing?: TaskExecutionRouting;
}

export interface TaskCommand {
  type: "shell" | "agent";
  command?: string;
  prompt?: string;
}

export interface AcceptanceCheck {
  type: AcceptanceCheckType;
  command?: string;
  path?: string;
}

export interface PlanArtifact {
  prd: string;
  architecture: string;
  nfrSpec: string;
  testStrategy: string;
  tasks: TaskSpec[];
}

export interface PolicyDecision {
  approved: boolean;
  blockers: string[];
  requiredRollbackChecks: string[];
}

export type ExecutionFailureReason =
  | "dependency_blocked"
  | "command_failed"
  | "acceptance_failed"
  | "cleanup_failed"
  | "backend_unavailable";

export interface ExecutionEscalation {
  required: boolean;
  target: "none" | "operator" | "planner";
  reason: string;
  action: string;
}

export interface ExecutionResult {
  taskId: string;
  status: "passed" | "failed" | "skipped";
  failureReason?: ExecutionFailureReason;
  blockedBy?: string[];
  escalation?: ExecutionEscalation;
  logs: string[];
  regressionsGenerated: string[];
  attempts?: number;
  workspacePath?: string;
  acceptancePassed?: boolean;
}

export interface VerificationReport {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
  sbomPath: string;
  securityReportPath: string;
}

export interface ReleaseBundle {
  deploymentGuidePath: string;
  operationsRunbookPath: string;
  releaseNotesPath: string;
  readinessChecklistPath: string;
}
