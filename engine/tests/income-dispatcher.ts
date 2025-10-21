import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

import { IncomeDispatcher } from "../target/types/income_dispatcher";
import { Engine } from "../target/types/engine";
import DispatcherSDK from "../ts-sdk-dispatcher/src/dispatcher";

describe("income-dispatcher", () => {
  let client: LiteSVM;
  let provider: LiteSVMProvider;
  let program: Program<IncomeDispatcher>;
  let engineProgram: Program<Engine>;
  let admin: anchor.Wallet;
  let adminKeypair: anchor.web3.Keypair;
  let sdk: any;

  const platformWallet = anchor.web3.Keypair.generate().publicKey;

  before(async () => {
    client = fromWorkspace("./", {
      maxAccountDataSize: 8192 * 8,
    });
    provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    program = anchor.workspace.incomeDispatcher as Program<IncomeDispatcher>;
    engineProgram = anchor.workspace.engine as Program<Engine>;
    admin = provider.wallet;
    adminKeypair = (provider.wallet as any).payer;
    sdk = DispatcherSDK.create(provider as any, program as any);

    client.airdrop(admin.publicKey, BigInt(100 * anchor.web3.LAMPORTS_PER_SOL));
  });

  it("Initializes config correctly", async () => {
    const [config] = sdk.getConfigPda();

    const { transaction } = await sdk.txBuilder.initializeTx({
      admin: admin.publicKey,
      platformWallet,
      incomeSource: engineProgram.programId,
    });

    const tx = await provider.sendAndConfirm(transaction, [adminKeypair]);
    console.log("Initialize tx signature:", tx);

    const configAccount = await sdk.fetchConfig(config);

    assert.ok(configAccount.admin.equals(admin.publicKey), "Admin should match");
    assert.ok(configAccount.platformWallet.equals(platformWallet), "Platform wallet should match");
    assert.ok(configAccount.incomeSource.equals(engineProgram.programId), "Income source should match engine program ID");
  });

  it("Updates platform wallet", async () => {
    const [config] = sdk.getConfigPda();

    const newPlatformWallet = anchor.web3.Keypair.generate().publicKey;

    const { transaction } = await sdk.txBuilder.updatePlatformWalletTx({
      admin: admin.publicKey,
      newPlatformWallet,
    });

    const tx = await provider.sendAndConfirm(transaction, [adminKeypair]);
    console.log("Update platform wallet tx signature:", tx);

    const configAccount = await sdk.fetchConfig(config);

    assert.ok(configAccount.platformWallet.equals(newPlatformWallet), "Platform wallet should be updated");
    assert.ok(configAccount.admin.equals(admin.publicKey), "Admin should remain unchanged");
    assert.ok(configAccount.incomeSource.equals(engineProgram.programId), "Income source should remain unchanged");
  });

  it("Fails when non-admin tries to update platform wallet", async () => {
    const nonAdmin = anchor.web3.Keypair.generate();
    client.airdrop(nonAdmin.publicKey, BigInt(10 * anchor.web3.LAMPORTS_PER_SOL));

    const newPlatformWallet = anchor.web3.Keypair.generate().publicKey;

    const { transaction } = await sdk.txBuilder.updatePlatformWalletTx({
      admin: nonAdmin.publicKey,
      newPlatformWallet,
    });

    try {
      await provider.sendAndConfirm(transaction, [nonAdmin]);
      assert.fail("Should have thrown an error");
    } catch (err: any) {
      assert.include(err.toString(), "Unauthorized");
    }
  });
});
