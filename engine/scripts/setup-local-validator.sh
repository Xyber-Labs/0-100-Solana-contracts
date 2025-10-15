#!/bin/bash

# Script to download required accounts from mainnet and setup local validator
set -e

echo "🔗 Connecting to mainnet to download required accounts..."

# Create tmp directory
mkdir -p ./tmp

# Switch to mainnet
solana config set --url https://api.mainnet-beta.solana.com

echo "📥 Downloading Raydium CLMM program..."
solana account CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK --output json --output-file ./tmp/raydium_clmm_program.json

echo "📥 Downloading Raydium AMM config..."
solana account 2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv --output json --output-file ./tmp/raydium_amm_config.json

echo "📥 Downloading Token Program..."
solana account TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --output json --output-file ./tmp/token_program.json

echo "📥 Downloading Associated Token Program..."
solana account ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL --output json --output-file ./tmp/associated_token_program.json

echo "📥 Downloading System Program..."
solana account 11111111111111111111111111111111 --output json --output-file ./tmp/system_program.json

echo "📥 Downloading Rent Sysvar..."
solana account SysvarRent111111111111111111111111111111111 --output json --output-file ./tmp/rent_sysvar.json

echo "📥 Downloading SlotHashes Sysvar..."
solana account SysvarS1otHashes111111111111111111111111111 --output json --output-file ./tmp/slot_hashes_sysvar.json

echo "✅ All accounts downloaded to ./tmp/"
echo "📋 Downloaded accounts:"
ls -la ./tmp/

echo ""
echo "🔄 Switching back to localnet..."
solana config set --url http://127.0.0.1:8899

echo ""
echo "🚀 Ready to start local validator with:"
echo "solana-test-validator --reset \\"
echo "  --bpf-program CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK ./tmp/raydium_clmm_program.json \\"
echo "  --account 2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv ./tmp/raydium_amm_config.json \\"
echo "  --account TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA ./tmp/token_program.json \\"
echo "  --account ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL ./tmp/associated_token_program.json \\"
echo "  --account 11111111111111111111111111111111 ./tmp/system_program.json \\"
echo "  --account SysvarRent111111111111111111111111111111111 ./tmp/rent_sysvar.json \\"
# echo "  --account SysvarS1otHashes111111111111111111111111111 ./tmp/slot_hashes_sysvar.json"
