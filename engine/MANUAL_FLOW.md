# Deployment and Setup Guide

This document contains the complete deployment flow for the Engine program, matching the test flow
in `tests/raydium-clmm-anchor.test.ts`.

## Prerequisites

- Solana CLI configured with the deployer wallet
- Anchor CLI installed
- XYBER token mint created
- Multisig keypair prepared

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
anchor build -- --features devnet
```

```bash
# Deploy Engine program
anchor deploy --provider.cluster localnet --program-name engine --program-keypair keys/deploy-keypair.json
sleep 5
anchor idl init --provider.cluster localnet --filepath target/idl/engine.json $(solana address -k keys/deploy-keypair.json)
```

```bash
# Deploy Income Dispatcher program
anchor deploy --provider.cluster localnet --program-name income_dispatcher --program-keypair keys/dispatcher.json
sleep 2
anchor idl init --provider.cluster localnet --filepath target/idl/income_dispatcher.json $(solana address -k keys/dispatcher.json)
```

### 2. Setup: Airdrop SOL to Wallets

Before initializing the engine configuration, ensure all wallets have sufficient SOL:

```bash
solana airdrop 100 $(solana address -k keys/multisig.json) --url localhost
solana airdrop 100 $(solana address -k keys/deployer.json) --url localhost
solana airdrop 100 $(solana address -k keys/platform.json) --url localhost
solana airdrop 9000 $(solana address -k keys/backend.json) --url localhost
solana airdrop 10000 $(solana address -k keys/creator.json) --url localhost
solana airdrop 10000 $(solana address -k keys/buyer1.json) --url localhost
solana airdrop 10000 $(solana address -k keys/buyer2.json) --url localhost
solana airdrop 10000 $(solana address -k keys/buyer3.json) --url localhost
solana airdrop 10000 $(solana address -k keys/buyer4.json) --url localhost
solana airdrop 100 $(solana address -k keys/treasure.json) --url localhost
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
  --fee-payer keys/multisig.json \
  --mint-authority keys/multisig.json \
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
  --fee-payer keys/multisig.json

# Mint tokens to creator
spl-token mint --url localhost --recipient-owner $CREATOR --mint-authority keys/multisig.json $XYBER_MINT 1000000000
```

### 4. Initialize Engine Configuration

Initialize the global engine configuration. First run must be signed by deployer:

```bash
anchor run init-engine-config --provider.cluster localnet -- \
  --treasury $(solana address -k keys/treasure.json) \
  --xyber-mint $(solana address -k keys/xyber-mint.json) \
  --realloc-fund-lamports 3000000000 \
  --signer-keypair ./keys/deployer.json \
  --new-multisig $(solana address -k keys/multisig.json)
```

For subsequent updates, use the stored multisig as signer:

```bash
anchor run init-engine-config --provider.cluster localnet -- \
  --treasury $(solana address -k keys/treasure.json) \
  --xyber-mint $(solana address -k keys/xyber-mint.json) \
  --realloc-fund-lamports 3000000000 \
  --signer-keypair ./keys/multisig.json \
  --new-multisig $(solana address -k keys/multisig.json)
```

### 5. Fund Realloc PDA (Optional)

The realloc_funds PDA is initially funded during `init-engine-config` via `--realloc-fund-lamports`.
To add more SOL later:

```bash
solana transfer \
  $(solana find-program-derived-address DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7 string:root-0-100-1 string:realloc_funds) \
  5 \
  --url localhost \
  --fee-payer keys/multisig.json
```

### 6. Create Launch Preset

Launch presets are reusable templates that store common launch parameters. Create a test preset for rapid local testing:

```bash
anchor run init-launch-preset --provider.cluster localnet -- \
  --payload ./presets/deployment.json \
  --multisig-keypair ./keys/multisig.json
```

## Launch Flow (Matches Test Suite)

### Step 1: Initialize Launch from Preset

Create a new launch using the preset. Project ID is automatically fetched from the counter:

```bash
anchor run init-launch --provider.cluster localnet -- \
  --preset-id 0 \
  --name TestToken \
  --symbol TEST \
  --uri https://example.com/metadata.json \
  --creator-keypair ./keys/creator.json
```

Optionally, add a third-party signer for backend event tracking:

```bash
anchor run init-launch --provider.cluster localnet -- \
  --preset-id 0 \
  --name TestToken \
  --symbol TEST \
  --uri https://example.com/metadata.json \
  --creator-keypair ./keys/creator.json \
  --third-party-keypair ./keys/backend.json
