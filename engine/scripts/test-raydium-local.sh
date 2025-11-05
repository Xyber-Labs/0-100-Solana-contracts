#!/usr/bin/env bash
set -euo pipefail

export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=$HOME/.config/solana/id.json

cd /Users/wotori/git/xyber-labs/papers/0-100/engine
yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/raydium-clmm-anchor.test.ts


