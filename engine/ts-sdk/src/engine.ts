import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, TransactionInstruction, Transaction } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// ---- IDL ----
// The path may differ in your repo. If you have a re-export of IDL types, adjust the import below.
import type { Engine as EngineIDL } from "../idl/engine";

// Import IDL as a dynamic import to avoid require
let idl: any;
const loadIdl = async () => {
  if (!idl) {
    const idlModule = await import("../idl/engine.json");
    idl = idlModule.default;
  }
  return idl;
};

import { TxBuilder } from "./txBuilder";

// Program ID from declare_id! in Rust
export const ENGINE_PROGRAM_ID = new PublicKey(
    "HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb"
);

export default {
    idlJson: null, // Will be loaded dynamically
    loadIdl,
    idlType: null as unknown as EngineIDL, // type‑only reference

    /**
     * Creates an SDK on top of an already configured anchor.Program.
     * @param provider Anchor provider (payer = admin/user)
     * @param program Program<EngineIDL> on ENGINE_PROGRAM_ID
     */
    create(provider: anchor.Provider, program: Program<EngineIDL>) {
        const payer = provider.publicKey!;
        const txBuilder = new TxBuilder(program);

        // -------------- PDA helpers --------------
        function getLaunchPda(saleMint: PublicKey): [PublicKey, number] {
            return txBuilder.getPda(["launch", saleMint]);
        }

        function getEscrowPda(launch: PublicKey): [PublicKey, number] {
            return txBuilder.getPda(["escrow", launch]);
        }

        function getRosterPda(launch: PublicKey): [PublicKey, number] {
            return txBuilder.getPda(["roster", launch]);
        }

        function getSelectionPda(launch: PublicKey): [PublicKey, number] {
            return txBuilder.getPda(["selection", launch]);
        }

        function getUserContributionPda(
            launch: PublicKey,
            user: PublicKey
        ): [PublicKey, number] {
            return txBuilder.getPda(["user", launch, user]);
        }

        function getMintAuthPda(launch: PublicKey): [PublicKey, number] {
            return txBuilder.getPda(["mint_auth", launch]);
        }

        function getProjectCounterPda(): [PublicKey, number] {
            return txBuilder.getPda(["project_counter"]);
        }

        function getPoolPda(launch: PublicKey): [PublicKey, number] {
            return txBuilder.getPda(["pool", launch]);
        }

        // -------------- Utility --------------
        function getUserAta(mint: PublicKey, owner: PublicKey): PublicKey {
            return getAssociatedTokenAddressSync(mint, owner, true);
        }

        function buildCreateAtaIx(args: {
            payer: PublicKey;
            owner: PublicKey;
            mint: PublicKey;
        }): { ata: PublicKey; ix: TransactionInstruction } {
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

        /**
         * IMPORTANT: For claimTokens to work, the mint authority of saleMint
         * must be PDA ["mint_auth", launch_state]. This can be computed in advance,
         * because launch = PDA(["launch", saleMint]).
         */
        async function initLaunch(args: {
            saleMint: PublicKey;
            hardCapLamports: BN;
            minRaiseLamports: BN;
            perWalletCap: BN;
            tauLamports: BN;
            saleAllocation: BN;
            lpAllocation: BN;
            fundingDurationSec: BN;
            // In tests you can pass preInstructions to create/init mint
            preInstructions?: TransactionInstruction[];
            signers?: Keypair[]; // if payer != provider.wallet
        }): Promise<{ launchPda: PublicKey; escrowPda: PublicKey; signature: string }> {
            const { instruction, launchState, escrow } = await txBuilder.initLaunchIx({
                admin: payer,
                saleMint: args.saleMint,
                hardCapLamports: args.hardCapLamports,
                minRaiseLamports: args.minRaiseLamports,
                perWalletCap: args.perWalletCap,
                tauLamports: args.tauLamports,
                saleAllocation: args.saleAllocation,
                lpAllocation: args.lpAllocation,
                fundingDurationSec: args.fundingDurationSec
            });

            const tx = new Transaction();

            if (args.preInstructions && args.preInstructions.length) {
                tx.add(...args.preInstructions);
            }

            tx.add(instruction);

            const signers = args.signers || [];

            if (!provider.sendAndConfirm) {
                throw new Error("Provider does not support sendAndConfirm");
            }
            const signature = await provider.sendAndConfirm(tx, signers);
            return { launchPda: launchState, escrowPda: escrow, signature };
        }

        async function initRoster(args: {
            launch: PublicKey;
            signers?: Keypair[];
        }): Promise<{ rosterPda: PublicKey; signature: string }> {
            const [rosterPda] = getRosterPda(args.launch);

            const rpc = program.methods
                .initRoster()
                .accountsStrict({
                    admin: payer,
                    launchState: args.launch,
                    roster: rosterPda,
                    systemProgram: SystemProgram.programId,
                });
            if (args.signers && args.signers.length) rpc.signers(args.signers);
            const signature = await rpc.rpc();
            return { rosterPda, signature };
        }



        async function setSeed(args: {
            launch: PublicKey;
            payerKeypair?: Keypair; // if payer is not provider.wallet
        }): Promise<{ selectionPda: PublicKey; signature: string }> {
            const [selectionPda] = getSelectionPda(args.launch);
            const payerPubkey = args.payerKeypair?.publicKey ?? payer;

            const rpc = program.methods
                .setSeed()
                .accountsStrict({
                    payer: payerPubkey,
                    launchState: args.launch,
                    selectionState: selectionPda,
                    slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
                    systemProgram: SystemProgram.programId,
                });
            if (args.payerKeypair) rpc.signers([args.payerKeypair]);
            return { selectionPda, signature: await rpc.rpc() };
        }

        async function processBatch(args: {
            launch: PublicKey;
            maxItems: number; // u16
            roster?: PublicKey;
            selection?: PublicKey;
        }): Promise<{ signature: string }> {
            const roster = args.roster ?? getRosterPda(args.launch)[0];
            const selection = args.selection ?? getSelectionPda(args.launch)[0];
            const signature = await program.methods
                .processBatch(args.maxItems)
                .accountsStrict({ selectionState: selection, launchState: args.launch, roster })
                .rpc();
            return { signature };
        }

        async function finalizeSelection(args: {
            launch: PublicKey;
            selection?: PublicKey;
        }): Promise<{ signature: string }> {
            const selection = args.selection ?? getSelectionPda(args.launch)[0];
            const signature = await program.methods
                .finalizeSelection()
                .accountsStrict({ selectionState: selection, launchState: args.launch })
                .rpc();
            return { signature };
        }

        async function openClaims(args: { launch: PublicKey }): Promise<{ signature: string }> {
            const signature = await program.methods
                .openClaims()
                .accountsStrict({ admin: payer, launchState: args.launch })
                .rpc();
            return { signature };
        }

        async function deposit(args: {
            launch: PublicKey;
            amountLamports: BN;
            userKeypair?: Keypair;
            roster?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ userPda: PublicKey; signature: string }> {
            const userPubkey = args.userKeypair?.publicKey ?? payer;
            const { instruction, userContribution } = await txBuilder.depositIx({
                launch: args.launch,
                user: userPubkey,
                amount: args.amountLamports,
                roster: args.roster,
                escrow: args.escrow,
            });

            const tx = new Transaction().add(instruction);
            const signers = args.userKeypair ? [args.userKeypair] : [];
            if (!provider.sendAndConfirm) {
                throw new Error("Provider does not support sendAndConfirm");
            }
            const signature = await provider.sendAndConfirm(tx, signers);
            return { userPda: userContribution, signature };
        }

        async function withdraw(args: {
            launch: PublicKey;
            amountLamports: BN;
            userKeypair?: Keypair;
            roster?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ signature: string }> {
            const userPubkey = args.userKeypair?.publicKey ?? payer;
            const [userPda] = getUserContributionPda(args.launch, userPubkey);
            const roster = args.roster ?? getRosterPda(args.launch)[0];
            const escrow = args.escrow ?? getEscrowPda(args.launch)[0];

            const rpc = program.methods
                .withdraw(args.amountLamports)
                .accountsStrict({
                    user: userPubkey,
                    launchState: args.launch,
                    userContribution: userPda,
                    roster,
                    escrow,
                    launch: args.launch,
                    systemProgram: SystemProgram.programId,
                });
            if (args.userKeypair) rpc.signers([args.userKeypair]);
            return { signature: await rpc.rpc() };
        }

        async function withdrawTx(args: {
            launch: PublicKey;
            amountLamports: BN;
            userPubkey?: PublicKey;
            roster?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ transaction: Transaction; userContribution: PublicKey }> {
            const user = args.userPubkey ?? payer;
            return txBuilder.withdrawTx({
                launch: args.launch,
                user,
                amount: args.amountLamports,
                roster: args.roster,
                escrow: args.escrow,
            });
        }

        async function withdrawIx(args: {
            launch: PublicKey;
            amountLamports: BN;
            userPubkey?: PublicKey;
            roster?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ instruction: TransactionInstruction; userContribution: PublicKey }> {
            const user = args.userPubkey ?? payer;
            return txBuilder.withdrawIx({
                launch: args.launch,
                user,
                amount: args.amountLamports,
                roster: args.roster,
                escrow: args.escrow,
            });
        }

        async function depositTx(args: {
            launch: PublicKey;
            amountLamports: BN;
            userPubkey?: PublicKey;
            roster?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ transaction: Transaction; userContribution: PublicKey }> {
            const user = args.userPubkey ?? payer;
            return txBuilder.depositTx({
                launch: args.launch,
                user,
                amount: args.amountLamports,
                roster: args.roster,
                escrow: args.escrow,
            });
        }

        async function depositIx(args: {
            launch: PublicKey;
            amountLamports: BN;
            userPubkey?: PublicKey;
            roster?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ instruction: TransactionInstruction; userContribution: PublicKey }> {
            const user = args.userPubkey ?? payer;
            return txBuilder.depositIx({
                launch: args.launch,
                user,
                amount: args.amountLamports,
                roster: args.roster,
                escrow: args.escrow,
            });
        }

        async function claimRefund(args: {
            launch: PublicKey;
            userKeypair?: Keypair;
            selection?: PublicKey;
            escrow?: PublicKey;
        }): Promise<{ signature: string }> {
            const userPubkey = args.userKeypair?.publicKey ?? payer;
            const [userPda] = getUserContributionPda(args.launch, userPubkey);
            const selection = args.selection ?? getSelectionPda(args.launch)[0];
            const escrow = args.escrow ?? getEscrowPda(args.launch)[0];

            const rpc = program.methods
                .claimRefund()
                .accountsStrict({
                    user: userPubkey,
                    launchState: args.launch,
                    userContribution: userPda,
                    selectionState: selection,
                    escrow,
                });
            if (args.userKeypair) rpc.signers([args.userKeypair]);
            return { signature: await rpc.rpc() };
        }

        /**
         * Important:
         * 1) saleMint must have mintAuthority = PDA ["mint_auth", launch].
         * 2) userAta (user's ATA for saleMint) must exist. If
         *    createAtaIfMissing = true, the SDK will add an ix for creation.
         */
        async function createPool(args: {
            launch: PublicKey;
            payerKeypair?: Keypair;
            useTestMode?: boolean;
        }): Promise<{ signature: string }> {
            const payerPubkey = args.payerKeypair?.publicKey ?? payer;
            const [poolState] = getPoolPda(args.launch);
            const [projectCounter] = getProjectCounterPda();

            // SlotHashes sysvar
            const SLOT_HASHES_SYSVAR = new PublicKey("SysvarS1otHashes111111111111111111111111111");

            // For now, always use createPool since createPoolTest is only available with test feature
            const rpc = program.methods.createPool()
                .accountsStrict({
                    payer: payerPubkey,
                    launchState: args.launch,
                    poolState,
                    projectCounter,
                    slotHashes: SLOT_HASHES_SYSVAR,
                    systemProgram: SystemProgram.programId,
                });
            if (args.payerKeypair) rpc.signers([args.payerKeypair]);
            return { signature: await rpc.rpc() };
        }

        async function createClmmPool(args: {
            launch: PublicKey;
            tokenMint?: Keypair;
        }): Promise<{
            signature: string;
            tokenMint: PublicKey;
            poolTokenAta: PublicKey;
        }> {
            const tokenMint = args.tokenMint ?? Keypair.generate();

            const result = await txBuilder.createClmmPoolTx({
                payer,
                launch: args.launch,
                tokenMint,
                provider,
            });

            if (!provider.sendAndConfirm) {
                throw new Error("Provider does not support sendAndConfirm");
            }
            const signature = await provider.sendAndConfirm(result.transaction, result.signers);
            return {
                signature,
                tokenMint: result.tokenMint,
                poolTokenAta: result.poolTokenAta,
            };
        }

        async function claimTokens(args: {
            launch: PublicKey;
            saleMint: PublicKey;
            userKeypair?: Keypair;
            selection?: PublicKey;
            userAta?: PublicKey;
            createAtaIfMissing?: boolean;
        }): Promise<{ signature: string; userAta: PublicKey }> {
            const userPubkey = args.userKeypair?.publicKey ?? payer;
            const [userPda] = getUserContributionPda(args.launch, userPubkey);
            const selection = args.selection ?? getSelectionPda(args.launch)[0];
            const [mintAuth] = getMintAuthPda(args.launch);
            const userAta = args.userAta ?? getUserAta(args.saleMint, userPubkey);

            const call = program.methods
                .claimTokens()
                .accountsStrict({
                    user: userPubkey,
                    launchState: args.launch,
                    userContribution: userPda,
                    selectionState: selection,
                    saleMint: args.saleMint,
                    mintAuth,
                    userAta,
                    tokenProgram: TOKEN_PROGRAM_ID,
                });

            // (optional) create ATA in a transaction before calling the method
            if (args.createAtaIfMissing) {
                const { ix } = buildCreateAtaIx({ payer, owner: userPubkey, mint: args.saleMint });
                call.preInstructions([ix]);
            }

            if (args.userKeypair) call.signers([args.userKeypair]);
            const signature = await call.rpc();
            return { signature, userAta };
        }

        // =============================
        //         FETCH helpers
        // =============================

        async function fetchLaunch(launch: PublicKey) {
            return txBuilder.fetchLaunch(launch);
        }

        async function fetchRoster(launch: PublicKey) {
            return txBuilder.fetchRoster(launch);
        }

        async function fetchSelection(launch: PublicKey) {
            return txBuilder.fetchSelection(launch);
        }

        async function fetchUserContribution(launch: PublicKey, user: PublicKey) {
            return txBuilder.fetchUserContribution(launch, user);
        }

        async function fetchProjectCounter() {
            return txBuilder.fetchProjectCounter();
        }

        async function fetchPoolState(launch: PublicKey) {
            const [pda] = getPoolPda(launch);
            return program.account.poolState.fetch(pda);
        }

        // Get all launch states (projects) from the blockchain
        async function fetchAllProjects() {
            try {
                console.log('Fetching all launch states from blockchain...');
                const allLaunchStates = await program.account.launchState.all();
                console.log(`Found ${allLaunchStates.length} launch states`);
                
                const projects = allLaunchStates.map(account => {
                    const projectId = account.account.projectId.toNumber();
                    console.log(`Project #${projectId}: Launch PDA = ${account.publicKey.toString()}`);
                    return {
                        projectId,
                        launchPda: account.publicKey,
                        account: account.account,
                        // Try to derive sale mint from launch PDA
                        saleMint: account.account.saleMint
                    };
                }).sort((a, b) => a.projectId - b.projectId);
                
                console.log(`Sorted projects:`, projects.map(p => `#${p.projectId}`));
                return projects;
            } catch (error) {
                console.error('Error fetching all projects:', error);
                return [];
            }
        }

        // Find project by project ID
        async function findProjectById(projectId: number) {
            try {
                const allProjects = await fetchAllProjects();
                return allProjects.find(project => project.projectId === projectId) || null;
            } catch (error) {
                console.error('Error finding project by ID:', error);
                return null;
            }
        }

        // Get project by launch PDA
        async function getProjectByLaunchPda(launchPda: PublicKey) {
            try {
                const launchData = await fetchLaunch(launchPda);
                return {
                    projectId: launchData.projectId.toNumber(),
                    launchPda,
                    account: launchData,
                    saleMint: launchData.saleMint
                };
            } catch (error) {
                console.error('Error getting project by launch PDA:', error);
                return null;
            }
        }

        // =============================
        //        HIGH-LEVEL flows
        // =============================

        /** Returns all PDAs for a given saleMint. Convenient for initialization. */
        function deriveAllPdas(saleMint: PublicKey) {
            const [launch] = getLaunchPda(saleMint);
            const [escrow] = getEscrowPda(launch);
            const [roster] = getRosterPda(launch);
            const [selection] = getSelectionPda(launch);
            const [mintAuth] = getMintAuthPda(launch);
            const [projectCounter] = getProjectCounterPda();
            return { launch, escrow, roster, selection, mintAuth, projectCounter };
        }

        // ---- Returned API ----
        return {
            // IDL
            idl,
            program,

            // PDAs
            getLaunchPda,
            getEscrowPda,
            getRosterPda,
            getSelectionPda,
            getUserContributionPda,
            getMintAuthPda,
            getProjectCounterPda,
            getPoolPda,
            deriveAllPdas,

            // Utils
            getUserAta,
            buildCreateAtaIx,

            initLaunch,
            initRoster,
            setSeed,
            processBatch,
            finalizeSelection,
            openClaims,
            deposit,
            withdraw,
            claimRefund,
            claimTokens,
            createPool,
            createClmmPool,

            initLaunchTx: txBuilder.initLaunchTx.bind(txBuilder),
            initLaunchIx: txBuilder.initLaunchIx.bind(txBuilder),
            initRosterTx: txBuilder.initRosterTx.bind(txBuilder),
            initRosterIx: txBuilder.initRosterIx.bind(txBuilder),
            setSeedTx: txBuilder.setSeedTx.bind(txBuilder),
            setSeedIx: txBuilder.setSeedIx.bind(txBuilder),
            depositTx,
            depositIx,
            withdrawTx,
            withdrawIx,
            createClmmPoolTx: txBuilder.createClmmPoolTx.bind(txBuilder),

            fetchLaunch,
            fetchRoster,
            fetchSelection,
            fetchUserContribution,
            fetchProjectCounter,
            fetchPoolState,
            fetchAllProjects,
            findProjectById,
            getProjectByLaunchPda,
        };
    },
};

export type { EngineIDL };
