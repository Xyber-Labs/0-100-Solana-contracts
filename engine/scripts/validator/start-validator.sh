#!/usr/bin/env bash
set -euo pipefail

# Script to start local validator with all required on-chain programs
#
# By default, it uses devnet program IDs.
# To use mainnet, run with:
# NET=mainnet ./scripts/validator/start-validator.sh

# Set default network if not provided
NET=${NET:-devnet}

# Resolve RPC URL from NET
RPC_URL=$([ "$NET" = "devnet" ] && echo "https://api.devnet.solana.com" || echo "https://api.mainnet-beta.solana.com")

# Program IDs
CLMM_ID=$([ "$NET" = "devnet" ] && echo "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" || echo "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
CPMM_ID=$([ "$NET" = "devnet" ] && echo "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb" || echo "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C")
TOKEN_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
ATA_ID=ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
METADATA_ID=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
TOKEN_2022_ID=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

# AmmConfig ID
AMM_CONFIG_ID=$([ "$NET" = "devnet" ] && echo "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy" || echo "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv")

# Check if dependencies are downloaded
if [ ! -f "./tmp/raydium_clmm.so" ] || \
   [ ! -f "./tmp/raydium_cpmm.so" ] || \
   [ ! -f "./tmp/spl_token.so" ] || \
   [ ! -f "./tmp/spl_ata.so" ] || \
   [ ! -f "./tmp/mpl_token_metadata.so" ] || \
   [ ! -f "./tmp/spl_token_2022.so" ] || \
   [ ! -f "./tmp/amm_config.json" ]; then
    echo "🚨 Program binaries or AmmConfig not found. Please run ./scripts/validator/setup-local-validator.sh first."
    exit 1
fi

AMM_CONFIG_PATH=./tmp/amm_config_patched.json
if [ ! -f "$AMM_CONFIG_PATH" ]; then
  AMM_CONFIG_PATH=./tmp/amm_config.json
fi

echo "🚀 Starting local validator with programs from './tmp/'..."
echo "AMM_CONFIG_ID: $AMM_CONFIG_ID"
echo "AMM_CONFIG_PATH: $AMM_CONFIG_PATH"
echo "CLMM_ID: $CLMM_ID"
echo "CPMM_ID: $CPMM_ID"
echo "RPC_URL: $RPC_URL"

solana-test-validator --reset \
  --url "$RPC_URL" \
  --bpf-program "$CLMM_ID" ./tmp/raydium_clmm.so \
  --bpf-program "$CPMM_ID" ./tmp/raydium_cpmm.so \
  --bpf-program "$TOKEN_ID" ./tmp/spl_token.so \
  --bpf-program "$ATA_ID"   ./tmp/spl_ata.so \
  --bpf-program "$METADATA_ID" ./tmp/mpl_token_metadata.so \
  --bpf-program "$TOKEN_2022_ID" ./tmp/spl_token_2022.so \
  --account "$AMM_CONFIG_ID" "$AMM_CONFIG_PATH" \
  --clone SysvarRent111111111111111111111111111111111 \
  --clone SysvarC1ock11111111111111111111111111111111 \
  --rpc-port 8899 --limit-ledger-size

# anchor idl init \
#   --provider.url http://127.0.0.1:8899 \
#   --filepath ./tmp/raydium_clmm.idl.json \
#   $CLMM_ID