```

### Step 2: Make Deposits

Make deposits to the launch. Lottery and contribution accounts are created automatically:

```bash
# Deposit 1 (150 SOL)
anchor run deposit --provider.cluster localnet -- --project-id 0 --amount 150000000000 --user-keypair ./keys/buyer1.json

# Deposit 2 (150 SOL)
anchor run deposit --provider.cluster localnet -- --project-id 0 --amount 150000000000 --user-keypair ./keys/buyer2.json

# Deposit 3 (150 SOL)
anchor run deposit --provider.cluster localnet -- --project-id 0 --amount 150000000000 --user-keypair ./keys/buyer3.json
```

### Step 3: Wait for Funding Period

Wait for the funding period to end. The duration is set in the preset (`fundingDurationSeconds`).

For test preset with `fundingDurationSeconds: 5`, just wait a few seconds.
For production presets with longer durations, wait accordingly.

### Step 4: Set VRF Seed

Set the VRF seed for randomness in winner selection:

```bash
anchor run set-seed --provider.cluster localnet -- --project-id 0
```

### Step 5: Finalize Lottery

Finalize the lottery by running the winner selection algorithm:

```bash
anchor run finalize-lottery --provider.cluster localnet -- --project-id 0
```

### Step 6: Create CLMM Pool

Create the Raydium CLMM pool. This also generates the base mint:

```bash
anchor run create-clmm-pool --provider.cluster localnet -- --project-id 0
```

### Step 7: Add Liquidity to CLMM Pool

Add liquidity to the created CLMM pool:

```bash
anchor run add-clmm-liquidity --provider.cluster localnet -- --project-id 0
```

### Step 8: Initialize Income Dispatcher

Initialize the Income Dispatcher program. First run must be signed by deployer:

- **devnet/localnet**: `3paTDrXrsXjh9J3KLwSNup3nMPRSbSjS1h3iYTKPfqbP`
- **mainnet**: `7xLqtwhLTSmXwNi3ddwpoxsCcGQXtvwdMCd3YdtgHVnF`

```bash
anchor run dispatcher-init --provider.cluster localnet -- \
  --backend $(solana address -k keys/backend.json) \
  --platform-wallet $(solana address -k keys/platform.json) \
  --community-wallet $(solana address -k keys/backend.json) \
  --signer-keypair ./keys/deployer.json \
  --new-multisig $(solana address -k keys/multisig.json)
```

For subsequent updates, use the stored multisig as signer:

```bash
anchor run dispatcher-init --provider.cluster localnet -- \
  --backend $(solana address -k keys/backend.json) \
  --platform-wallet $(solana address -k keys/platform.json) \
  --community-wallet $(solana address -k keys/backend.json) \
  --signer-keypair ./keys/multisig.json \
  --new-multisig $(solana address -k keys/multisig.json)
```

### Step 9: Check Vesting Info

After claims are opened, participants can check their vesting status:

```bash
# Check Sale bucket vesting for a buyer
anchor run vesting --provider.cluster localnet -- info \
  --project-id 1 \
  --participant ./keys/buyer1.json
```

```bash
# Check Team bucket vesting for creator
anchor run vesting --provider.cluster localnet -- info \
  --project-id 1 \
  --participant ./keys/creator.json \
  --bucket 1
```

### Step 10: Claim Vested Tokens

Participants can claim their vested tokens as they unlock:

```bash
# Buyer claims from Sale bucket
anchor run vesting --provider.cluster localnet -- claim \
  --project-id 1 \
  --participant-keypair ./keys/buyer1.json
```

```bash
# Creator claims from Team bucket
anchor run vesting --provider.cluster localnet -- claim \
  --project-id 1 \
  --participant-keypair ./keys/creator.json \
  --bucket 1
```

```bash
# Creator can also claim from Sale bucket (if participated)
anchor run vesting --provider.cluster localnet -- claim \
  --project-id 1 \
  --participant-keypair ./keys/creator.json \
  --bucket 0
```

### Step 11: Refund (for losing tickets or cancelled launches)

After the lottery is finalized, participants can claim refunds for losing tickets.
If the launch is cancelled (min raise not met), full refund is available.

```bash
# Check refund info
anchor run refund --provider.cluster localnet -- info \
  --project-id 1 \
  --participant ./keys/buyer1.json
```
