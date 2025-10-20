#!/usr/bin/env bash
set -euo pipefail

# Script to download required on-chain programs for local testing
# 
# By default, it downloads programs from devnet.
# To download from mainnet, run:
# NET=mainnet-beta ./scripts/setup-local-validator.sh

# Set default network if not provided
NET=${NET:-devnet}

# Program IDs
CLMM_ID=$([ "$NET" = "devnet" ] && echo "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" || echo "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
TOKEN_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
ATA_ID=ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL

# AmmConfig ID
AMM_CONFIG_ID=$([ "$NET" = "devnet" ] && echo "CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu" || echo "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv")

# Create tmp directory
mkdir -p ./tmp

echo "🔗 Connecting to $NET to download required programs..."

# 1) Download .so files directly from the network
echo "📥 Downloading Raydium CLMM program..."
solana program dump -u $NET $CLMM_ID ./tmp/raydium_clmm.so

echo "📥 Downloading Token Program..."
solana program dump -u $NET $TOKEN_ID ./tmp/spl_token.so

echo "📥 Downloading Associated Token Program..."
solana program dump -u $NET $ATA_ID   ./tmp/spl_ata.so

# 2) Download AmmConfig account
echo "📥 Downloading Raydium AMM config..."
solana account -u $NET $AMM_CONFIG_ID --output json > ./tmp/amm_config.json

echo "✅ All programs downloaded to ./tmp/"
echo "📋 Downloaded programs:"
ls -la ./tmp/

echo ""
echo "🚀 Ready to start local validator!"
