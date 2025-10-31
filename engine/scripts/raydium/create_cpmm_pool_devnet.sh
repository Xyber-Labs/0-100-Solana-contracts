#!/usr/bin/env bash
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR/../.."

yarn ts-node scripts/raydium/cpmm_devnet.ts


