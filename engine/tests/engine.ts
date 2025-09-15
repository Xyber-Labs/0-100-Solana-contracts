import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Engine } from "../target/types/engine";
import { assert } from "chai";
import {
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("engine", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.engine as Program<Engine>;
  const admin = provider.wallet;

  it("Initializes the launch state", async () => {
    const saleMint = anchor.web3.Keypair.generate();
    const [launchState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), saleMint.publicKey.toBuffer()],
      program.programId
    );
    const escrow = await anchor.web3.PublicKey.createWithSeed(
      launchState,
      "escrow",
      anchor.web3.SystemProgram.programId
    );
    const hardCapLamports = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL);
    const minRaiseLamports = new anchor.BN(10 * anchor.web3.LAMPORTS_PER_SOL);
    const perWalletCap = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const tauLamports = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const saleAllocation = new anchor.BN(1000000);
    const lpAllocation = new anchor.BN(500000);

    await program.methods
      .initLaunch(
        hardCapLamports,
        minRaiseLamports,
        perWalletCap,
        tauLamports,
        saleAllocation,
        lpAllocation
      )
      .accountsStrict({
        admin: admin.publicKey,
        launchState,
        saleMint: saleMint.publicKey,
        escrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin.payer, saleMint])
      .preInstructions([
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: saleMint.publicKey,
          space: 82, // Mint account size
          lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          saleMint.publicKey,
          6,
          admin.publicKey,
          admin.publicKey
        ),
      ])
      .rpc();

    const state = await program.account.launchState.fetch(launchState);

    assert.ok(state.admin.equals(admin.publicKey));
    assert.equal(state.hardCapLamports.toNumber(), hardCapLamports.toNumber());
    assert.equal(state.minRaiseLamports.toNumber(), minRaiseLamports.toNumber());
    assert.equal(state.perWalletCap.toNumber(), perWalletCap.toNumber());
    assert.equal(state.tauLamports.toNumber(), tauLamports.toNumber());
    assert.equal(state.saleAllocation.toNumber(), saleAllocation.toNumber());
    assert.equal(state.lpAllocation.toNumber(), lpAllocation.toNumber());
    assert.isFalse(state.fundingOpen);
    assert.isFalse(state.depositsClosed);
    assert.equal(state.totalDeposited.toNumber(), 0);
    assert.equal(state.totalTickets, 0);
    assert.equal(state.kCapacity, 0);
    assert.isFalse(state.selectionFinalized);
    assert.equal(state.selectionProcessed, 0);
    assert.isNull(state.thresholdScore);
    assert.isNull(state.vrfSeed);
    assert.isFalse(state.claimsOpen);
    assert.isNull(state.tokensPerTicket);
    assert.ok(state.saleMint.equals(saleMint.publicKey));
  });
});
