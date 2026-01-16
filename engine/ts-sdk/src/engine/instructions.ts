import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ---- IDL ----
import type { Engine as EngineIDL } from "../../idl/engine";
import { TxBuilder } from "./txBuilder";

// Import IDL as a dynamic import to avoid require
let idl: any;
const loadIdl = async () => {
  if (!idl) {
    const idlModule = await import("../../idl/engine.json");
    idl = idlModule.default;
  }
  return idl;
};

const EngineSDK = {
  idlJson: null, // Will be loaded dynamically
  loadIdl,
  idlType: null as unknown as EngineIDL, // type‑only reference

  /**
   * Creates an SDK on top of an already configured anchor.Program.
   * @param provider Anchor provider (payer = admin/user)
   * @param program Program<EngineIDL> on ENGINE_PROGRAM_ID
   * @param admin Optional admin keypair (defaults to provider wallet)
   */
  create(
    provider: anchor.Provider,
    program: Program<EngineIDL>,
    admin?: anchor.web3.Keypair
  ) {
    const payer = admin?.publicKey ?? provider.publicKey!;
    const adminKeypair = admin;
    const txBuilder = new TxBuilder(program, admin);

    async function sendAndMaybeConfirm(
      tx: anchor.web3.Transaction,
      signers: anchor.web3.Signer[] = []
    ): Promise<string> {
      const conn = program.provider.connection;

      if (!tx.feePayer && signers.length > 0) {
        tx.feePayer = signers[0].publicKey;
      }

      if (!tx.recentBlockhash) {
        const { blockhash } = await conn.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
      }

      if (signers.length > 0) {
        tx.sign(...signers);
      }

      const rawTx = tx.serialize();
      const signature = await conn.sendRawTransaction(rawTx);

      await conn.confirmTransaction(signature, "confirmed");
      return signature;
    }

    // -------------- PDA helpers --------------
    function getLaunchPda(baseMint: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["launch", baseMint]);
    }

    function getLaunchPdaByProjectId(projectId: number | BN): [anchor.web3.PublicKey, number] {
      const le = BN.isBN(projectId)
        ? (projectId as BN).toArrayLike(Uint8Array as any, "le", 8) as Uint8Array
        : (() => {
            const buf = new Uint8Array(8);
            const view = new DataView(buf.buffer);
            view.setBigUint64(0, BigInt(projectId), true);
            return buf;
          })();
      return txBuilder.getPda(["launch", le]);
    }

    function getEscrowPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["escrow_authority", launch]);
    }

    function getEscrowAuthorityPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["escrow_authority", launch]);
    }

    function getContributionPda(
      launch: anchor.web3.PublicKey,
      contributor: anchor.web3.PublicKey
    ): [anchor.web3.PublicKey, number] {
      return txBuilder.getContributionPda(launch, contributor);
    }


    function getTicketsClaimedPda(
      launch: anchor.web3.PublicKey,
      bucket: number,
      participant: anchor.web3.PublicKey
    ): [anchor.web3.PublicKey, number] {
      return txBuilder.getTicketsClaimedPda(launch, bucket, participant);
    }

    function getUserContributionPda(
      launch: anchor.web3.PublicKey,
      user: anchor.web3.PublicKey
    ): [anchor.web3.PublicKey, number] {
      return getContributionPda(launch, user);
    }

    function getMintAuthPda(launch: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["mint_auth", launch]);
    }

    function getProjectCounterPda(): [anchor.web3.PublicKey, number] {
      return txBuilder.getPda(["project_counter"]);
    }

    function getLaunchPresetPda(id: number): [anchor.web3.PublicKey, number] {
      return txBuilder.getLaunchPresetPda(id);
    }

    function getUserAta(mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey): anchor.web3.PublicKey {
      return getAssociatedTokenAddressSync(mint, owner, true);
    }

    function buildCreateAtaIx(args: {
      payer: anchor.web3.PublicKey;
      owner: anchor.web3.PublicKey;
      mint: anchor.web3.PublicKey;
    }): { ata: anchor.web3.PublicKey; ix: anchor.web3.TransactionInstruction } {
      const ata = getUserAta(args.mint, args.owner);
      const ix = createAssociatedTokenAccountInstruction(
        args.payer,
        ata,
        args.owner,
        args.mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      return { ata, ix };
    }

    // =============================
    //          TX methods
    // =============================

    async function setSeed(args: {
      launch: anchor.web3.PublicKey;
      signers?: anchor.web3.Keypair[];
    }): Promise<{ selectionPda: anchor.web3.PublicKey; signature: string }> {
      const { instruction, selectionPda } = await txBuilder.setSeedIx({
        launch: args.launch,
        payer,
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, args.signers ?? []);
      return { selectionPda, signature };
    }

    // processBatch deprecated in on-chain program; keep for compatibility but will fail
    async function processBatch(_: any): Promise<{ signature: string }> {
      throw new Error("processBatch deprecated; use setSeed + finalizeLottery");
    }

    async function deposit(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      contributorKeypair: anchor.web3.Keypair;
    }): Promise<{ contributionPda: anchor.web3.PublicKey; signature: string }> {
      const { transaction, contribution } = await txBuilder.depositTx({
        launch: args.launch,
        contributor: args.contributorKeypair.publicKey,
        amount: args.amountLamports,
      });

      const signature = await sendAndMaybeConfirm(transaction, [args.contributorKeypair]);
      return { contributionPda: contribution, signature };
    }

    async function withdraw(args: {
      launch: anchor.web3.PublicKey;
      amountLamports: BN;
      contributorKeypair: anchor.web3.Keypair;
    }): Promise<{ signature: string }> {
      const { transaction } = await txBuilder.withdrawTx({
        launch: args.launch,
        contributor: args.contributorKeypair.publicKey,
        amount: args.amountLamports,
      });
      const signature = await sendAndMaybeConfirm(transaction, [args.contributorKeypair]);
      return { signature };
    }

    async function refund(args: {
      launch: anchor.web3.PublicKey;
      contributorKeypair: anchor.web3.Keypair;
    }): Promise<{ signature: string }> {
      const { transaction } = await txBuilder.refundTx({
        launch: args.launch,
        contributor: args.contributorKeypair.publicKey,
      });
      const signature = await sendAndMaybeConfirm(transaction, [args.contributorKeypair]);
      return { signature };
    }

    /**
     * Important:
     * 1) baseMint must have mintAuthority = PDA ["mint_auth", launch].
     * 2) userAta (user's ATA for baseMint) must exist. If
     *    createAtaIfMissing = true, the SDK will add an ix for creation.
     */
    async function finalizeLottery(args: {
      launch: anchor.web3.PublicKey;
      payerKeypair?: anchor.web3.Keypair;
      useTestMode?: boolean;
      computeUnits?: number;
      computeUnitPriceMicroLamports?: number;
    }): Promise<{ signature: string }> {
      const defaultPayerKp: anchor.web3.Keypair | undefined = (provider as any)?.wallet?.payer;
      const payerPubkey = args.payerKeypair?.publicKey ?? defaultPayerKp?.publicKey ?? payer;
      const { transaction } = await txBuilder.finalizeLotteryTx({
        payer: payerPubkey,
        launch: args.launch,
        computeUnits: args.computeUnits,
        computeUnitPriceMicroLamports: args.computeUnitPriceMicroLamports,
      });
      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }
      const signers = args.payerKeypair
        ? [args.payerKeypair]
        : (defaultPayerKp ? [defaultPayerKp] as anchor.web3.Keypair[] : []);
      const signature = await provider.sendAndConfirm(transaction, signers);
      return { signature };
    }

    async function createClmmPool(args: {
      launch: anchor.web3.PublicKey;
      signers: anchor.web3.Keypair[];
    }): Promise<{
      signature: string;
      baseMint: anchor.web3.PublicKey;
      baseTokenAta: anchor.web3.PublicKey;
      quoteVault: anchor.web3.PublicKey;
      baseVault: anchor.web3.PublicKey;
    }> {
      const payerPubkey = args.signers[0]?.publicKey ?? payer;

      const result = await txBuilder.createClmmPoolTx({
        payer: payerPubkey,
        launch: args.launch,
        clmmProgram: txBuilder.getRaydiumClmmProgramId(),
        provider,
      });

      console.log("createClmmPool transaction details:");
      console.log("  Instructions count:", result.transaction.instructions.length);
      console.log("  Signers:", args.signers.map(s => s.publicKey.toString()));
      console.log("  baseMint:", result.baseMint.toString());
      console.log("  baseTokenAta:", result.baseTokenAta.toString());
      console.log("  poolState:", result.poolState.toString());
      console.log("  tickArrayBitmap:", result.tickArrayBitmap.toString());
      console.log("  quoteVault:", result.quoteVault.toString());
      console.log("  baseVault:", result.baseVault.toString());

      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }

      const allSigners = [...args.signers, ...result.signers];

      try {
        const signature = await provider.sendAndConfirm(result.transaction, allSigners);
        return {
          signature,
          baseMint: result.baseMint,
          baseTokenAta: result.baseTokenAta,
          quoteVault: result.quoteVault,
          baseVault: result.baseVault,
        };
      } catch (error: any) {
        console.error("Transaction failed:", error.message);
        if (error.logs) {
          console.error("Transaction logs:", error.logs);
        }
        throw error;
      }
    }

    async function addClmmLiquidity(args: {
      launch: anchor.web3.PublicKey;
      signers: anchor.web3.Keypair[];
    }): Promise<{
      signature: string;
    }> {
      const payerPubkey = args.signers[0]?.publicKey ?? payer;

      const { data: launchState } = await txBuilder.fetchLaunch(args.launch);
      const baseMint = txBuilder.extractBaseMint(launchState);

      if (!baseMint) {
        throw new Error("Launch state does not have baseMint set. Pool must be created first.");
      }

      const result = await txBuilder.addClmmLiquidityTx({
        payer: payerPubkey,
        launch: args.launch,
        baseMint: baseMint,
        provider,
      });

      if (!provider.sendAndConfirm) {
        throw new Error("Provider does not support sendAndConfirm");
      }

      const allSigners = [...args.signers, ...result.signers];

      try {
        const signature = await provider.sendAndConfirm(result.transaction, allSigners);
        return { signature };
      } catch (error: any) {
        console.error("Transaction failed:", error.message);
        if (error.logs) {
          console.error("Transaction logs:", error.logs);
        }
        throw error;
      }
    }

    async function claim(args: {
      launch: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      bucket: number;
      participantKeypair: anchor.web3.Keypair;
      computeUnits?: number;
    }): Promise<{ signature: string; participantAta: anchor.web3.PublicKey }> {
      const { transaction, participantAta } = await txBuilder.claimTx({
        launch: args.launch,
        baseMint: args.baseMint,
        participant: args.participantKeypair.publicKey,
        bucket: args.bucket,
        computeUnits: args.computeUnits,
      });

      const signature = await sendAndMaybeConfirm(transaction, [args.participantKeypair]);
      return { signature, participantAta };
    }

    async function closeBitmaps(args: {
      launch: anchor.web3.PublicKey;
      multisig: anchor.web3.PublicKey;
      rentRecipient: anchor.web3.PublicKey;
      signers: anchor.web3.Keypair[];
    }): Promise<{ signature: string; winnersBitmap: anchor.web3.PublicKey; inactiveBitmap: anchor.web3.PublicKey }> {
      const { transaction, winnersBitmap, inactiveBitmap } = await txBuilder.closeBitmapsTx({
        launch: args.launch,
        multisig: args.multisig,
        rentRecipient: args.rentRecipient,
      });

      const signature = await sendAndMaybeConfirm(transaction, args.signers);
      return { signature, winnersBitmap, inactiveBitmap };
    }

    async function initEngineConfig(args: {
      treasury: anchor.web3.PublicKey;
      xyberMint: anchor.web3.PublicKey;
      newMultisig: anchor.web3.PublicKey;
      reallocFundLamports: BN;
      signerKeypair: anchor.web3.Keypair;
    }): Promise<{ engineConfig: anchor.web3.PublicKey; reallocFunds: anchor.web3.PublicKey; projectCounter: anchor.web3.PublicKey; signature: string }> {
      const { instruction, engineConfig, reallocFunds, projectCounter } = await txBuilder.initEngineConfigIx({
        signer: args.signerKeypair.publicKey,
        newMultisig: args.newMultisig,
        treasury: args.treasury,
        xyberMint: args.xyberMint,
        reallocFundLamports: args.reallocFundLamports,
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, [args.signerKeypair]);
      return { engineConfig, reallocFunds, projectCounter, signature };
    }

    async function initLaunchPreset(args: {
      params: {
        id: number;
        isEnabled: boolean;
        hardCapLamports: BN;
        minRaiseLamports: BN;
        perWalletCap: BN;
        tauLamports: BN;
        baseTotalAllocation: BN;
        baseSaleBasisPoints: BN;
        teamAllocationBasisPoints: number;
        fundingDurationSeconds: number;
        unlockTimeSec: number;
        creatorPeriodUnlock: BN;
        creatorPeriodSec: number;
        creatorMaxDeposit: BN;
        poolCreationGracePeriodSec: number;
        teamDurationSec: number;
        teamPeriodSec: number;
        contributorDurationSec: number;
        contributorPeriodSec: number;
        withdrawalLimit: number;
        creationFee: BN;
      };
      multisigKeypair: anchor.web3.Keypair;
    }): Promise<{ launchPreset: anchor.web3.PublicKey; signature: string }> {
      const { instruction, launchPreset } = await txBuilder.initLaunchPresetIx({
        multisig: args.multisigKeypair.publicKey,
        ...args.params,
      });
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(new anchor.web3.Transaction().add(instruction), [args.multisigKeypair]);
      return { launchPreset, signature };
    }

    async function initLaunch(args: {
      presetId: number;
      projectId?: BN | number;
      /** Absolute unix timestamp (seconds) when the sale starts. If omitted/0, starts immediately. */
      saleStartTimeTimestamp?: number;
      name: string;
      symbol: string;
      uri: string;
      isMutable?: boolean;
      sellerFeeBasisPoints?: number;
      creator?: anchor.web3.Keypair;
      /** Optional third party signer for event tracking */
      thirdParty?: anchor.web3.Keypair;
    }): Promise<{ launchPda: anchor.web3.PublicKey; signature: string }> {
      const creatorPubkey = args.creator?.publicKey ?? payer;
      const projectId = args.projectId ?? (await getNextProjectId());
      const { instruction, launchState } = await txBuilder.initLaunchIx({
        creator: creatorPubkey,
        presetId: args.presetId,
        projectId,
        saleStartTimeTimestamp: args.saleStartTimeTimestamp ?? 0,
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
        isMutable: typeof args.isMutable === "boolean" ? args.isMutable : true,
        sellerFeeBasisPoints: typeof args.sellerFeeBasisPoints === "number" ? args.sellerFeeBasisPoints : 0,
        thirdParty: args.thirdParty?.publicKey,
      });
      const tx = new anchor.web3.Transaction().add(instruction);
      const signers: anchor.web3.Keypair[] = [];
      if (args.creator) signers.push(args.creator);
      if (args.thirdParty) signers.push(args.thirdParty);
      if (!provider.sendAndConfirm) throw new Error("Provider does not support sendAndConfirm");
      const signature = await provider.sendAndConfirm(tx, signers);
      return { launchPda: launchState, signature };
    }

    async function getLiquidityRange(args: {
      launch: anchor.web3.PublicKey;
      baseMint: anchor.web3.PublicKey;
      quoteMint: anchor.web3.PublicKey;
      raydiumQuoteVault: anchor.web3.PublicKey;
      raydiumBaseVault: anchor.web3.PublicKey;
    }) {
      return txBuilder.getLiquidityRange(args);
    }

    async function getSqrtPriceLowerX64ForPool(args: { launch: anchor.web3.PublicKey; priceBumpMultiplier?: number; lowerRangePow10?: number }) {
      return txBuilder.getSqrtPriceLowerX64ForPool({ launch: args.launch, priceBumpMultiplier: args.priceBumpMultiplier, lowerRangePow10: args.lowerRangePow10 });
    }

    async function estimateQuoteForBase(args: { launch: anchor.web3.PublicKey; baseAmount: BN; safetyBumpBps?: number }) {
      return txBuilder.estimateQuoteForBase({ launch: args.launch, baseAmount: args.baseAmount, safetyBumpBps: args.safetyBumpBps });
    }

    // =============================
    //         FETCH helpers
    // =============================

    async function fetchEngineConfig() {
      const [pda] = txBuilder.getConfigPda();
      const data = await (program.account as any).engineConfig.fetch(pda);
      return { data, pda };
    }

    async function fetchLaunch(launch: anchor.web3.PublicKey) {
      return txBuilder.fetchLaunch(launch);
    }

    async function fetchContribution(launch: anchor.web3.PublicKey, contributor: anchor.web3.PublicKey) {
      return txBuilder.fetchContribution(launch, contributor);
    }

    async function fetchProjectCounter() {
      return txBuilder.fetchProjectCounter();
    }

    async function getRaydiumPoolByProjectId(projectId: number | BN): Promise<anchor.web3.PublicKey | null> {
      const [launch] = getLaunchPdaByProjectId(projectId);
      const { data: launchState } = await txBuilder.fetchLaunch(launch);
      return txBuilder.extractPoolState(launchState);
    }

    async function getNextProjectId(): Promise<BN> {
      const { data: counter } = await fetchProjectCounter();
      return counter.value;
    }

    // Get all launch states (projects) from the blockchain
    async function fetchAllProjects() {
      try {
        console.log("Fetching all launch states from blockchain...");
        const allLaunchStates = await program.account.launchState.all();
        console.log(`Found ${allLaunchStates.length} launch states`);

        const projects = allLaunchStates
          .map((account) => {
            const projectId = account.account.projectId.toNumber();
            console.log(
              `Project #${projectId}: Launch PDA = ${account.publicKey.toString()}`
            );
            return {
              projectId,
              launchPda: account.publicKey,
              account: account.account,
            };
          })
          .sort((a, b) => a.projectId - b.projectId);

        console.log(
          `Sorted projects:`,
          projects.map((p) => `#${p.projectId}`)
        );
        return projects;
      } catch (error) {
        console.error("Error fetching all projects:", error);
        return [];
      }
    }

    // Fetch projects created by a specific creator (on-chain memcmp filter)
    async function fetchProjectsByCreator(creator: anchor.web3.PublicKey) {
      try {
        const filters = [
          {
            memcmp: {
              // 8 (discriminator) + 8 (created_at) + 8 (project_id) = 24
              offset: 24,
              bytes: creator.toBase58(),
            },
          },
        ];
        const accounts = await program.account.launchState.all(filters as any);
        return accounts
          .map((a) => ({
            projectId: a.account.projectId.toNumber(),
            launchPda: a.publicKey,
            account: a.account,
          }))
          .sort((a, b) => a.projectId - b.projectId);
      } catch (error) {
        console.error("Error fetching projects by creator:", error);
        return [];
      }
    }

    // Find project by project ID
    async function findProjectById(projectId: number) {
      try {
        const allProjects = await fetchAllProjects();
        return (
          allProjects.find((project) => project.projectId === projectId) || null
        );
      } catch (error) {
        console.error("Error finding project by ID:", error);
        return null;
      }
    }

    // Get project by launch PDA
    async function getProjectByLaunchPda(launchPda: anchor.web3.PublicKey) {
      try {
        const { data: launchData } = await fetchLaunch(launchPda);
        return {
          projectId: launchData.projectId.toNumber(),
          launchPda,
          account: launchData,
        };
      } catch (error) {
        console.error("Error getting project by launch PDA:", error);
        return null;
      }
    }

    // =============================
    //        HIGH-LEVEL flows
    // =============================

    function countWinningInRanges(
      ranges: Array<{ start: BN; end: BN }>,
      winnersData: Buffer
    ): number {
      let count = 0;
      for (const range of ranges) {
        const start = range.start.toNumber();
        const end = range.end.toNumber();
        for (let i = start; i < end; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitIndex = i % 8;
          if (byteIndex < winnersData.length) {
            if ((winnersData[byteIndex] & (1 << bitIndex)) !== 0) {
              count++;
            }
          }
        }
      }
      return count;
    }

    function extractTokensPerTicket(phase: any): BN {
      if (phase.finalized) {
        return phase.finalized.tokensPerTicket;
      }
      return new BN(0);
    }

    async function getVestingConfig(params: {
      launch: anchor.web3.PublicKey;
      participant: anchor.web3.PublicKey;
      bucket: number;
    }): Promise<{
      allocation: BN;
      durationSec: BN;
      periodSec: BN;
      claimed: BN;
    }> {
      const { data: launchState } = await txBuilder.fetchLaunch(params.launch);
      const { data: preset } = await txBuilder.fetchLaunchPresetByAddress(launchState.preset);
      const isCreator = params.participant.equals(launchState.creator);
      const claimed = await txBuilder.fetchTicketsClaimed(params.launch, params.bucket, params.participant);

      if (params.bucket === 1) {
        if (!isCreator) {
          throw new Error("Only creator can access Team bucket");
        }
        const teamAllocation = new BN(preset.baseTotalAllocation)
          .mul(new BN(preset.teamAllocationBasisPoints))
          .div(new BN(10_000));
        return {
          allocation: teamAllocation,
          durationSec: preset.teamDurationSec,
          periodSec: preset.teamPeriodSec,
          claimed,
        };
      }

      const { data: contribution } = await txBuilder.fetchContribution(params.launch, params.participant);
      const winnersData = await txBuilder.fetchWinnersBitmap(params.launch);

      const tokensPerTicket = extractTokensPerTicket(launchState.phase);
      const winningTickets = countWinningInRanges(contribution.ticketRanges, winnersData);
      let allocation = new BN(winningTickets).mul(new BN(tokensPerTicket));

      // If bits are cleared (winningTickets == 0) but user has claimed, use claimed as allocation
      // This happens after full claim when contract clears winner bits (claim.rs:136-140)
      if (winningTickets === 0 && claimed.gt(new BN(0))) {
        allocation = claimed;
      }

      return isCreator
        ? (() => {
            const deposit = new BN(winningTickets).mul(preset.tauLamports);
            const periods = BN.max(deposit.div(preset.creatorPeriodUnlock), new BN(1));
            const duration = periods.mul(preset.creatorPeriodSec);
            return {
              allocation,
              durationSec: duration,
              periodSec: preset.creatorPeriodSec,
              claimed,
            };
          })()
        : {
            allocation,
            durationSec: preset.contributorDurationSec,
            periodSec: preset.contributorPeriodSec,
            claimed,
          };
    }

    /** Returns all PDAs for a given projectId. Convenient for initialization. */
    function deriveAllPdasByProjectId(projectId: number | BN) {
      const [launch] = getLaunchPdaByProjectId(projectId);
      const [escrow] = getEscrowPda(launch);
      const [lotteryControl] = txBuilder.getLotteryControlPda(launch);
      const [winnersBitmap] = txBuilder.getWinnersBitmapPda(launch);
      const [inactiveBitmap] = txBuilder.getInactiveBitmapPda(launch);
      const [mintAuth] = getMintAuthPda(launch);
      const [projectCounter] = getProjectCounterPda();
      return { launch, escrow, lotteryControl, winnersBitmap, inactiveBitmap, mintAuth, projectCounter };
    }

    // ---- Returned API ----
    return {
      idl,
      program,

      // PDAs
      getLaunchPda,
      getLaunchPdaByProjectId,
      getEscrowPda,
      getEscrowAuthorityPda,
      getContributionPda,
      getLotteryControlPda: txBuilder.getLotteryControlPda.bind(txBuilder),
      getWinnersBitmapPda: txBuilder.getWinnersBitmapPda.bind(txBuilder),
      getInactiveBitmapPda: txBuilder.getInactiveBitmapPda.bind(txBuilder),
      getTicketsClaimedPda,
      getUserContributionPda,
      getMintAuthPda,
      getProjectCounterPda,
      getLaunchPresetPda,
      getReallocFundsPda: txBuilder.getReallocFundsPda.bind(txBuilder),
      deriveAllPdas: deriveAllPdasByProjectId,

      // Utils
      getUserAta,
      buildCreateAtaIx,

      // Core operations
      setSeed,
      deposit,
      withdraw,
      refund,
      claim,
      closeBitmaps,
      finalizeLottery,
      createClmmPool,
      addClmmLiquidity,
      getLiquidityRange,
      getSqrtPriceLowerX64ForPool,
      estimateQuoteForBase,
      initLaunch,
      initLaunchPreset,

      // Tx/Ix builders
      setSeedTx: txBuilder.setSeedTx.bind(txBuilder),
      setSeedIx: txBuilder.setSeedIx.bind(txBuilder),
      depositTx: txBuilder.depositTx.bind(txBuilder),
      depositIx: txBuilder.depositIx.bind(txBuilder),
      withdrawTx: txBuilder.withdrawTx.bind(txBuilder),
      withdrawIx: txBuilder.withdrawIx.bind(txBuilder),
      refundTx: txBuilder.refundTx.bind(txBuilder),
      refundIx: txBuilder.refundIx.bind(txBuilder),
      claimTx: txBuilder.claimTx.bind(txBuilder),
      claimIx: txBuilder.claimIx.bind(txBuilder),
      claimRefundTx: txBuilder.claimRefundTx.bind(txBuilder),
      claimRefundIx: txBuilder.claimRefundIx.bind(txBuilder),
      closeBitmapsTx: txBuilder.closeBitmapsTx.bind(txBuilder),
      closeBitmapsIx: txBuilder.closeBitmapsIx.bind(txBuilder),
      createClmmPoolTx: txBuilder.createClmmPoolTx.bind(txBuilder),
      finalizeLotteryTx: txBuilder.finalizeLotteryTx.bind(txBuilder),
      addClmmLiquidityTx: txBuilder.addClmmLiquidityTx.bind(txBuilder),
      addClmmLiquidityIx: txBuilder.addClmmLiquidityIx.bind(txBuilder),

      // Fetch helpers
      fetchEngineConfig,
      fetchLaunch,
      fetchContribution,
      fetchProjectCounter,
      getRaydiumPoolByProjectId,
      getNextProjectId,
      fetchAllProjects,
      fetchProjectsByCreator,
      findProjectById,
      getProjectByLaunchPda,

      // Raydium helpers
      getConfigPda: txBuilder.getConfigPda.bind(txBuilder),
      getAmmConfigIndex: txBuilder.getAmmConfigIndex.bind(txBuilder),
      getRaydiumClmmProgramId: txBuilder.getRaydiumClmmProgramId.bind(txBuilder),
      getRaydiumAmmConfigPda: txBuilder.getRaydiumAmmConfigPda.bind(txBuilder),
      getRaydiumPoolPda: txBuilder.getRaydiumPoolPda.bind(txBuilder),
      getRaydiumPoolVaultPda: txBuilder.getRaydiumPoolVaultPda.bind(txBuilder),
      getRaydiumObservationStatePda: txBuilder.getRaydiumObservationStatePda.bind(txBuilder),
      getAssociatedTokenAddress: txBuilder.getAssociatedTokenAddress.bind(txBuilder),

      // Config
      initEngineConfig,
      initEngineConfigIx: txBuilder.initEngineConfigIx.bind(txBuilder),

      // Preset Ix builders
      initLaunchPresetIx: txBuilder.initLaunchPresetIx.bind(txBuilder),
      initLaunchIx: txBuilder.initLaunchIx.bind(txBuilder),

      // Additional fetch helpers
      fetchLaunchPreset: txBuilder.fetchLaunchPreset.bind(txBuilder),
      fetchLaunchPresetByAddress: txBuilder.fetchLaunchPresetByAddress.bind(txBuilder),
      fetchTicketsClaimed: txBuilder.fetchTicketsClaimed.bind(txBuilder),
      fetchWinnersBitmap: txBuilder.fetchWinnersBitmap.bind(txBuilder),

      // Extract helpers
      extractBaseMint: txBuilder.extractBaseMint.bind(txBuilder),
      extractPoolState: txBuilder.extractPoolState.bind(txBuilder),

      // Vesting helpers
      getVestingConfig,
    };
  },
};

export default EngineSDK;
export { EngineSDK };
export type { EngineIDL };
export type EngineClient = ReturnType<typeof EngineSDK.create>;
