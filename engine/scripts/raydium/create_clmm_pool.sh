#!/usr/bin/env bash
set -euo pipefail

ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
ANCHOR_WALLET=$HOME/.config/solana/id.json

# AMM_CONFIG="CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu" # devnet
AMM_CONFIG="2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv" # mainnet
QUOTE_MINT="So11111111111111111111111111111111111111112"
# CLMM_PROGRAM="DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" # devnet
CLMM_PROGRAM="CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK" # mainnet
AIRDROP="700"
BASE_DECIMALS="6"
MINT_AMOUNT="600000000"
TICK_SPACING="60"
FEE_RATE_BPS="2500"
# Use fraction below (QUOTE/BASE in human units). Leave INIT_PRICE at 0 to enable fraction.
INIT_PRICE="0"
# Toggles: set to 1 to enable
DO_LIQUIDITY="1"
DO_SWAP="0"
DO_COLLECT="1"

# Range config
FULL_RANGE="1"

# Amounts (used only if toggles are enabled)
LIQUIDITY_BASE_AMOUNT="0"
LIQUIDITY_BASE_AMOUNT_HUMAN="0"
LIQUIDITY_QUOTE_AMOUNT_SOL="300"
LIQUIDITY_USE_QUOTE_EXACT="1"
SWAP_DIRECTION="a2b"
SWAP_AMOUNT="1000000"
SWAP_COUNT="100"
SWAP_PARALLEL="1"
SWAP_CONCURRENCY="8"
SWAP_SLIPPAGE_BPS="500"
SWAP_NO_MIN_OUT="1"
SWAP_SPLIT_HALF="0"
INIT_PRICE_PCT_ABOVE="0"
# Human fraction: QUOTE / BASE. Example: 0.44 SOL per 560 BASE.
INIT_PRICE_NUM="0.44"   # QUOTE (SOL) in human units
INIT_PRICE_DEN="560"    # BASE amount in human units

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ENGINE_DIR}"

export ANCHOR_PROVIDER_URL
export ANCHOR_WALLET

yarn ts-node scripts/raydium/clmm.ts \
  --ammConfig "${AMM_CONFIG}" \
  --quoteMint "${QUOTE_MINT}" \
  --clmmProgram "${CLMM_PROGRAM}" \
  --airdrop "${AIRDROP}" \
  --baseDecimals "${BASE_DECIMALS}" \
  --mintAmount "${MINT_AMOUNT}" \
  --tickSpacing "${TICK_SPACING}" \
  --feeRateBps "${FEE_RATE_BPS}" \
  --initPrice "${INIT_PRICE}" \
  --fullRange "${FULL_RANGE}" \
  --initPricePctAbove "${INIT_PRICE_PCT_ABOVE}" \
  --initPriceNum "${INIT_PRICE_NUM}" \
  --initPriceDen "${INIT_PRICE_DEN}" \
  --initFracIsQuoteOverBase "1" \
  --initFracHuman "1" \
  --liquidityBaseAmount "$([ "$DO_LIQUIDITY" = "1" ] && echo "${LIQUIDITY_BASE_AMOUNT}" || echo "0")" \
  --liquidityBaseAmountHuman "$([ "$DO_LIQUIDITY" = "1" ] && echo "${LIQUIDITY_BASE_AMOUNT_HUMAN}" || echo "0")" \
  --liquidityQuoteAmountSol "$([ "$DO_LIQUIDITY" = "1" ] && echo "${LIQUIDITY_QUOTE_AMOUNT_SOL}" || echo "0")" \
  --liquidityUseQuoteExact "$([ "$DO_LIQUIDITY" = "1" ] && echo "${LIQUIDITY_USE_QUOTE_EXACT}" || echo "0")" \
  --swapDirection "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_DIRECTION}" || echo "")" \
  --swapAmount "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_AMOUNT}" || echo "0")" \
  --swapCount "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_COUNT}" || echo "1")" \
  --swapParallel "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_PARALLEL}" || echo "0")" \
  --swapConcurrency "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_CONCURRENCY}" || echo "8")" \
  --swapSlippageBps "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_SLIPPAGE_BPS}" || echo "100")" \
  --swapNoMinOut "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_NO_MIN_OUT}" || echo "0")" \
  --swapSplitHalf "$([ "$DO_SWAP" = "1" ] && echo "${SWAP_SPLIT_HALF}" || echo "0")" \
  --doCollect "$([ "$DO_COLLECT" = "1" ] && echo "1" || echo "0")"


