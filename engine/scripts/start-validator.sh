#!/bin/bash

# Script to start local validator with all required accounts
set -e

echo "🚀 Starting local validator with all required accounts..."

solana-test-validator --reset \
  --bpf-program CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK ./tmp/raydium_clmm_program.json \
  --account 2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv ./tmp/raydium_amm_config.json \
  --account TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA ./tmp/token_program.json \
  --account ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL ./tmp/associated_token_program.json \
  --account 11111111111111111111111111111111 ./tmp/system_program.json \
  --account SysvarRent111111111111111111111111111111111 ./tmp/rent_sysvar.json \
  --account SysvarS1otHashes111111111111111111111111111 ./tmp/slot_hashes_sysvar.json
