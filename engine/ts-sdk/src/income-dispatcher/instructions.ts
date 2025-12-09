import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { IncomeDispatcher as IncomeDispatcherIDL } from "../../idl/income_dispatcher";
import { TxBuilder } from "./txBuilder";

const IncomeDispatcherSDK = {
  create(
    provider: anchor.Provider,
    program: Program<IncomeDispatcherIDL>
  ) {
    const txBuilder = new TxBuilder(program);

    function getConfigPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getConfigPda();
    }

    function getProjectTotalsPda(projectId: BN): [anchor.web3.PublicKey, number] {
      return txBuilder.getProjectTotalsPda(projectId);
    }

    function getPlatformTotalsPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getPlatformTotalsPda();
    }

    function getHarvestAuthorityPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getHarvestAuthorityPda();
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
      const [platformTotals] = getPlatformTotalsPda();
      const admin = args.signers[0].publicKey;

      const ix = await program.methods
        .initialize(args.platformWallet, args.communityWallet)
        .accountsStrict({
          admin,
          config,
          platformTotals,
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

    async function fetchProjectTotals(projectId: BN) {
      const [projectTotals] = getProjectTotalsPda(projectId);
      return program.account.totals.fetch(projectTotals);
    }

    async function fetchPlatformTotals() {
      const [platformTotals] = getPlatformTotalsPda();
      return program.account.totals.fetch(platformTotals);
    }

    async function fetchNonce(projectId: BN, recipient: anchor.web3.PublicKey) {
      const [noncePda] = getNoncePda(projectId, recipient);
      return program.account.nonce.fetch(noncePda);
    }

    async function claim(args: {
      role: { treasure: {} } | { creator: {} } | { community: {} } | { buyBack: {} };
      projectId: BN;
      launchState: anchor.web3.PublicKey;
      recipient: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      quoteMint: anchor.web3.PublicKey;
      nonce: BN;
      limitBaseClaim?: BN;
      limitQuoteClaim?: BN;
      remainingAccounts?: { pubkey: anchor.web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      const [config] = getConfigPda();
      const [projectTotals] = getProjectTotalsPda(args.projectId);
      const [platformTotals] = getPlatformTotalsPda();
      const [harvestAuthority] = getHarvestAuthorityPda();
      const [noncePda] = getNoncePda(args.projectId, args.recipient);

      const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

      const baseVault = getAssociatedTokenAddressSync(
        args.baseMint,
        harvestAuthority,
        true
      );

      const quoteVault = getAssociatedTokenAddressSync(
        args.quoteMint,
        harvestAuthority,
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
        .claim(args.projectId, args.role, args.nonce, args.limitBaseClaim ?? null, args.limitQuoteClaim ?? null)
        .accountsStrict({
          recipient: args.recipient,
          config,
          launchState: args.launchState,
          projectTotals,
          platformTotals,
          harvestAuthority,
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
      raydiumPositionNftMint: anchor.web3.PublicKey;
      raydiumPositionNftAccount: anchor.web3.PublicKey;
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
        raydiumPositionNftMint: args.raydiumPositionNftMint,
        raydiumPositionNftAccount: args.raydiumPositionNftAccount,
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

    async function buyback(args: {
      xyberMint: anchor.web3.PublicKey;
      raydiumPoolState: anchor.web3.PublicKey;
      raydiumAmmConfig: anchor.web3.PublicKey;
      raydiumQuoteVault: anchor.web3.PublicKey;
      raydiumXyberVault: anchor.web3.PublicKey;
      raydiumObservationState: anchor.web3.PublicKey;
      remainingAccounts: { pubkey: anchor.web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
      engineProgramId: anchor.web3.PublicKey;
      raydiumProgramId: anchor.web3.PublicKey;
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      const [config] = getConfigPda();
      const [platformTotals] = getPlatformTotalsPda();
      const [harvestAuthority] = getHarvestAuthorityPda();

      const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
      const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
      const MEMO_PROGRAM_ID = new anchor.web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      const quoteVault = getAssociatedTokenAddressSync(WSOL_MINT, harvestAuthority, true);
      const xyberVault = getAssociatedTokenAddressSync(args.xyberMint, harvestAuthority, true);

      const engineConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("root-0-100-1"), Buffer.from("config")],
        args.engineProgramId
      )[0];

      const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

      const ix = await program.methods
        .buyback()
        .accountsStrict({
          payer: args.signers[0].publicKey,
          dispatcherConfig: config,
          engineConfig: engineConfigPda,
          platformTotals,
          harvestAuthority,
          quoteMint: WSOL_MINT,
          xyberMint: args.xyberMint,
          quoteVault,
          xyberVault,
          raydiumPoolState: args.raydiumPoolState,
          raydiumAmmConfig: args.raydiumAmmConfig,
          raydiumQuoteVault: args.raydiumQuoteVault,
          raydiumXyberVault: args.raydiumXyberVault,
          raydiumObservationState: args.raydiumObservationState,
          raydiumProgram: args.raydiumProgramId,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenProgram2022: TOKEN_2022_PROGRAM_ID,
          memoProgram: MEMO_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(args.remainingAccounts)
        .instruction();

      const tx = new anchor.web3.Transaction().add(ix);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, args.signers);

      return { signature };
    }

    return {
      program,
      txBuilder,

      getConfigPda,
      getProjectTotalsPda,
      getPlatformTotalsPda,
      getHarvestAuthorityPda,
      getNoncePda,

      initialize,
      claim,
      harvestPool,
      buyback,

      fetchConfig,
      fetchProjectTotals,
      fetchPlatformTotals,
      fetchNonce,
    };
  },
};

export default IncomeDispatcherSDK;
export type { IncomeDispatcherIDL };
export type IncomeDispatcherClient = ReturnType<typeof IncomeDispatcherSDK.create>;
