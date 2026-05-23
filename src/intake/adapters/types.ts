import type { IntakeBrief } from "../schema.js";
import type { IntakeSourceType } from "../schema.js";

export type IntakeAdapterId = IntakeSourceType;

export interface IntakeAdapter<TPayload> {
  id: IntakeAdapterId;
  channel: string;
  normalize(payload: TPayload): IntakeBrief;
}
