import * as anchor from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';

const MEMO_PROGRAM_ID = new anchor.web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export function getRaydiumPoolStatePda(
  ammConfig: anchor.web3.PublicKey,
  quoteMint: anchor.web3.PublicKey,
  baseMint: anchor.web3.PublicKey,
  raydiumProgramId: anchor.web3.PublicKey
): [anchor.web3.PublicKey, number] {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      ammConfig.toBuffer(),
      quoteMint.toBuffer(),
      baseMint.toBuffer(),
    ],
    raydiumProgramId
  );
}

export function getRaydiumObservationPda(
  poolState: anchor.web3.PublicKey,
  raydiumProgramId: anchor.web3.PublicKey
): [anchor.web3.PublicKey, number] {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolState.toBuffer()],
    raydiumProgramId
  );
}

export function getRaydiumVaultPda(
  poolState: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  raydiumProgramId: anchor.web3.PublicKey
): [anchor.web3.PublicKey, number] {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), mint.toBuffer()],
    raydiumProgramId
  );
}

export function getRaydiumTickArrayPda(
  poolState: anchor.web3.PublicKey,
  startTickIndex: number,
  raydiumProgramId: anchor.web3.PublicKey
): [anchor.web3.PublicKey, number] {
  const startTickIndexBuffer = Buffer.alloc(4);
  startTickIndexBuffer.writeInt32LE(startTickIndex, 0);

  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('tick_array'), poolState.toBuffer(), startTickIndexBuffer],
    raydiumProgramId
  );
}

export interface SwapParams {
  trader: anchor.web3.Keypair;
  poolState: anchor.web3.PublicKey;
  ammConfig: anchor.web3.PublicKey;
  observationState: anchor.web3.PublicKey;
  inputMint: anchor.web3.PublicKey;
  outputMint: anchor.web3.PublicKey;
  inputVault: anchor.web3.PublicKey;
  outputVault: anchor.web3.PublicKey;
  amountIn: anchor.BN;
  minAmountOut: anchor.BN;
  raydiumProgramId: anchor.web3.PublicKey;
  provider: any;
}

export async function swapTokens(params: SwapParams): Promise<string> {
  const {
    trader,
    poolState,
    ammConfig,
    observationState,
    inputMint,
    outputMint,
    inputVault,
    outputVault,
    amountIn,
    minAmountOut,
    raydiumProgramId,
    provider,
  } = params;

  const inputTokenProgram = inputMint.equals(new anchor.web3.PublicKey('So11111111111111111111111111111111111111112'))
    ? TOKEN_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  const outputTokenProgram = TOKEN_PROGRAM_ID;

  const traderInputAta = getAssociatedTokenAddressSync(
    inputMint,
    trader.publicKey,
    false,
    inputTokenProgram
  );

  const traderOutputAta = getAssociatedTokenAddressSync(
    outputMint,
    trader.publicKey,
    false,
    outputTokenProgram
  );

  const isWsolInput = inputMint.equals(new anchor.web3.PublicKey('So11111111111111111111111111111111111111112'));

  const tx = new anchor.web3.Transaction();

  if (isWsolInput) {
    const transferIx = anchor.web3.SystemProgram.transfer({
      fromPubkey: trader.publicKey,
      toPubkey: traderInputAta,
      lamports: amountIn.toNumber(),
    });
    tx.add(transferIx);

    const syncIx = createSyncNativeInstruction(traderInputAta, inputTokenProgram);
    tx.add(syncIx);
  }

  const swapDiscriminator = Buffer.from([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]);

  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(BigInt(amountIn.toString()), 0);

  const otherAmountThresholdBuffer = Buffer.alloc(8);
  otherAmountThresholdBuffer.writeBigUInt64LE(BigInt(minAmountOut.toString()), 0);

  const sqrtPriceLimitBuffer = Buffer.alloc(16);
  sqrtPriceLimitBuffer.writeBigUInt64LE(BigInt('0xFFFFFFFFFFFFFFFF'), 0);
  sqrtPriceLimitBuffer.writeBigUInt64LE(BigInt('0xFFFFFFFFFFFFFFFF'), 8);

  const isBaseInputBuffer = Buffer.alloc(1);
  isBaseInputBuffer.writeUInt8(1, 0);

  const data = Buffer.concat([
    swapDiscriminator,
    amountBuffer,
    otherAmountThresholdBuffer,
    sqrtPriceLimitBuffer,
    isBaseInputBuffer,
  ]);

  const [tickArrayLower] = getRaydiumTickArrayPda(poolState, 0, raydiumProgramId);
  const [tickArrayUpper] = getRaydiumTickArrayPda(poolState, 3600, raydiumProgramId);

  const keys = [
    { pubkey: trader.publicKey, isSigner: true, isWritable: false },
    { pubkey: ammConfig, isSigner: false, isWritable: false },
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: traderInputAta, isSigner: false, isWritable: true },
    { pubkey: traderOutputAta, isSigner: false, isWritable: true },
    { pubkey: inputVault, isSigner: false, isWritable: true },
    { pubkey: outputVault, isSigner: false, isWritable: true },
    { pubkey: observationState, isSigner: false, isWritable: true },
    { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: tickArrayLower, isSigner: false, isWritable: true },
    { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
  ];

  const swapIx = new anchor.web3.TransactionInstruction({
    keys,
    programId: raydiumProgramId,
    data,
  });

  tx.add(swapIx);

  const sig = await provider.sendAndConfirm(tx, [trader]);
  return sig;
}

