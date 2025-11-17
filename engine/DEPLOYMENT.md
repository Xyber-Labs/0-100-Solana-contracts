# Deployment and Setup Guide

This document contains the complete deployment flow for the Engine program, matching the test flow
in `tests/raydium-clmm-anchor.test.ts`.

## Prerequisites

- Solana CLI configured with the deployer wallet
- Anchor CLI installed
- XYBER token mint created
- Admin keypairs prepared (minimum 2-3 for multisig)

## Local Validator Setup

### 0. Download Required Programs

Download Raydium CLMM and other programs from devnet (or mainnet):

```bash
export NET=mainnet-beta
./scripts/setup-local-validator.sh
```

### 0.1. Start Local Validator

Start the local validator with all downloaded programs:

```bash
scripts/start-validator.sh
```

Starts `solana-test-validator` with Raydium CLMM, loads AMM Config, uploads IDL. Keep this terminal open.

### Step 0: Verify Raydium CLMM and AmmConfig

Verify that Raydium CLMM program and AmmConfig are loaded:

```bash
# Raydium CLMM Program ID
solana account CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK --url localhost

# AmmConfig Account
solana account 9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x --url localhost
```

Both should exist and be owned by the Raydium CLMM program.

## Deployment Steps

### 1. Deploy the Program

```bash
anchor build
anchor deploy --provider.cluster localnet --program-name engine --program-keypair keys/deploy-keypair.json
sleep 2
anchor idl init --provider.cluster localnet --filepath target/idl/engine.json $(solana address -k keys/deploy-keypair.json)
```

### 2. Setup: Airdrop SOL to Wallets

Before initializing the engine configuration, ensure all wallets have sufficient SOL:

```bash
solana airdrop 10 $(solana address -k keys/admin1.json) --url localhost
solana airdrop 10 $(solana address -k keys/admin2.json) --url localhost
solana airdrop 10 $(solana address -k keys/admin3.json) --url localhost
solana airdrop 1000 $(solana address -k keys/creator.json) --url localhost
solana airdrop 500 $(solana address -k keys/buyer1.json) --url localhost
solana airdrop 500 $(solana address -k keys/buyer2.json) --url localhost
solana airdrop 500 $(solana address -k keys/buyer3.json) --url localhost
solana airdrop 10 $(solana address -k keys/treasure.json) --url localhost
```

**Note:** Adjust amounts based on your testing needs. These amounts match the test suite.

### 3. Create XYBER Token Mint

Create XYBER token mint (if not exists):

```bash
export XYBER_MINT=$(solana address -k keys/xyber-mint.json)
export CREATOR=$(solana address -k keys/creator.json)

# Create XYBER token mint
spl-token create-token \
  --url localhost \
  --fee-payer keys/admin1.json \
  --mint-authority keys/admin1.json \
  --decimals 6 \
  keys/xyber-mint.json

# Create token account for creator
spl-token create-account $XYBER_MINT \
  --owner $CREATOR \
  --url localhost \
  --fee-payer keys/creator.json

# Create token account for treasury
export TREASURY=$(solana address -k keys/treasure.json)
spl-token create-account $XYBER_MINT \
  --owner $TREASURY \
  --url localhost \
  --fee-payer keys/admin1.json

# Mint tokens to creator
spl-token mint --url localhost --recipient-owner $CREATOR --mint-authority keys/admin1.json $XYBER_MINT 1000000000
```

### 4. Initialize Engine Configuration

Initialize the global engine configuration with multisig admin setup:

```bash
anchor run init-engine-config --provider.cluster localnet -- \
  --treasury $(solana address -k keys/treasure.json) \
  --creation-fee 1000000000 \
  --xyber-mint $(solana address -k keys/xyber-mint.json) \
  --threshold 2 \
  --admin1-keypair ./keys/admin1.json \
  --admin2-keypair ./keys/admin2.json \
  --admin3-keypair ./keys/admin3.json
```

### 5. Create Launch Preset

Launch presets are reusable templates that store common launch parameters. Create a test preset for rapid local testing:

```bash
anchor run init-launch-preset --provider.cluster localnet -- \
  --payload ./presets/deployment.json \
  --admin-keypair ./keys/admin1.json \
  --admin-keypair ./keys/admin2.json \
  --admin-keypair ./keys/admin3.json
```

## Launch Flow (Matches Test Suite)

### Step 1: Initialize Launch from Preset

Create a new launch using the preset:

```bash
anchor run init-launch-from-preset --provider.cluster localnet -- \
  --preset-id 0 \
  --project-id 1 \
  --name TestToken \
  --symbol TEST \
  --uri https://example.com/metadata.json \
  --creator-keypair ./keys/creator.json
```

### Step 2: Initialize Roster and Shard

Initialize roster and roster shard (required before deposits):

```bash
# Initialize roster
anchor run init-roster --provider.cluster localnet -- --project-id 1

# Initialize roster shard 0
anchor run init-roster-shard --provider.cluster localnet -- --project-id 1 --shard-id 0
```

**Note:** The test preset has `rosterShardsTotal: 1`, so only shard 0 needs to be initialized.

### Step 3: Make Deposits

Make deposits to the launch. You can vary amounts using environment variables:

```bash
# Default: 150 SOL each (450 SOL total)
# Or set custom amounts:
# export BUYER1_AMOUNT=100
# export BUYER2_AMOUNT=100
# export BUYER3_AMOUNT=100

# Deposit 1
anchor run deposit --provider.cluster localnet -- --project-id 1 --amount 150000000000 --user-keypair ./keys/buyer1.json

# Deposit 2
anchor run deposit --provider.cluster localnet -- --project-id 1 --amount 150000000000 --user-keypair ./keys/buyer2.json

# Deposit 3
anchor run deposit --provider.cluster localnet -- --project-id 1 --amount 150000000000 --user-keypair ./keys/buyer3.json
```

**Note:** Total deposited includes creator deposit + all buyer deposits. The test suite uses configurable amounts
via `BUYER1_AMOUNT`, `BUYER2_AMOUNT`, `BUYER3_AMOUNT` environment variables.

### Step 4: Wait for Funding Period and Finalize Shard

After the funding period ends (10 minutes for test preset), finalize the roster shard:

```bash
# Wait for funding period to end (600 seconds from first deposit)
# Then finalize:

anchor run finalize-roster-shard --provider.cluster localnet -- --project-id 1 --shard-id 0
```

### Step 5: Set VRF Seed

Set the VRF seed for randomness in winner selection:

```bash
anchor run set-seed --provider.cluster localnet -- --project-id 1
```

### Step 6: Prepare Pool Creation

Prepare pool creation by selecting blockhash and finalizing selection:

```bash
anchor run prepare-pool-creation --provider.cluster localnet -- --project-id 1
```

### Step 7: Create CLMM Pool

Create the Raydium CLMM pool. This also generates the base mint:

```bash
anchor run create-clmm-pool --provider.cluster localnet -- --project-id 1
```

### Step 8: Add Liquidity to CLMM Pool

Add liquidity to the created CLMM pool:

```bash
anchor run add-clmm-liquidity --provider.cluster localnet -- --project-id 1
```
