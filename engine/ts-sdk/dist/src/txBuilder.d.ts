import { Program, BN } from "@coral-xyz/anchor";
import { Transaction, TransactionInstruction, Keypair, PublicKey } from "@solana/web3.js";
import { Engine as EngineIDL } from "../idl/engine";
export declare class TxBuilder {
    private program;
    constructor(program: Program<EngineIDL>);
    getPda(seeds: (string | Buffer | PublicKey)[]): [PublicKey, number];
    initLaunchIx(params: {
        admin: PublicKey;
        saleMint: PublicKey;
        hardCapLamports: BN;
        minRaiseLamports: BN;
        perWalletCap: BN;
        tauLamports: BN;
        saleAllocation: BN;
        lpAllocation: BN;
        fundingDurationDays: number;
    }): Promise<{
        instruction: TransactionInstruction;
        launchState: PublicKey;
        escrow: PublicKey;
        projectCounter: PublicKey;
    }>;
    initLaunchTx(params: {
        admin: PublicKey;
        saleMint: Keypair;
        hardCapLamports: BN;
        minRaiseLamports: BN;
        perWalletCap: BN;
        tauLamports: BN;
        saleAllocation: BN;
        lpAllocation: BN;
        provider: any;
    }): Promise<{
        transaction: Transaction;
        launchState: PublicKey;
        escrow: PublicKey;
        signers: Keypair[];
    }>;
    initRosterIx(params: {
        launch: PublicKey;
        admin: PublicKey;
    }): Promise<{
        instruction: TransactionInstruction;
        rosterPda: PublicKey;
    }>;
    initRosterTx(params: {
        launch: PublicKey;
        admin: PublicKey;
    }): Promise<{
        transaction: Transaction;
        rosterPda: PublicKey;
    }>;
    setSeedIx(params: {
        launch: PublicKey;
        admin: PublicKey;
    }): Promise<{
        instruction: TransactionInstruction;
        selectionPda: PublicKey;
    }>;
    setSeedTx(params: {
        launch: PublicKey;
        admin: PublicKey;
    }): Promise<{
        transaction: Transaction;
        selectionPda: PublicKey;
    }>;
    depositIx(params: {
        launch: PublicKey;
        user: PublicKey;
        amount: BN;
        roster?: PublicKey;
        escrow?: PublicKey;
    }): Promise<{
        instruction: TransactionInstruction;
        userContribution: PublicKey;
    }>;
    depositTx(params: {
        launch: PublicKey;
        user: PublicKey;
        amount: BN;
        roster?: PublicKey;
        escrow?: PublicKey;
    }): Promise<{
        transaction: Transaction;
        userContribution: PublicKey;
    }>;
    withdrawIx(params: {
        launch: PublicKey;
        user: PublicKey;
        amount: BN;
        roster?: PublicKey;
        escrow?: PublicKey;
    }): Promise<{
        instruction: TransactionInstruction;
        userContribution: PublicKey;
    }>;
    withdrawTx(params: {
        launch: PublicKey;
        user: PublicKey;
        amount: BN;
        roster?: PublicKey;
        escrow?: PublicKey;
    }): Promise<{
        transaction: Transaction;
        userContribution: PublicKey;
    }>;
    private ensure32Bytes;
    fetchLaunch(launch: PublicKey): Promise<{
        projectId: BN;
        admin: PublicKey;
        hardCapLamports: BN;
        minRaiseLamports: BN;
        perWalletCap: BN;
        tauLamports: BN;
        saleMint: PublicKey;
        saleAllocation: BN;
        lpAllocation: BN;
        fundingPeriodEnd: BN;
        totalDeposited: BN;
        totalTickets: number;
        kCapacity: number;
        vrfSeed: number[] | null;
        selectionProcessed: number;
        selectionFinalized: boolean;
        thresholdScore: BN | null;
        claimsOpen: boolean;
        tokensPerTicket: BN | null;
    }>;
    fetchRoster(launch: PublicKey): Promise<{
        launch: PublicKey;
        wallets: PublicKey[];
        counts: number[];
        prefix: number[];
        totalInShard: number;
        shardBase: number;
    }>;
    fetchSelection(launch: PublicKey): Promise<{
        launch: PublicKey;
        vrfSeed: number[];
        processed: number;
        finalized: boolean;
        threshold: BN | null;
        heap: {
            score: BN;
            wallet: PublicKey;
            localJ: number;
        }[];
    }>;
    fetchUserContribution(launch: PublicKey, user: PublicKey): Promise<{
        launch: PublicKey;
        wallet: PublicKey;
        deposited: BN;
        ticketCount: number;
        claimedRefund: boolean;
        claimedTokens: boolean;
    }>;
    fetchProjectCounter(): Promise<{
        nextProjectId: BN;
    }>;
}
//# sourceMappingURL=txBuilder.d.ts.map