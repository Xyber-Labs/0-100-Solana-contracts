import { FlowStep } from "../step";
import type { FlowContext } from "../types";
import { waitForFundingPeriodEnd as waitForFundingPeriodEndHelper } from "../../flowHelpers";

export class WaitFundingStep extends FlowStep {
  constructor() {
    super("[4/10] Wait Funding");
  }

  async execute(context: FlowContext): Promise<void> {
    const { provider, sdk, addLog, testLaunchState } = context;
    if (!testLaunchState) throw new Error("Launch state not initialized");

    addLog(`\n[4/10] Waiting for funding period to end...`);
    await waitForFundingPeriodEndHelper({ provider, sdk, launchPda: testLaunchState, addLog });
    addLog("   -> Funding period closed.");
  }
}
