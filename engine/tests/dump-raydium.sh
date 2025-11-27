#!/bin/bash
set -e

RESOURCES_DIR="tests/resources"
RAYDIUM_PROGRAM_MAINNET="CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
RAYDIUM_PROGRAM_DEVNET="DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
METAPLEX_PROGRAM="metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"

mkdir -p "$RESOURCES_DIR"

# Check if all programs are already dumped
if [ -f "$RESOURCES_DIR/raydium_clmm.so" ] && \
   [ -f "$RESOURCES_DIR/raydium_clmm_devnet.so" ] && \
   [ -f "$RESOURCES_DIR/metaplex_metadata.so" ]; then
  echo "✅ All program files already exist in $RESOURCES_DIR, skipping dump"
  exit 0
fi

echo "Dumping Raydium CLMM program (mainnet)..."
solana program dump "$RAYDIUM_PROGRAM_MAINNET" \
  "$RESOURCES_DIR/raydium_clmm.so" \
  --url mainnet-beta

echo "Dumping Raydium CLMM program (devnet)..."
solana program dump "$RAYDIUM_PROGRAM_DEVNET" \
  "$RESOURCES_DIR/raydium_clmm_devnet.so" \
  --url devnet

echo "Dumping Metaplex Token Metadata program..."
solana program dump "$METAPLEX_PROGRAM" \
  "$RESOURCES_DIR/metaplex_metadata.so" \
  --url mainnet-beta

echo "✅ All programs dumped successfully to $RESOURCES_DIR"
