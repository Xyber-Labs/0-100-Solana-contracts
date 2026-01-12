import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { IncomeDispatcher as IncomeDispatcherIDL } from "../../idl/income_dispatcher";
import EngineIDLJson from "../../idl/engine.json";
import { TxBuilder, Role, RoleType } from "./txBuilder";
import { getConstant } from "../utils";

const WSOL_MINT = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
const ENGINE_SEED_ROOT = Buffer.from(getConstant("SEED_ROOT", EngineIDLJson as any));
const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const MEMO_PROGRAM_ID = new anchor.web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export interface HarvestPoolBundle {
  altCreationTx?: anchor.web3.Transaction;
  altAddress: anchor.web3.PublicKey;
  harvestTx: anchor.web3.VersionedTransaction;
  cacheKey: string;
}

const IncomeDispatcherSDK = {
  create(
    provider: anchor.Provider,
    program: Program<IncomeDispatcherIDL>
  ) {
    const txBuilder = new TxBuilder(program);
    const altCache = new Map<string, anchor.web3.PublicKey>();

    function getAltCacheKey(projectId: BN, baseMint: anchor.web3.PublicKey, quoteMint: anchor.web3.PublicKey): string {
      return `${projectId.toString()}-${baseMint.toString()}-${quoteMint.toString()}`;
    }

    function getConfigPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getConfigPda();
    }

    function getTotalsPda(role: RoleType, mint: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getTotalsPda(role, mint);
    }

    function getProjectTotalsPda(projectId: BN, role: RoleType, mint: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getProjectTotalsPda(projectId, role, mint);
    }

    function getAuthorityPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getAuthorityPda();
    }

    function getNoncePda(projectId: BN, recipient: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getNoncePda(projectId, recipient);
    }

    async function initialize(args: {
      newMultisig: anchor.web3.PublicKey;
      backend: anchor.web3.PublicKey;
      platformWallet: anchor.web3.PublicKey;
      communityWallet: anchor.web3.PublicKey;
      signerKeypair: anchor.web3.Keypair;
    }): Promise<{ config: anchor.web3.PublicKey; signature: string }> {
      const [config] = getConfigPda();

      const ix = await program.methods
        .initialize(args.newMultisig, args.backend, args.platformWallet, args.communityWallet)
        .accountsStrict({
          multisig: args.signerKeypair.publicKey,
          config,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(ix);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, [args.signerKeypair]);

      return { config, signature };
    }

    async function fetchConfig() {
      const [config] = getConfigPda();
      return program.account.config.fetch(config);
    }

    async function fetchTotals(role: RoleType, mint: anchor.web3.PublicKey) {
      const [totals] = getTotalsPda(role, mint);
      return program.account.totals.fetch(totals);
    }

    async function fetchProjectTotals(projectId: BN, role: RoleType, mint: anchor.web3.PublicKey) {
      const [totals] = getProjectTotalsPda(projectId, role, mint);
      return program.account.totals.fetch(totals);
    }

    async function fetchNonce(projectId: BN, recipient: anchor.web3.PublicKey) {
      const [noncePda] = getNoncePda(projectId, recipient);
      return program.account.nonce.fetch(noncePda);
    }

    async function claim(args: {
      role: { creator: {} } | { community: {} };
      projectId: BN;
      launchState: anchor.web3.PublicKey;
      recipient: anchor.web3.PublicKey;
      mint: anchor.web3.PublicKey;
      nonce: BN;
      amount?: BN;
      remainingAccounts?: { pubkey: anchor.web3.PublicKey; isWritable: boolean; isSigner: boolean }[];
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      const tx = await txBuilder.claimTx({
        role: args.role,
        projectId: args.projectId,
        launchState: args.launchState,
        recipient: args.recipient,
        mint: args.mint,
        nonce: args.nonce,
        amount: args.amount,
        remainingAccounts: args.remainingAccounts,
      });

      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, args.signers);

      return { signature };
    }

    async function claimPlatform(args: {
      mint: anchor.web3.PublicKey;
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      const [config] = getConfigPda();
      const [authority] = getAuthorityPda();
      const recipient = args.signers[0].publicKey;
      const [totals] = getTotalsPda(Role.Treasure, args.mint);

      const sourceVault = getAssociatedTokenAddressSync(args.mint, authority, true);
      const recipientAta = getAssociatedTokenAddressSync(args.mint, recipient, false);

      const ix = await program.methods
        .claimPlatform()
        .accountsStrict({
          recipient,
          config,
          totals,
          authority,
          mint: args.mint,
          sourceVault,
          recipientAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
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
      addressLookupTableAccounts?: anchor.web3.AddressLookupTableAccount[];
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string }> {
      if (!provider.connection) throw new Error("Provider does not have connection");
      const { blockhash } = await provider.connection.getLatestBlockhash();

      const tx = await txBuilder.harvestPoolV0Tx({
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
        recentBlockhash: blockhash,
        addressLookupTableAccounts: args.addressLookupTableAccounts ?? [],
      });

      tx.sign(args.signers);
      const signature = await provider.connection.sendTransaction(tx);
      await provider.connection.confirmTransaction(signature);

      return { signature };
    }

    async function harvestPoolBundle(args: {
      payer: anchor.web3.PublicKey;
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
      altAddress?: anchor.web3.PublicKey;
    }): Promise<HarvestPoolBundle> {
      if (!provider.connection) throw new Error("Provider does not have connection");

      const cacheKey = getAltCacheKey(args.projectId, args.baseMint, args.quoteMint);
      let altAddress = args.altAddress || altCache.get(cacheKey);
      let altCreationTx: anchor.web3.Transaction | undefined;
      let altAccount: anchor.web3.AddressLookupTableAccount | undefined;

      if (altAddress) {
        const altResult = await provider.connection.getAddressLookupTable(altAddress);
        if (altResult.value) {
          altAccount = altResult.value;
        } else {
          altAddress = undefined;
        }
      }

      if (!altAddress) {
        const altAddresses = txBuilder.getHarvestAltAddresses(args.projectId, args.baseMint, args.quoteMint);

        const slot = await provider.connection.getSlot("finalized");
        const [createAltIx, newAltAddress] = anchor.web3.AddressLookupTableProgram.createLookupTable({
          authority: args.payer,
          payer: args.payer,
          recentSlot: slot - 1,
        });

        const extendAltIx = anchor.web3.AddressLookupTableProgram.extendLookupTable({
          payer: args.payer,
          authority: args.payer,
          lookupTable: newAltAddress,
          addresses: altAddresses,
        });

        altCreationTx = new anchor.web3.Transaction().add(createAltIx).add(extendAltIx);
        altAddress = newAltAddress;
      }

      const { blockhash } = await provider.connection.getLatestBlockhash();

      const harvestTx = await txBuilder.harvestPoolV0Tx({
        payer: args.payer,
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
        recentBlockhash: blockhash,
        addressLookupTableAccounts: altAccount ? [altAccount] : [],
      });

      return { altCreationTx, altAddress, harvestTx, cacheKey };
    }

    async function executeHarvestPoolBundle(
      bundle: HarvestPoolBundle,
      signers: anchor.web3.Keypair[]
    ): Promise<{ signature: string; altAddress: anchor.web3.PublicKey }> {
      if (!provider.connection) throw new Error("Provider does not have connection");
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");

      if (bundle.altCreationTx) {
        await provider.sendAndConfirm(bundle.altCreationTx, signers);
        await new Promise(resolve => setTimeout(resolve, 500));

        const altResult = await provider.connection.getAddressLookupTable(bundle.altAddress);
        if (!altResult.value) throw new Error("ALT not found after creation");

        const { blockhash } = await provider.connection.getLatestBlockhash();
        const messageV0 = new anchor.web3.TransactionMessage({
          payerKey: signers[0].publicKey,
          recentBlockhash: blockhash,
          instructions: anchor.web3.TransactionMessage.decompile(bundle.harvestTx.message).instructions,
        }).compileToV0Message([altResult.value]);

        bundle.harvestTx = new anchor.web3.VersionedTransaction(messageV0);
      }

      bundle.harvestTx.sign(signers);
      const signature = await provider.connection.sendTransaction(bundle.harvestTx);
      await provider.connection.confirmTransaction(signature);

      altCache.set(bundle.cacheKey, bundle.altAddress);

      return { signature, altAddress: bundle.altAddress };
    }

    async function buyback(args: {
      minXyberOut: anchor.BN;
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
      const [authority] = getAuthorityPda();
      const [buybackWsolTotals] = getTotalsPda(Role.BuyBack, WSOL_MINT);
      const [treasureXyberTotals] = getTotalsPda(Role.Treasure, args.xyberMint);

      const wsolVault = getAssociatedTokenAddressSync(WSOL_MINT, authority, true);
      const xyberVault = getAssociatedTokenAddressSync(args.xyberMint, authority, true);

      const engineConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
        [ENGINE_SEED_ROOT, Buffer.from("config")],
        args.engineProgramId
      )[0];

      const ix = await program.methods
        .buyback(args.minXyberOut)
        .accountsStrict({
          payer: args.signers[0].publicKey,
          dispatcherConfig: config,
          engineConfig: engineConfigPda,
          wsolMint: WSOL_MINT,
          xyberMint: args.xyberMint,
          buybackWsolTotals,
          treasureXyberTotals,
          authority,
          wsolVault,
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
      Role,

      getConfigPda,
      getTotalsPda,
      getProjectTotalsPda,
      getAuthorityPda,
      getNoncePda,

      initialize,
      claim,
      claimPlatform,
      harvestPool,
      harvestPoolBundle,
      executeHarvestPoolBundle,
      buyback,

      fetchConfig,
      fetchTotals,
      fetchProjectTotals,
      fetchNonce,
    };
  },
};

export default IncomeDispatcherSDK;
export { Role };
export type { IncomeDispatcherIDL, RoleType };
export type IncomeDispatcherClient = ReturnType<typeof IncomeDispatcherSDK.create>;
