import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, TransactionInstruction } from "@solana/web3.js";
import type { Engine as EngineIDL } from "../idl/engine";
export declare const ENGINE_PROGRAM_ID: anchor.web3.PublicKey;
declare const _default: {
    idlJson: null;
    loadIdl: () => Promise<any>;
    idlType: EngineIDL;
    /**
     * Creates an SDK on top of an already configured anchor.Program.
     * @param provider Anchor provider (payer = admin/user)
     * @param program Program<EngineIDL> on ENGINE_PROGRAM_ID
     */
    create(provider: anchor.Provider, program: Program<EngineIDL>): {
        idl: any;
        program: anchor.Program<EngineIDL>;
        getLaunchPda: (saleMint: PublicKey) => [PublicKey, number];
        getEscrowPda: (launch: PublicKey) => [PublicKey, number];
        getRosterPda: (launch: PublicKey) => [PublicKey, number];
        getSelectionPda: (launch: PublicKey) => [PublicKey, number];
        getUserContributionPda: (launch: PublicKey, user: PublicKey) => [PublicKey, number];
        getMintAuthPda: (launch: PublicKey) => [PublicKey, number];
        getProjectCounterPda: () => [PublicKey, number];
        deriveAllPdas: (saleMint: PublicKey) => {
            launch: anchor.web3.PublicKey;
            escrow: anchor.web3.PublicKey;
            roster: anchor.web3.PublicKey;
            selection: anchor.web3.PublicKey;
            mintAuth: anchor.web3.PublicKey;
            projectCounter: anchor.web3.PublicKey;
        };
        getUserAta: (mint: PublicKey, owner: PublicKey) => PublicKey;
        buildCreateAtaIx: (args: {
            payer: PublicKey;
            owner: PublicKey;
            mint: PublicKey;
        }) => {
            ata: PublicKey;
            ix: TransactionInstruction;
        };
        ensure32Bytes: (seed: Uint8Array | number[] | Buffer) => Buffer;
        initLaunch: (args: {
            saleMint: PublicKey;
            hardCapLamports: BN;
            minRaiseLamports: BN;
            perWalletCap: BN;
            tauLamports: BN;
            saleAllocation: BN;
            lpAllocation: BN;
            fundingDurationDays: number;
            preInstructions?: TransactionInstruction[];
            signers?: Keypair[];
        }) => Promise<{
            launchPda: PublicKey;
            escrowPda: PublicKey;
            signature: string;
        }>;
        initRoster: (args: {
            launch: PublicKey;
            signers?: Keypair[];
        }) => Promise<{
            rosterPda: PublicKey;
            signature: string;
        }>;
        closeDeposits: (args: {
            launch: PublicKey;
            roster?: PublicKey;
            signers?: Keypair[];
        }) => Promise<{
            signature: string;
        }>;
        setSeed: (args: {
            launch: PublicKey;
            seed: Uint8Array | number[] | Buffer;
            signers?: Keypair[];
        }) => Promise<{
            selectionPda: PublicKey;
            signature: string;
        }>;
        processBatch: (args: {
            launch: PublicKey;
            maxItems: number;
            roster?: PublicKey;
            selection?: PublicKey;
        }) => Promise<{
            signature: string;
        }>;
        finalizeSelection: (args: {
            launch: PublicKey;
            selection?: PublicKey;
        }) => Promise<{
            signature: string;
        }>;
        openClaims: (args: {
            launch: PublicKey;
        }) => Promise<{
            signature: string;
        }>;
        deposit: (args: {
            launch: PublicKey;
            amountLamports: BN;
            userKeypair?: Keypair;
            roster?: PublicKey;
            escrow?: PublicKey;
        }) => Promise<{
            userPda: PublicKey;
            signature: string;
        }>;
        withdraw: (args: {
            launch: PublicKey;
            amountLamports: BN;
            userKeypair?: Keypair;
            roster?: PublicKey;
            escrow?: PublicKey;
        }) => Promise<{
            signature: string;
        }>;
        claimRefund: (args: {
            launch: PublicKey;
            userKeypair?: Keypair;
            selection?: PublicKey;
            escrow?: PublicKey;
        }) => Promise<{
            signature: string;
        }>;
        claimTokens: (args: {
            launch: PublicKey;
            saleMint: PublicKey;
            userKeypair?: Keypair;
            selection?: PublicKey;
            userAta?: PublicKey;
            createAtaIfMissing?: boolean;
        }) => Promise<{
            signature: string;
            userAta: PublicKey;
        }>;
        fetchLaunch: (launch: PublicKey) => Promise<{
            projectId: anchor.BN;
            admin: anchor.web3.PublicKey;
            hardCapLamports: anchor.BN;
            minRaiseLamports: anchor.BN;
            perWalletCap: anchor.BN;
            tauLamports: anchor.BN;
            saleMint: anchor.web3.PublicKey;
            saleAllocation: anchor.BN;
            lpAllocation: anchor.BN;
            fundingPeriodEnd: anchor.BN;
            depositsClosed: boolean;
            totalDeposited: anchor.BN;
            totalTickets: number;
            kCapacity: number;
            vrfSeed: number[] | null;
            selectionProcessed: number;
            selectionFinalized: boolean;
            thresholdScore: anchor.BN | null;
            claimsOpen: boolean;
            tokensPerTicket: anchor.BN | null;
        }>;
        fetchRoster: (launch: PublicKey) => Promise<{
            launch: anchor.web3.PublicKey;
            wallets: anchor.web3.PublicKey[];
            counts: number[];
            prefix: number[];
            totalInShard: number;
            shardBase: number;
        }>;
        fetchSelection: (launch: PublicKey) => Promise<{
            launch: anchor.web3.PublicKey;
            vrfSeed: number[];
            processed: number;
            finalized: boolean;
            threshold: anchor.BN | null;
            heap: {
                score: anchor.BN;
                wallet: anchor.web3.PublicKey;
                localJ: number;
            }[];
        }>;
        fetchUserContribution: (launch: PublicKey, user: PublicKey) => Promise<{
            launch: anchor.web3.PublicKey;
            wallet: anchor.web3.PublicKey;
            deposited: anchor.BN;
            ticketCount: number;
            claimedRefund: boolean;
            claimedTokens: boolean;
        }>;
        fetchProjectCounter: () => Promise<{
            nextProjectId: anchor.BN;
        }>;
        fetchAllProjects: () => Promise<{
            projectId: number;
            launchPda: anchor.web3.PublicKey;
            account: {
                projectId: anchor.BN;
                admin: anchor.web3.PublicKey;
                hardCapLamports: anchor.BN;
                minRaiseLamports: anchor.BN;
                perWalletCap: anchor.BN;
                tauLamports: anchor.BN;
                saleMint: anchor.web3.PublicKey;
                saleAllocation: anchor.BN;
                lpAllocation: anchor.BN;
                fundingPeriodEnd: anchor.BN;
                depositsClosed: boolean;
                totalDeposited: anchor.BN;
                totalTickets: number;
                kCapacity: number;
                vrfSeed: number[] | null;
                selectionProcessed: number;
                selectionFinalized: boolean;
                thresholdScore: anchor.BN | null;
                claimsOpen: boolean;
                tokensPerTicket: anchor.BN | null;
            };
            saleMint: anchor.web3.PublicKey;
        }[]>;
        findProjectById: (projectId: number) => Promise<{
            projectId: number;
            launchPda: anchor.web3.PublicKey;
            account: {
                projectId: anchor.BN;
                admin: anchor.web3.PublicKey;
                hardCapLamports: anchor.BN;
                minRaiseLamports: anchor.BN;
                perWalletCap: anchor.BN;
                tauLamports: anchor.BN;
                saleMint: anchor.web3.PublicKey;
                saleAllocation: anchor.BN;
                lpAllocation: anchor.BN;
                fundingPeriodEnd: anchor.BN;
                depositsClosed: boolean;
                totalDeposited: anchor.BN;
                totalTickets: number;
                kCapacity: number;
                vrfSeed: number[] | null;
                selectionProcessed: number;
                selectionFinalized: boolean;
                thresholdScore: anchor.BN | null;
                claimsOpen: boolean;
                tokensPerTicket: anchor.BN | null;
            };
            saleMint: anchor.web3.PublicKey;
        } | null>;
        getProjectByLaunchPda: (launchPda: PublicKey) => Promise<{
            projectId: number;
            launchPda: anchor.web3.PublicKey;
            account: {
                projectId: anchor.BN;
                admin: anchor.web3.PublicKey;
                hardCapLamports: anchor.BN;
                minRaiseLamports: anchor.BN;
                perWalletCap: anchor.BN;
                tauLamports: anchor.BN;
                saleMint: anchor.web3.PublicKey;
                saleAllocation: anchor.BN;
                lpAllocation: anchor.BN;
                fundingPeriodEnd: anchor.BN;
                depositsClosed: boolean;
                totalDeposited: anchor.BN;
                totalTickets: number;
                kCapacity: number;
                vrfSeed: number[] | null;
                selectionProcessed: number;
                selectionFinalized: boolean;
                thresholdScore: anchor.BN | null;
                claimsOpen: boolean;
                tokensPerTicket: anchor.BN | null;
            };
            saleMint: anchor.web3.PublicKey;
        } | null>;
    };
};
export default _default;
export type { EngineIDL };
//# sourceMappingURL=engine.d.ts.map