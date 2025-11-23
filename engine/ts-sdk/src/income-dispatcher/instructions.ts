import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { IncomeDispatcher as IncomeDispatcherIDL } from "../../idl/income_dispatcher";
import { TxBuilder } from "./txBuilder";

const MEMO_PROGRAM_ID = new anchor.web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RAYDIUM_CLMM_PROGRAM_ID = new anchor.web3.PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

const IncomeDispatcherSDK = {
  create(
    provider: anchor.Provider,
    program: Program<IncomeDispatcherIDL>,
    admin?: anchor.web3.Keypair
  ) {
    const payer = admin?.publicKey ?? provider.publicKey!;
    const txBuilder = new TxBuilder(program);

    function getConfigPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getConfigPda();
    }

    function getIncomeConfigPda(projectId: BN): [anchor.web3.PublicKey, number] {
      return txBuilder.getIncomeConfigPda(projectId);
    }

    function getProjectAuthorityPda(projectId: BN): [anchor.web3.PublicKey, number] {
      return txBuilder.getProjectAuthorityPda(projectId);
    }

    function getNoncePda(projectId: BN, recipient: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getNoncePda(projectId, recipient);
    }

    async function initialize(args: {
      platformWallet: anchor.web3.PublicKey;
      communityWallet: anchor.web3.PublicKey;
      signers: anchor.web3.Keypair[];
    }): Promise<{ config: anchor.web3.PublicKey; signature: string }> {
      const [config] = getConfigPda();
      const admin = args.signers[0].publicKey;

      const ix = await program.methods
        .initialize(args.platformWallet, args.communityWallet)
        .accountsStrict({
          admin,
          config,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(ix);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, args.signers);

      return { config, signature };
    }

    async function fetchConfig() {
      const [config] = getConfigPda();
      return program.account.config.fetch(config);
    }

    async function fetchIncomeConfig(projectId: BN) {
      const [incomeConfig] = getIncomeConfigPda(projectId);
      return program.account.incomeConfig.fetch(incomeConfig);
    }

    async function claim(args: {
      role: { platform: {} } | { creator: {} } | { community: {} };
      projectId: BN;
      launchState: anchor.web3.PublicKey;
      recipient: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      quoteMint: anchor.web3.PublicKey;
      nonce: number;
      remainingAccounts?: { pubkey: anchor.web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      const [config] = getConfigPda();
      const [incomeConfig] = getIncomeConfigPda(args.projectId);
      const [projectAuthority] = getProjectAuthorityPda(args.projectId);
      const [noncePda] = getNoncePda(args.projectId, args.recipient);

      const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

      const baseVault = getAssociatedTokenAddressSync(
        args.baseMint,
        projectAuthority,
        true
      );

      const quoteVault = getAssociatedTokenAddressSync(
        args.quoteMint,
        projectAuthority,
        true
      );

      const recipientBaseAta = getAssociatedTokenAddressSync(
        args.baseMint,
        args.recipient,
        false
      );

      const recipientQuoteAta = getAssociatedTokenAddressSync(
        args.quoteMint,
        args.recipient,
        false
      );

      const ix = await program.methods
        .claim(new BN(args.projectId), args.role, new BN(args.nonce))
        .accountsStrict({
          recipient: args.recipient,
          config,
          launchState: args.launchState,
          incomeConfig,
          projectAuthority,
          nonce: noncePda,
          baseMint: args.baseMint,
          quoteMint: args.quoteMint,
          baseVault,
          quoteVault,
          recipientBaseAta,
          recipientQuoteAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(args.remainingAccounts || [])
        .instruction();

      const tx = new anchor.web3.Transaction().add(ix);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, args.signers);

      return { signature };
    }


    async function harvestPool(args: {
      launchState: anchor.web3.PublicKey;
      projectId: BN;
      baseMint: anchor.web3.PublicKey;
      quoteMint: anchor.web3.PublicKey;
      engineProgram: anchor.web3.PublicKey;
      escrowAuthority: anchor.web3.PublicKey;
      positionNftMint: anchor.web3.PublicKey;
      positionNftAccount: anchor.web3.PublicKey;
      personalPosition: anchor.web3.PublicKey;
      raydiumPoolState: anchor.web3.PublicKey;
      protocolPosition: anchor.web3.PublicKey;
      tokenVault0: anchor.web3.PublicKey;
      tokenVault1: anchor.web3.PublicKey;
      tickArrayLower: anchor.web3.PublicKey;
      tickArrayUpper: anchor.web3.PublicKey;
      remainingAccounts?: { pubkey: anchor.web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      const tx = await txBuilder.harvestPoolTx({
        payer: args.signers[0].publicKey,
        launchState: args.launchState,
        projectId: args.projectId,
        baseMint: args.baseMint,
        quoteMint: args.quoteMint,
        engineProgram: args.engineProgram,
        escrowAuthority: args.escrowAuthority,
        positionNftMint: args.positionNftMint,
        positionNftAccount: args.positionNftAccount,
        personalPosition: args.personalPosition,
        raydiumPoolState: args.raydiumPoolState,
        protocolPosition: args.protocolPosition,
        tokenVault0: args.tokenVault0,
        tokenVault1: args.tokenVault1,
        tickArrayLower: args.tickArrayLower,
        tickArrayUpper: args.tickArrayUpper,
        remainingAccounts: args.remainingAccounts,
      });

      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, args.signers);

      return { signature };
    }

    return {
      program,
      txBuilder,

      getConfigPda,
      getIncomeConfigPda,
      getProjectAuthorityPda,
      getNoncePda,

      initialize,
      claim,
      harvestPool,

      fetchConfig,
      fetchIncomeConfig,
    };
  },
};

export default IncomeDispatcherSDK;
export type { IncomeDispatcherIDL };
export type IncomeDispatcherClient = ReturnType<typeof IncomeDispatcherSDK.create>;
