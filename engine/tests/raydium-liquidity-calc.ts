import * as anchor from '@coral-xyz/anchor';

/**
 * Converts sqrt price X64 to tick
 */
function sqrtPriceX64ToTick(sqrtPriceX64: bigint): number {
  // price = (sqrtPriceX64 / 2^64)^2
  // tick = log_1.0001(price) = log(price) / log(1.0001)

  const sqrtPrice = Number(sqrtPriceX64) / Math.pow(2, 64);
  const price = sqrtPrice * sqrtPrice;
  const tick = Math.log(price) / Math.log(1.0001);

  return Math.floor(tick);
}

/**
 * Calculates sqrt price from tick
 */
function getSqrtPriceX64FromTick(tick: number): bigint {
  const price = Math.pow(1.0001, tick);
  const sqrtPrice = Math.sqrt(price);
  return BigInt(Math.floor(sqrtPrice * Math.pow(2, 64)));
}

/**
 * Raydium's formula: L = amount0 * (sqrt_price_upper * sqrt_price_lower) / (sqrt_price_upper - sqrt_price_lower)
 * When P_lower < P_current < P_upper
 */
function getLiquidityFromAmount0(
  sqrtPriceCurrent: bigint,
  sqrtPriceUpper: bigint,
  amount0: bigint
): bigint {
  const Q64 = 1n << 64n;

  const numerator = (sqrtPriceCurrent * sqrtPriceUpper) / Q64;
  const denominator = sqrtPriceUpper - sqrtPriceCurrent;

  return (amount0 * numerator) / denominator;
}

/**
 * Raydium's formula: L = amount1 / (sqrt_price_current - sqrt_price_lower)
 */
function getLiquidityFromAmount1(
  sqrtPriceLower: bigint,
  sqrtPriceCurrent: bigint,
  amount1: bigint
): bigint {
  const Q64 = 1n << 64n;
  const denominator = sqrtPriceCurrent - sqrtPriceLower;

  return (amount1 * Q64) / denominator;
}

/**
 * Calculates optimal tick range where both tokens are fully utilized
 * Mirrors the on-chain calculation logic from calculate_liquidity_range.rs
 */
export async function calculateOptimalRange(params: {
  poolState: anchor.web3.PublicKey;
  baseAmount: anchor.BN;
  quoteAmount: anchor.BN;
  provider: any;
}): Promise<{
  tickLower: number;
  tickUpper: number;
  tickArrayLowerStartIndex: number;
  tickArrayUpperStartIndex: number;
}> {
  const { poolState, baseAmount, quoteAmount, provider } = params;

  const MIN_TICK = -443636;
  const MAX_TICK = 443636;
  const TICK_SPACING = 60;
  const TICK_ARRAY_SIZE = 60;

  const poolAccountInfo = await provider.connection.getAccountInfo(poolState);
  if (!poolAccountInfo) {
    throw new Error('Pool account not found');
  }

  const data = poolAccountInfo.data;
  const tickCurrent = data.readInt32LE(269);

  const ratio = (quoteAmount.toNumber() * 1_000_000) / baseAmount.toNumber();

  let tickRange: number;
  if (ratio < 500) {
    tickRange = 10000;
  } else if (ratio < 1500) {
    tickRange = 20000;
  } else {
    tickRange = 30000;
  }

  let tickLower = Math.floor((tickCurrent - tickRange) / TICK_SPACING) * TICK_SPACING;
  let tickUpper = Math.floor((tickCurrent + tickRange + TICK_SPACING - 1) / TICK_SPACING) * TICK_SPACING;

  tickLower = Math.max(tickLower, MIN_TICK);
  tickUpper = Math.min(tickUpper, MAX_TICK);

  const ticksInArray = TICK_SPACING * TICK_ARRAY_SIZE;
  const tickArrayLowerStartIndex = Math.floor(tickLower / ticksInArray) * ticksInArray;
  const tickArrayUpperStartIndex = Math.floor(tickUpper / ticksInArray) * ticksInArray;

  console.log(`  Optimal range: [${tickLower}, ${tickUpper}]`);
  console.log(`  Tick arrays: [${tickArrayLowerStartIndex}, ${tickArrayUpperStartIndex}]`);

  return {
    tickLower,
    tickUpper,
    tickArrayLowerStartIndex,
    tickArrayUpperStartIndex,
  };
}

/**
 * Fetches pool state and calculates optimal range
 */
export async function fetchPoolAndCalculateRange(
  poolState: anchor.web3.PublicKey,
  baseAmount: anchor.BN,
  quoteAmount: anchor.BN,
  provider: any
): Promise<{
  tickLower: number;
  tickUpper: number;
  tickArrayLowerStartIndex: number;
  tickArrayUpperStartIndex: number;
  currentTick: number;
  sqrtPriceX64: string;
}> {
  const poolAccountInfo = await provider.connection.getAccountInfo(poolState);
  if (!poolAccountInfo) {
    throw new Error('Pool account not found');
  }

  const data = poolAccountInfo.data;
  const tickSpacing = 60;

  const sqrtPriceX64Low = data.readBigUInt64LE(253);
  const sqrtPriceX64High = data.readBigUInt64LE(261);
  const sqrtPriceX64 = (sqrtPriceX64High << 64n) | sqrtPriceX64Low;
  const currentTick = data.readInt32LE(269);

  console.log('Pool state:');
  console.log('  Current tick:', currentTick);
  console.log('  Tick spacing:', tickSpacing);
  console.log('  Sqrt price X64:', sqrtPriceX64.toString());

  const range = await calculateOptimalRange({
    poolState,
    baseAmount,
    quoteAmount,
    provider,
  });

  return {
    ...range,
    currentTick,
    sqrtPriceX64: sqrtPriceX64.toString(),
  };
}

/**
 * Verifies position amounts match expected with fee tolerance
 */
export function verifyPositionAmounts(params: {
  actualBase: anchor.BN;
  actualQuote: anchor.BN;
  expectedBase: anchor.BN;
  expectedQuote: anchor.BN;
  feeTolerancePercent: number;  // e.g., 1 for 1%
}): { baseMatches: boolean; quoteMatches: boolean; baseError: string; quoteError: string } {
  const { actualBase, actualQuote, expectedBase, expectedQuote, feeTolerancePercent } = params;

  const baseTolerance = expectedBase.muln(feeTolerancePercent).divn(100);
  const quoteTolerance = expectedQuote.muln(feeTolerancePercent).divn(100);

  const baseLower = expectedBase.sub(baseTolerance);
  const baseUpper = expectedBase.add(baseTolerance);
  const quoteLower = expectedQuote.sub(quoteTolerance);
  const quoteUpper = expectedQuote.add(quoteTolerance);

  const baseMatches = actualBase.gte(baseLower) && actualBase.lte(baseUpper);
  const quoteMatches = actualQuote.gte(quoteLower) && actualQuote.lte(quoteUpper);

  const baseError = baseMatches
    ? ''
    : `Base amount ${actualBase.toString()} outside range [${baseLower.toString()}, ${baseUpper.toString()}]`;
  const quoteError = quoteMatches
    ? ''
    : `Quote amount ${actualQuote.toString()} outside range [${quoteLower.toString()}, ${quoteUpper.toString()}]`;

  return { baseMatches, quoteMatches, baseError, quoteError };
}
