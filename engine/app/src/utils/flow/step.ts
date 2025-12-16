import type { FlowContext } from "./types";

export abstract class FlowStep {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract execute(context: FlowContext): Promise<void>;

  protected log(context: FlowContext, message: string) {
    context.addLog(message);
  }
}

