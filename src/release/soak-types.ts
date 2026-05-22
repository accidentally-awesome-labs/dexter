export interface SoakStepResult {
  name: string;
  command: string;
  exitCode: number;
  durationMs: number;
}

export interface SoakCycleResult {
  at: string;
  passed: boolean;
  durationMs: number;
  steps: SoakStepResult[];
  failureReason?: string;
}

export interface SoakStatus {
  schemaVersion: "1.0";
  targetStreak: number;
  currentStreak: number;
  longestStreak: number;
  totalCycles: number;
  gateSatisfied: boolean;
  lastCycleAt?: string;
  lastCyclePassed?: boolean;
  lastFailureReason?: string;
  history: SoakCycleResult[];
}
