#!/usr/bin/env bash
set -euo pipefail

ANCHOR_PROVIDER_URL=${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}
ANCHOR_WALLET=${ANCHOR_WALLET:-$HOME/.config/solana/id.json}

AMM_CONFIG="CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu"
QUOTE_MINT="So11111111111111111111111111111111111111112"
# Use Raydium CLMM devnet program by default; override via env CLMM_PROGRAM if needed
CLMM_PROGRAM="${CLMM_PROGRAM:-DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH}"
AIRDROP="10"
BASE_DECIMALS="6"
MINT_AMOUNT="0"
TICK_SPACING="60"
FEE_RATE_BPS="2500"
INIT_PRICE="1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ENGINE_DIR}"

export ANCHOR_PROVIDER_URL
export ANCHOR_WALLET

yarn ts-node scripts/raydium/raydium.ts \
  --ammConfig "${AMM_CONFIG}" \
  --quoteMint "${QUOTE_MINT}" \
  --clmmProgram "${CLMM_PROGRAM}" \
  --airdrop "${AIRDROP}" \
  --baseDecimals "${BASE_DECIMALS}" \
  --mintAmount "${MINT_AMOUNT}" \
  --tickSpacing "${TICK_SPACING}" \
  --feeRateBps "${FEE_RATE_BPS}" \
  --initPrice "${INIT_PRICE}"


