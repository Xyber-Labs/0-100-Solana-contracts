import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { PoolUtils, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import type { EngineClient } from "@xyber-labs/0-100-sdk";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

interface RaydiumSwapParams {
  provider: AnchorProvider;
  sdk: EngineClient;
  launchPda: PublicKey;
  baseMint: PublicKey;
  swapsCount?: number;
  solPerSwap?: number;
  addLog: (msg: string) => void;
}

export async function runRaydiumSwaps(params: RaydiumSwapParams): Promise<void> {
  const { provider, sdk, launchPda, baseMint, swapsCount = 10, solPerSwap = 1, addLog } = params;
  const wallet: any = provider.wallet;
  const payerPubkey: PublicKey | undefined = wallet?.publicKey;
  if (!payerPubkey) {
    addLog("   -> Raydium swaps skipped: wallet public key unavailable");
    return;
  }
  if (swapsCount <= 0 || solPerSwap <= 0) {
    addLog("   -> Raydium swaps skipped: invalid swap parameters");
    return;
  }
  const lamportsPerSol = 1_000_000_000;
  const perSwapLamports = Math.floor(solPerSwap * lamportsPerSol);
  const requiredLamports = BigInt(perSwapLamports) * BigInt(swapsCount);
  const currentBalance = await provider.connection.getBalance(payerPubkey);
  if (BigInt(currentBalance) <= requiredLamports) {
    addLog("   -> Raydium swaps skipped: insufficient SOL balance for requested swaps");
    return;
  }
  const swapUser = Keypair.generate();
  try {
    const transferIx = SystemProgram.transfer({
      fromPubkey: payerPubkey,
      toPubkey: swapUser.publicKey,
      lamports: Number(requiredLamports),
    });
    const tx = new Transaction().add(transferIx);
    tx.feePayer = payerPubkey;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    await provider.sendAndConfirm!(tx, []);
    addLog(`   -> Funded Raydium swap user with ${Number(requiredLamports) / lamportsPerSol} SOL`);
  } catch (e: any) {
    addLog(`   -> Raydium swaps skipped: failed to fund swap user: ${String(e?.message || e)}`);
    return;
  }
  let poolState: PublicKey;
  try {
    const [poolPda] = (sdk as any).getRaydiumPoolPda(WSOL_MINT, baseMint);
    poolState = poolPda;
  } catch (e: any) {
    addLog(`   -> Raydium swaps skipped: unable to derive pool PDA: ${String(e?.message || e)}`);
    return;
  }
  const poolInfoAcc = await provider.connection.getAccountInfo(poolState);
  if (!poolInfoAcc) {
    addLog("   -> Raydium swaps skipped: pool state account not found");
    return;
  }
  const raydium = await Raydium.load({
    owner: swapUser,
    connection: provider.connection,
    cluster: "mainnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
  });
  const poolData = await raydium.clmm.getPoolInfoFromRpc(poolState.toString());
  const poolInfo = poolData.poolInfo;
  const poolKeys = poolData.poolKeys;
  const clmmPoolInfo = poolData.computePoolInfo;
  const tickCache = poolData.tickData[poolState.toString()];
  const inputMintStr = WSOL_MINT.toBase58();
  if (inputMintStr !== poolInfo.mintA.address && inputMintStr !== poolInfo.mintB.address) {
    addLog("   -> Raydium swaps skipped: WSOL mint not found in pool");
    return;
  }
  const baseIn = inputMintStr === poolInfo.mintA.address;
  const tokenOut = poolInfo[baseIn ? "mintB" : "mintA"];
  const epochInfo = await raydium.fetchEpochInfo();
  addLog(`   -> Raydium swaps: executing ${swapsCount} swap(s) of ${solPerSwap} SOL each`);
  for (let i = 0; i < swapsCount; i++) {
    const amountIn = new BN(perSwapLamports);
    const { minAmountOut, remainingAccounts } = await PoolUtils.computeAmountOutFormat({
      poolInfo: clmmPoolInfo,
      tickArrayCache: tickCache,
      amountIn,
      tokenOut,
      slippage: 0.01,
      epochInfo,
    });
    const { execute } = await raydium.clmm.swap({
      poolInfo,
      poolKeys,
      inputMint: poolInfo[baseIn ? "mintA" : "mintB"].address,
      amountIn,
      amountOutMin: minAmountOut.amount.raw,
      observationId: clmmPoolInfo.observationId,
      ownerInfo: {
        useSOLBalance: true,
      },
      remainingAccounts,
      txVersion: TxVersion.V0,
    });
    try {
      const result = await execute({ sendAndConfirm: true });
      const txId = typeof result?.txId === "string" ? result.txId : String(result);
      addLog(`   -> Raydium swap ${i + 1}/${swapsCount} confirmed: ${txId}`);
    } catch (e: any) {
      addLog(`   -> Raydium swap ${i + 1}/${swapsCount} failed: ${String(e?.message || e)}`);
      break;
    }
  }
}