export async function createTraderATAs(
  trader: anchor.web3.Keypair,
  wsolMint: anchor.web3.PublicKey,
  baseMint: anchor.web3.PublicKey,
  provider: any
): Promise<void> {
  const traderWsolAta = getAssociatedTokenAddressSync(
    wsolMint,
    trader.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const traderBaseAta = getAssociatedTokenAddressSync(
    baseMint,
    trader.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const createWsolAtaIx = createAssociatedTokenAccountInstruction(
    trader.publicKey,
    traderWsolAta,
    trader.publicKey,
    wsolMint,
    TOKEN_PROGRAM_ID
  );

  const createBaseAtaIx = createAssociatedTokenAccountInstruction(
    trader.publicKey,
    traderBaseAta,
    trader.publicKey,
    baseMint,
    TOKEN_PROGRAM_ID
  );

  const tx = new anchor.web3.Transaction()
    .add(createWsolAtaIx)
    .add(createBaseAtaIx);

  await provider.sendAndConfirm(tx, [trader]);
}

export async function executeTraderSwaps(
  traders: anchor.web3.Keypair[],
  wsolMint: anchor.web3.PublicKey,
  baseMint: anchor.web3.PublicKey,
  ammConfig: anchor.web3.PublicKey,
  raydiumProgramId: anchor.web3.PublicKey,
  provider: any
): Promise<void> {
  const [poolState] = getRaydiumPoolStatePda(ammConfig, wsolMint, baseMint, raydiumProgramId);
  const [observationState] = getRaydiumObservationPda(poolState, raydiumProgramId);
  const [quoteVault] = getRaydiumVaultPda(poolState, wsolMint, raydiumProgramId);
  const [baseVault] = getRaydiumVaultPda(poolState, baseMint, raydiumProgramId);

  for (let i = 0; i < traders.length; i++) {
    const trader = traders[i];
    console.log(`\n🔄 Trader ${i + 1}:`);

    await createTraderATAs(trader, wsolMint, baseMint, provider);
    console.log(`  ✅ Created ATAs`);

    const swapAmount = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL);

    const buySig = await swapTokens({
      trader,
      poolState,
      ammConfig,
      observationState,
      inputMint: wsolMint,
      outputMint: baseMint,
      inputVault: quoteVault,
      outputVault: baseVault,
      amountIn: swapAmount,
      minAmountOut: new anchor.BN(0),
      raydiumProgramId,
      provider,
    });
    console.log(`  ✅ Buy: ${buySig.substring(0, 8)}...`);

    const sellSig = await swapTokens({
      trader,
      poolState,
      ammConfig,
      observationState,
      inputMint: baseMint,
      outputMint: wsolMint,
      inputVault: baseVault,
      outputVault: quoteVault,
      amountIn: swapAmount,
      minAmountOut: new anchor.BN(0),
      raydiumProgramId,
      provider,
    });
    console.log(`  ✅ Sell: ${sellSig.substring(0, 8)}...`);
  }

  console.log(`\n✅ All ${traders.length} traders completed swaps`);
}

