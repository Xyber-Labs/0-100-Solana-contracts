import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import type { IncomeDispatcher as IncomeDispatcherIDL } from "../idl/income_dispatcher";
import { TxBuilder } from "./txBuilder";

let idl: any;
const loadIdl = async () => {
  if (!idl) {
    const idlModule = await import("../idl/income_dispatcher.json");
    idl = idlModule.default;
  }
  return idl;
};

export default {
  idlJson: null,
  loadIdl,
  idlType: null as unknown as IncomeDispatcherIDL,

  create(
    provider: anchor.Provider,
    program: Program<IncomeDispatcherIDL>
  ) {
    const txBuilder = new TxBuilder(program);

    function getConfigPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getConfigPda();
    }

    function getProjectPoolPda(projectId: Buffer): [anchor.web3.PublicKey, number] {
      return txBuilder.getProjectPoolPda(projectId);
    }

    async function fetchConfig(config: anchor.web3.PublicKey) {
      return program.account.config.fetch(config);
    }

    async function fetchProjectPool(projectPool: anchor.web3.PublicKey) {
      return program.account.projectPool.fetch(projectPool);
    }

    return {
      program,
      provider,
      txBuilder,
      getConfigPda,
      getProjectPoolPda,
      fetchConfig,
      fetchProjectPool,
    };
  },
};
