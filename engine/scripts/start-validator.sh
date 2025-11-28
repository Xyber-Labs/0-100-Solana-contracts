#!/usr/bin/env bash
set -euo pipefail

# Script to start local validator with all required on-chain programs
#
# By default, it uses devnet program IDs.
# To use mainnet, run with:
# NET=mainnet-beta ./scripts/start-validator.sh

# Set default network if not provided
NET=${NET:-devnet}

# Program IDs
CLMM_ID=$([ "$NET" = "devnet" ] && echo "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" || echo "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
TOKEN_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
ATA_ID=ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
METADATA_ID=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
TOKEN_2022_ID=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

# AmmConfig ID (tick spacing 60)
AMM_CONFIG_ID=$([ "$NET" = "devnet" ] && echo "CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu" || echo "9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x")

# Check if dependencies are downloaded
if [ ! -f "./tmp/raydium_clmm.so" ] || [ ! -f "./tmp/amm_config.json" ]; then
    echo "🚨 Program binaries or AmmConfig not found. Please run ./scripts/setup-local-validator.sh first."
    exit 1
fi

echo "🚀 Starting local validator with programs from './tmp/'..."

solana-test-validator --reset \
  --bpf-program $CLMM_ID ./tmp/raydium_clmm.so \
  --bpf-program $TOKEN_ID ./tmp/spl_token.so \
  --bpf-program $ATA_ID   ./tmp/spl_ata.so \
  --bpf-program $METADATA_ID ./tmp/mpl_token_metadata.so \
  --bpf-program $TOKEN_2022_ID ./tmp/spl_token_2022.so \
  --account $AMM_CONFIG_ID ./tmp/amm_config.json \
  --clone B6qVEqoYkBnTa5Rv8XdjEvATDtREo569SvgvSeViHuQc --url https://api.mainnet-beta.solana.com \
  --rpc-port 8899 &

VALIDATOR_PID=$!

echo "⏳ Waiting for validator to start..."
sleep 5

# Optionally upload Engine IDL only if the program is deployed to localnet
if solana program show DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7 >/dev/null 2>&1; then
  echo "📦 Uploading Engine IDL to local validator..."
  anchor idl init --provider.cluster localnet --filepath target/idl/engine.json DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7 || true
  echo "✅ Engine IDL upload attempted"
else
  echo "ℹ️  Engine program not found on localnet yet; skipping Engine IDL upload"
fi

echo "✅ Validator started with PID $VALIDATOR_PID"
echo "Press Ctrl+C to stop the validator"

wait $VALIDATOR_PID
