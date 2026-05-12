import type { z } from "zod";
import type { EvaluationVector, Source } from "../event-types.js";

/**
 * A registered action. The framework ships thirteen canonical actions in
 * `DEFAULT_ACTIONS`; consumers may extend with custom actions via
 * `ActionRegistry`.
 *
 * `defaultEvaluations` is the per-axis polarity heuristic the classifier
 * applies in absence of richer signal. Consumers may override per-event via
 * `RecordReactionInput.evaluations_override`.
 */
export interface FeedbackActionDefinition {
  name: string;
  source: Source;
  defaultEvaluations: EvaluationVector;
  payloadSchema: z.ZodType<unknown>;
  description?: string;
}

/**
 * Helper for consumer-declared custom actions. Returns the input unchanged
 * but attaches an explicit type so consumers get IDE help.
 */
export function registerAction(action: FeedbackActionDefinition): FeedbackActionDefinition {
  return action;
}

export class ActionRegistry {
  private readonly actions = new Map<string, FeedbackActionDefinition>();

  constructor(actions: FeedbackActionDefinition[] = []) {
    for (const action of actions) {
      this.register(action);
    }
  }

  register(action: FeedbackActionDefinition): void {
    if (this.actions.has(action.name)) {
      throw new Error(`Action already registered: ${action.name}`);
    }
    this.actions.set(action.name, action);
  }

  get(name: string): FeedbackActionDefinition {
    const action = this.actions.get(name);
    if (!action) {
      throw new Error(
        `Unknown action: ${name}. Registered actions: ${Array.from(this.actions.keys()).join(", ")}`,
      );
    }
    return action;
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  list(): FeedbackActionDefinition[] {
    return Array.from(this.actions.values());
  }
}
