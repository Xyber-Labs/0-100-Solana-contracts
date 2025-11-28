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

Download Raydium CLMM and Token Metadata Program:

```bash
mkdir -p tmp

# Download devnet Raydium CLMM program
solana program dump DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH tmp/raydium_clmm_devnet.so --url devnet

# Download devnet AMM Config account
solana account FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q --url devnet --output json > tmp/amm_config_devnet.json

# Download Token Metadata Program (Metaplex)
solana program dump metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tmp/token_metadata.so --url mainnet-beta
```

### 0.1. Start Local Validator

Start the local validator with all required programs:

```bash
solana-test-validator \
  --bpf-program DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH tmp/raydium_clmm_devnet.so \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tmp/token_metadata.so \
  --account FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q tmp/amm_config_devnet.json \
  --reset
```

Keep this terminal open.

### Step 0: Verify Raydium CLMM and AmmConfig

Verify that Raydium CLMM program and AmmConfig are loaded:

```bash
# Raydium CLMM Program ID (devnet)
solana account DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH --url localhost

# AmmConfig Account (devnet, index=2)
solana account FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q --url localhost
```

Both should exist and be owned by the Raydium CLMM program.

## Deployment Steps

### 1. Deploy the Programs

For localnet/devnet deployment (uses devnet Raydium addresses):

```bash
anchor build -- --features devnet,anchor-test
```

```bash
# Deploy Engine program
anchor deploy --provider.cluster localnet --program-name engine --program-keypair keys/deploy-keypair.json
sleep 2
anchor idl init --provider.cluster localnet --filepath target/idl/engine.json $(solana address -k keys/deploy-keypair.json)
```

```bash
# Deploy Income Dispatcher program
anchor deploy --provider.cluster localnet --program-name income_dispatcher --program-keypair keys/disptcher-devnet.json
sleep 2
anchor idl init --provider.cluster localnet --filepath target/idl/income_dispatcher.json $(solana address -k keys/disptcher-devnet.json)
```

### 2. Setup: Airdrop SOL to Wallets

Before initializing the engine configuration, ensure all wallets have sufficient SOL:

```bash
solana airdrop 10 $(solana address -k keys/admin1.json) --url localhost
solana airdrop 10 $(solana address -k keys/admin2.json) --url localhost
solana airdrop 10 $(solana address -k keys/admin3.json) --url localhost
solana airdrop 10 $(solana address -k keys/deployer.json) --url localhost
solana airdrop 10 $(solana address -k keys/platform.json) --url localhost
solana airdrop 10 $(solana address -k keys/backend.json) --url localhost
solana airdrop 1000 $(solana address -k keys/creator.json) --url localhost
solana airdrop 500 $(solana address -k keys/buyer1.json) --url localhost
solana airdrop 500 $(solana address -k keys/buyer2.json) --url localhost
solana airdrop 500 $(solana address -k keys/buyer3.json) --url localhost
solana airdrop 10 $(solana address -k keys/treasure.json) --url localhost
```

**Note:** Adjust amounts based on your testing needs. These amounts match the test suite.

**Important:** The `keys/deployer.json` keypair is required for initializing the Income Dispatcher program.
The deployer public key must match the `DEPLOYER` constant in the contract.

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

```

**Note:** The test preset has `rosterShardsTotal: 1`, so only shard 1 needs to be initialized. Shard IDs are 1-based.

### Step 3: Make Deposits

Make deposits to the launch:

```bash
# Deposit 1 (150 SOL)
anchor run deposit --provider.cluster localnet -- --project-id 1 --amount 150000000000 --user-keypair ./keys/buyer1.json --shard-id 1

# Deposit 2 (150 SOL)
anchor run deposit --provider.cluster localnet -- --project-id 1 --amount 150000000000 --user-keypair ./keys/buyer2.json --shard-id 1

# Deposit 3 (150 SOL)
anchor run deposit --provider.cluster localnet -- --project-id 1 --amount 150000000000 --user-keypair ./keys/buyer3.json --shard-id 1
```

**Note:** `--shard-id 1` is the default and can be omitted. Adjust amounts as needed.

### Step 4: Wait for Funding Period and Finalize Shard

After the funding period ends (10 minutes for test preset), finalize the roster shard:

```bash
# Wait for funding period to end (600 seconds from first deposit)
# Then finalize:

anchor run finalize-roster-shard --provider.cluster localnet -- --project-id 1 --shard-id 1
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

### Step 9: Initialize Income Dispatcher

Initialize the Income Dispatcher program. This must be done with the deployer keypair that matches the
`DEPLOYER` constant hardcoded in the contract:

- **devnet/localnet**: `3paTDrXrsXjh9J3KLwSNup3nMPRSbSjS1h3iYTKPfqbP`
- **mainnet**: `7xLqtwhLTSmXwNi3ddwpoxsCcGQXtvwdMCd3YdtgHVnF`

```bash
anchor run dispatcher-init --provider.cluster localnet -- \
  --platform-wallet $(solana address -k keys/platform.json) \
  --community-wallet $(solana address -k keys/backend.json) \
  --deployer-keypair ./keys/deployer.json
```

**Note:** The Income Dispatcher can only be initialized once. After initialization, the deployer becomes
the admin and can reinitialize to update wallets.
