import type { z } from "zod";
import type { Polarity, Inference, Source } from "../event-types.js";

export interface FeedbackActionDefinition {
  name: string;
  polarity: Polarity;
  defaultInference: Inference;
  source: Source;
  payloadSchema: z.ZodType<unknown>;
  description?: string;
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
