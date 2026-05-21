import { randomUUID } from "node:crypto";
import type { IntakeAmbiguitySignal, IntakeBrief } from "./schema.js";

export interface ClarificationQuestion {
  id: string;
  signalId: string;
  prompt: string;
  required: boolean;
}

export interface ClarificationCycle {
  cycleId: string;
  intakeId: string;
  generatedAt: string;
  ambiguityScore: number;
  ambiguityLevel: string;
  status: "pending_operator_response";
  questions: ClarificationQuestion[];
  triggeringSignals: IntakeAmbiguitySignal[];
}

const QUESTION_BY_SIGNAL: Record<string, string | ((brief: IntakeBrief) => string)> = {
  "missing-target-users":
    "Who are the primary users or stakeholders for this work, and what outcomes do they need?",
  "missing-constraints-for-risky-scope":
    "What compliance, security, reliability, or operational constraints must be enforced for this scope?",
  "short-description":
    "Please expand the request with concrete scope, deliverables, and success criteria (current description is too short).",
  "medium-description":
    "Please add more detail on expected deliverables, boundaries, and definition of done.",
  "vague-language":
    "Which unresolved decisions (maybe/TBD/later) should be finalized before planning can start?",
  "placeholder-tokens":
    "Please replace placeholder tokens (TODO/TBD/FIXME) with concrete requirements.",
  "conflicting-constraints": (brief) => {
    const constraints = brief.request.constraints.join("; ");
    return `Conflicting constraints were detected (${constraints}). Which constraint should take precedence?`;
  },
  "missing-acceptance-signals":
    "What measurable acceptance criteria define completion for this request?",
  "open-questions":
    "Please answer the open questions embedded in the request description before execution.",
};

function questionForSignal(signalId: string, brief: IntakeBrief): string {
  const template = QUESTION_BY_SIGNAL[signalId];
  if (!template) {
    return `Please clarify the requirement flagged by "${signalId}".`;
  }
  return typeof template === "function" ? template(brief) : template;
}

export function generateClarificationCycle(brief: IntakeBrief): ClarificationCycle {
  const seenPrompts = new Set<string>();
  const questions: ClarificationQuestion[] = [];

  for (const signal of brief.ambiguity.signals) {
    const prompt = questionForSignal(signal.id, brief);
    const key = prompt.toLowerCase();
    if (seenPrompts.has(key)) {
      continue;
    }
    seenPrompts.add(key);
    questions.push({
      id: `q-${questions.length + 1}`,
      signalId: signal.id,
      prompt,
      required: true,
    });
  }

  if (questions.length === 0) {
    questions.push({
      id: "q-1",
      signalId: "ambiguity-threshold",
      prompt:
        "This request exceeded the ambiguity threshold. Please provide additional scope, constraints, and acceptance criteria.",
      required: true,
    });
  }

  return {
    cycleId: randomUUID(),
    intakeId: brief.intakeId,
    generatedAt: new Date().toISOString(),
    ambiguityScore: brief.ambiguity.score,
    ambiguityLevel: brief.ambiguity.level,
    status: "pending_operator_response",
    questions,
    triggeringSignals: brief.ambiguity.signals,
  };
}
