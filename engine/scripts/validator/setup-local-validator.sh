#!/usr/bin/env bash
set -euo pipefail

# Script to download required on-chain programs for local testing
# 
# By default, it downloads programs from devnet.
# To download from mainnet, run:
# NET=mainnet ./scripts/setup-local-validator.sh

# Set default network if not provided
NET=${NET:-devnet}
echo Use network: $NET
RPC_URL=$([ "$NET" = "devnet" ] && echo "https://api.devnet.solana.com" || echo "https://api.mainnet-beta.solana.com")

# Anchor expects cluster name "mainnet-beta" (not "mainnet")
ANCHOR_CLUSTER=$([ "$NET" = "devnet" ] && echo "devnet" || echo "mainnet-beta")

# Program IDs
CLMM_ID=$([ "$NET" = "devnet" ] && echo "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" || echo "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
CPMM_ID=$([ "$NET" = "devnet" ] && echo "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb" || echo "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C")
TOKEN_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
ATA_ID=ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
METADATA_ID=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
TOKEN_2022_ID=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

# AmmConfig ID
AMM_CONFIG_ID=$([ "$NET" = "devnet" ] && echo "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy" || echo "HfERMT5DRA6C1TAqecrJQFpmkf3wsWTMncqnj3RDg5aw")

# Create tmp directory
mkdir -p ./tmp

echo "🔗 Connecting to $NET to download required programs..."

# 1) Download .so files directly from the network
echo "📥 Downloading Raydium CLMM program..."
solana program dump -u "$RPC_URL" "$CLMM_ID" ./tmp/raydium_clmm.so

echo "📥 Downloading Raydium CPMM program..."
solana program dump -u "$RPC_URL" "$CPMM_ID" ./tmp/raydium_cpmm.so

echo "📥 Downloading Token Program..."
solana program dump -u "$RPC_URL" "$TOKEN_ID" ./tmp/spl_token.so

echo "📥 Downloading Associated Token Program..."
solana program dump -u "$RPC_URL" "$ATA_ID"   ./tmp/spl_ata.so

echo "📥 Downloading Token Metadata Program..."
solana program dump -u "$RPC_URL" "$METADATA_ID" ./tmp/mpl_token_metadata.so

echo "📥 Downloading Token-2022 Program..."
solana program dump -u "$RPC_URL" "$TOKEN_2022_ID" ./tmp/spl_token_2022.so

# 2) Download AmmConfig account
echo "📥 Downloading Raydium AMM config..."
solana account -u "$RPC_URL" "$AMM_CONFIG_ID" --output json > ./tmp/amm_config.json

echo "📥 Downloading Raydium CLMM IDL..."
anchor idl fetch "$CLMM_ID" --provider.cluster "$ANCHOR_CLUSTER" > ./tmp/raydium_clmm.idl.json || echo "⚠️ Failed to fetch CLMM IDL"

echo "📥 Attempting to download Raydium CPMM IDL..."
anchor idl fetch "$CPMM_ID" --provider.cluster "$ANCHOR_CLUSTER" > ./tmp/raydium_cpmm.idl.json || echo "⚠️ Failed to fetch CPMM IDL (may be expected)"

echo "✅ All programs downloaded to ./tmp/"
echo "📋 Downloaded programs:"
ls -la ./tmp/

echo ""
echo "🚀 Ready to start local validator!"
