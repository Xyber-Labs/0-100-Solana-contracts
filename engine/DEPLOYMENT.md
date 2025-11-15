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

**Preset structure** (see `presets/deployment.json`):

- Hard cap: 450 SOL
- Min raise: 100 SOL
- Per wallet cap: 150 SOL
- Funding duration: 600 seconds (10 minutes)
- Base total allocation: 1,000,000,000,000,000,000 (1 billion tokens with decimals=9)

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

**Parameters:**

- `--preset-id 0` - Preset ID from step 5
- `--project-id 1` - Unique project ID (increment for each launch)
- `--name` - Token name
- `--symbol` - Token symbol (ticker)
- `--uri` - Metadata URI
- `--creator-keypair` - Creator's keypair

### Step 2: Initialize Roster and Shard

Initialize roster and roster shard (required before deposits):

```bash
# Initialize roster
anchor run init-roster --provider.cluster localnet -- \
  --project-id 1

# Initialize roster shard 0
anchor run init-roster-shard --provider.cluster localnet -- \
  --project-id 1 \
  --shard-id 0
```

**Parameters:**

- `--project-id 1` - Project ID from step 1
- `--shard-id 0` - Shard ID (0-based, start with 0)

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
anchor run deposit --provider.cluster localnet -- \
  --project-id 1 \
  --amount 150000000000 \
  --user-keypair ./keys/buyer1.json

# Deposit 2
anchor run deposit --provider.cluster localnet -- \
  --project-id 1 \
  --amount 150000000000 \
  --user-keypair ./keys/buyer2.json

# Deposit 3
anchor run deposit --provider.cluster localnet -- \
  --project-id 1 \
  --amount 150000000000 \
  --user-keypair ./keys/buyer3.json
```

**Parameters:**

- `--project-id 1` - Project ID from step 1
- `--amount` - Amount in lamports (150000000000 = 150 SOL)
- `--user-keypair` - Depositor's keypair

**Note:** Total deposited includes creator deposit + all buyer deposits. The test suite uses configurable amounts
via `BUYER1_AMOUNT`, `BUYER2_AMOUNT`, `BUYER3_AMOUNT` environment variables.

### Step 4: Wait for Funding Period and Finalize Shard

After the funding period ends (10 minutes for test preset), finalize the roster shard:

```bash
# Wait for funding period to end (600 seconds from first deposit)
# Then finalize:

anchor run finalize-roster-shard --provider.cluster localnet -- \
  --project-id 1 \
  --shard-id 0
```

**Parameters:**

- `--project-id 1` - Project ID from step 1
- `--shard-id 0` - Shard ID (0-based)

### Step 5: Set VRF Seed

Set the VRF seed for randomness in winner selection:

```bash
anchor run set-seed --provider.cluster localnet -- \
  --project-id 1
```

**Parameters:**

- `--project-id 1` - Project ID from step 1

### Step 6: Prepare Pool Creation

Prepare pool creation by selecting blockhash and finalizing selection:

```bash
anchor run prepare-pool-creation --provider.cluster localnet -- \
  --project-id 1
```

**Parameters:**

- `--project-id 1` - Project ID from step 1

### Step 7: Prepare Quote Mint (WSOL)

The quote mint is Wrapped SOL (WSOL):

```bash
# WSOL address (native wrapped SOL)
# So11111111111111111111111111111111111111112
```

**Note:** WSOL is the native wrapped SOL. No separate minting needed. Base mint will be generated during pool creation.

### Step 8: Skip - WSOL Doesn't Need Minting

WSOL is the native wrapped SOL, no minting step required. This step is skipped in the test flow.

### Step 9: Create CLMM Pool

Create the Raydium CLMM pool. This also generates the base mint:

```bash
anchor run create-clmm-pool --provider.cluster localnet -- \
  --project-id 1
```

**Parameters:**

- `--project-id 1` - Project ID from step 1

**Output:**

- `baseMint` - Generated base token mint address
- `baseTokenAta` - Base token associated token account
- `quoteVault` - Raydium quote vault address
- `baseVault` - Raydium base vault address

### Step 9.5: Test getLiquidityRange (Optional)

Verify liquidity range calculation:

```bash
# This is handled internally by the SDK
# You can verify tick ranges in transaction logs
```

**Note:** This step is for testing/verification only. The SDK's `addClmmLiquidity` automatically calculates liquidity
range internally.

### Step 10: Add Liquidity to CLMM Pool

Add liquidity to the created CLMM pool:

```bash
anchor run add-clmm-liquidity --provider.cluster localnet -- \
  --project-id 1
```

**Parameters:**

- `--project-id 1` - Project ID from step 1

**What happens:**

- Transfers quote tokens (SOL) from escrow to pool
- Transfers base tokens from escrow to pool
- Opens a Raydium CLMM position with calculated liquidity range
- Sets `claims_ready = true` on pool state

**Output verification:**

- Check quote vault balance (should contain deposited SOL)
- Check base vault balance (should contain base tokens for liquidity)
- Total deposited SOL visible in launch state

## Environment Variables for Testing

You can calibrate pool pricing by varying deposit amounts:

```bash
# Example: Run with different deposit amounts
export BUYER1_AMOUNT=100
export BUYER2_AMOUNT=100
export BUYER3_AMOUNT=100
anchor test --skip-local-validator

# Or single test:
env BUYER1_AMOUNT=50 BUYER2_AMOUNT=50 BUYER3_AMOUNT=50 anchor test --skip-local-validator
```

**Default values:** 150 SOL each (450 SOL total)

## Verification

After completing all steps, verify:

1. Launch state shows correct total deposited amount
2. Raydium pool exists with correct token pair
3. Quote vault contains deposited SOL
4. Base vault contains base tokens for liquidity
5. Pool state has `claims_ready = true`

## Troubleshooting

### "Raydium CLMM program not found"

- Ensure `scripts/start-validator.sh` ran successfully
- Verify Raydium program loaded: `solana account CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK --url localhost`

### "AmmConfig not found"

- Run `scripts/start-validator.sh` again
- Check AmmConfig account: `solana account 9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x --url localhost`

### "Insufficient funds"

- Airdrop more SOL to wallets (step 2)
- Check balances: `solana balance $(solana address -k keys/buyer1.json) --url localhost`

### "Funding period not ended"

- Wait for full funding duration (600 seconds = 10 minutes for test preset)
- Check `fundingPeriodEnd` in launch state

### "Base mint decimals mismatch"

- Base mint is created with `decimals = 9` automatically
- Ensure `baseTotalAllocation` in preset has 18 zeros (for 1 billion tokens)

## Testing with Test Suite

To run the full test suite that matches this deployment flow:

```bash
# Start validator
scripts/start-validator.sh

# In another terminal, run tests
anchor test --skip-local-validator

# Or with custom deposit amounts
env BUYER1_AMOUNT=100 BUYER2_AMOUNT=100 BUYER3_AMOUNT=100 anchor test --skip-local-validator
```

The test suite in `tests/raydium-clmm-anchor.test.ts` executes all these steps automatically.
