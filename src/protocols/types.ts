export type RiskLevel = "low" | "medium" | "high" | "critical";
export type TaskMode = "AFK" | "HITL";
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

export interface TaskSpec {
  id: string;
  title: string;
  description: string;
  mode: TaskMode;
  dependencies: string[];
  acceptanceCriteria: string[];
  nfrTags: string[];
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

export interface ExecutionResult {
  taskId: string;
  status: "passed" | "failed";
  logs: string[];
  regressionsGenerated: string[];
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
