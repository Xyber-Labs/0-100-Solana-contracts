import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, } from "@solana/spl-token";
// Import IDL as a dynamic import to avoid require
let idl;
const loadIdl = async () => {
    if (!idl) {
        const idlModule = await import("../idl/engine.json");
        idl = idlModule.default;
    }
    return idl;
};
// Program ID from declare_id! in Rust
export const ENGINE_PROGRAM_ID = new PublicKey("HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb");
export default {
    idlJson: null, // Will be loaded dynamically
    loadIdl,
    idlType: null, // type‑only reference
    /**
     * Creates an SDK on top of an already configured anchor.Program.
     * @param provider Anchor provider (payer = admin/user)
     * @param program Program<EngineIDL> on ENGINE_PROGRAM_ID
     */
    create(provider, program) {
        const payer = provider.publicKey;
        // -------------- PDA helpers --------------
        function getLaunchPda(saleMint) {
            return PublicKey.findProgramAddressSync([Buffer.from("launch"), saleMint.toBuffer()], program.programId);
        }
        function getEscrowPda(launch) {
            return PublicKey.findProgramAddressSync([Buffer.from("escrow"), launch.toBuffer()], program.programId);
        }
        function getRosterPda(launch) {
            return PublicKey.findProgramAddressSync([Buffer.from("roster"), launch.toBuffer()], program.programId);
        }
        function getSelectionPda(launch) {
            return PublicKey.findProgramAddressSync([Buffer.from("selection"), launch.toBuffer()], program.programId);
        }
        function getUserContributionPda(launch, user) {
            return PublicKey.findProgramAddressSync([Buffer.from("user"), launch.toBuffer(), user.toBuffer()], program.programId);
        }
        function getMintAuthPda(launch) {
            return PublicKey.findProgramAddressSync([Buffer.from("mint_auth"), launch.toBuffer()], program.programId);
        }
        // -------------- Utility --------------
        function ensure32Bytes(seed) {
            const buf = Buffer.from(seed);
            if (buf.length !== 32)
                throw new Error("seed must be 32 bytes");
            return buf;
        }
        function getUserAta(mint, owner) {
            return getAssociatedTokenAddressSync(mint, owner, true);
        }
        function buildCreateAtaIx(args) {
            const ata = getUserAta(args.mint, args.owner);
            const ix = createAssociatedTokenAccountInstruction(args.payer, ata, args.owner, args.mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
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
        async function initLaunch(args) {
            const [launchPda] = getLaunchPda(args.saleMint);
            const [escrowPda] = getEscrowPda(launchPda);
            const rpc = program.methods
                .initLaunch(args.hardCapLamports, args.minRaiseLamports, args.perWalletCap, args.tauLamports, args.saleAllocation, args.lpAllocation)
                .accountsStrict({
                admin: payer,
                launchState: launchPda,
                saleMint: args.saleMint,
                escrow: escrowPda,
                systemProgram: SystemProgram.programId,
            });
            if (args.preInstructions && args.preInstructions.length) {
                rpc.preInstructions(args.preInstructions);
            }
            if (args.signers && args.signers.length) {
                rpc.signers(args.signers);
            }
            const signature = await rpc.rpc();
            return { launchPda, escrowPda, signature };
        }
        async function initRoster(args) {
            const [rosterPda] = getRosterPda(args.launch);
            const rpc = program.methods
                .initRoster()
                .accountsStrict({
                admin: payer,
                launchState: args.launch,
                roster: rosterPda,
                systemProgram: SystemProgram.programId,
            });
            if (args.signers && args.signers.length)
                rpc.signers(args.signers);
            const signature = await rpc.rpc();
            return { rosterPda, signature };
        }
        async function openFunding(args) {
            const rpc = program.methods
                .openFunding()
                .accountsStrict({ admin: payer, launchState: args.launch });
            if (args.signers && args.signers.length)
                rpc.signers(args.signers);
            return { signature: await rpc.rpc() };
        }
        async function closeDeposits(args) {
            const roster = args.roster ?? getRosterPda(args.launch)[0];
            const rpc = program.methods
                .closeDeposits()
                .accountsStrict({
                admin: payer,
                launchState: args.launch,
                roster,
                launch: args.launch,
            });
            if (args.signers && args.signers.length)
                rpc.signers(args.signers);
            return { signature: await rpc.rpc() };
        }
        async function setSeed(args) {
            const [selectionPda] = getSelectionPda(args.launch);
            const seed32 = ensure32Bytes(args.seed);
            const rpc = program.methods
                // @ts-ignore – Anchor генерит u8[32]
                .setSeed(seed32)
                .accountsStrict({
                admin: payer,
                launchState: args.launch,
                selectionState: selectionPda,
                systemProgram: SystemProgram.programId,
            });
            if (args.signers && args.signers.length)
                rpc.signers(args.signers);
            return { selectionPda, signature: await rpc.rpc() };
        }
        async function processBatch(args) {
            const roster = args.roster ?? getRosterPda(args.launch)[0];
            const selection = args.selection ?? getSelectionPda(args.launch)[0];
            const signature = await program.methods
                .processBatch(args.maxItems)
                .accountsStrict({ selectionState: selection, launchState: args.launch, roster })
                .rpc();
            return { signature };
        }
        async function finalizeSelection(args) {
            const selection = args.selection ?? getSelectionPda(args.launch)[0];
            const signature = await program.methods
                .finalizeSelection()
                .accountsStrict({ selectionState: selection, launchState: args.launch })
                .rpc();
            return { signature };
        }
        async function openClaims(args) {
            const signature = await program.methods
                .openClaims()
                .accountsStrict({ admin: payer, launchState: args.launch })
                .rpc();
            return { signature };
        }
        async function deposit(args) {
            const userPubkey = args.userKeypair?.publicKey ?? payer;
            const [userPda] = getUserContributionPda(args.launch, userPubkey);
            const roster = args.roster ?? getRosterPda(args.launch)[0];
            const escrow = args.escrow ?? getEscrowPda(args.launch)[0];
            const rpc = program.methods
                .deposit(args.amountLamports)
                .accountsStrict({
                user: userPubkey,
                launchState: args.launch,
                userContribution: userPda,
                roster,
                escrow,
                launch: args.launch,
                systemProgram: SystemProgram.programId,
            });
            if (args.userKeypair)
                rpc.signers([args.userKeypair]);
            const signature = await rpc.rpc();
            return { userPda, signature };
        }
        async function withdraw(args) {
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
            if (args.userKeypair)
                rpc.signers([args.userKeypair]);
            return { signature: await rpc.rpc() };
        }
        async function claimRefund(args) {
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
            if (args.userKeypair)
                rpc.signers([args.userKeypair]);
            return { signature: await rpc.rpc() };
        }
        /**
         * Important:
         * 1) saleMint must have mintAuthority = PDA ["mint_auth", launch].
         * 2) userAta (user's ATA for saleMint) must exist. If
         *    createAtaIfMissing = true, the SDK will add an ix for creation.
         */
        async function claimTokens(args) {
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
            if (args.userKeypair)
                call.signers([args.userKeypair]);
            const signature = await call.rpc();
            return { signature, userAta };
        }
        // =============================
        //         FETCH helpers
        // =============================
        async function fetchLaunch(launch) {
            return program.account.launchState.fetch(launch);
        }
        async function fetchRoster(launch) {
            const [pda] = getRosterPda(launch);
            return program.account.roster.fetch(pda);
        }
        async function fetchSelection(launch) {
            const [pda] = getSelectionPda(launch);
            return program.account.selectionState.fetch(pda);
        }
        async function fetchUserContribution(launch, user) {
            const [pda] = getUserContributionPda(launch, user);
            return program.account.userContribution.fetch(pda);
        }
        // =============================
        //        HIGH-LEVEL flows
        // =============================
        /** Returns all PDAs for a given saleMint. Convenient for initialization. */
        function deriveAllPdas(saleMint) {
            const [launch] = getLaunchPda(saleMint);
            const [escrow] = getEscrowPda(launch);
            const [roster] = getRosterPda(launch);
            const [selection] = getSelectionPda(launch);
            const [mintAuth] = getMintAuthPda(launch);
            return { launch, escrow, roster, selection, mintAuth };
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
            deriveAllPdas,
            // Utils
            getUserAta,
            buildCreateAtaIx,
            ensure32Bytes,
            // TX
            initLaunch,
            initRoster,
            openFunding,
            closeDeposits,
            setSeed,
            processBatch,
            finalizeSelection,
            openClaims,
            deposit,
            withdraw,
            claimRefund,
            claimTokens,
            // Fetch
            fetchLaunch,
            fetchRoster,
            fetchSelection,
            fetchUserContribution,
        };
    },
};
//# sourceMappingURL=engine.js.map