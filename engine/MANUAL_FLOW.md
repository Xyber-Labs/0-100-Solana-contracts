# Deployment and Setup Guide

This document contains the complete deployment flow for the Engine program, matching the test flow
in `tests/raydium-clmm-anchor.test.ts`.

## Prerequisites

- Solana CLI configured with the deployer wallet
- Anchor CLI installed
- XYBER token mint created
- Multisig keypair prepared

## Local Validator Setup

```bash
  export CLUSTER=localnet
  export PROJECT_ID=0

  if [[ "$CLUSTER" == "localnet" ]]; then
      export SCLUSTER=localhost
  else
      export SCLUSTER=$CLUSTER
  fi
```

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
solana account DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH --url  ${SCLUSTER}

# AmmConfig Account (devnet, index=2)
solana account FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q --url  ${SCLUSTER}
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
anchor deploy --provider.cluster ${CLUSTER} --program-name engine --program-keypair ${CLUSTER}/engine.json
sleep 5
anchor idl init --provider.cluster ${CLUSTER} --filepath target/idl/engine.json $(solana address -k ${CLUSTER}/engine.json)
```

```bash
# Deploy Income Dispatcher program
anchor deploy --provider.cluster ${CLUSTER} --program-name income_dispatcher --program-keypair ${CLUSTER}/dispatcher.json
sleep 2
anchor idl init --provider.cluster ${CLUSTER} --filepath target/idl/income_dispatcher.json $(solana address -k ${CLUSTER}/dispatcher.json)
```

### 2. Setup: Airdrop SOL to Wallets

Before initializing the engine configuration, ensure all wallets have sufficient SOL:

```bash
solana airdrop 100 $(solana address -k ${CLUSTER}/multisig.json) --url ${SCLUSTER}
solana airdrop 100 $(solana address -k ${CLUSTER}/deployer.json) --url ${SCLUSTER}
solana airdrop 100 $(solana address -k ${CLUSTER}/platform.json) --url ${SCLUSTER}
solana airdrop 9000 $(solana address -k ${CLUSTER}/backend.json) --url ${SCLUSTER}
solana airdrop 10000 $(solana address -k ${CLUSTER}/creator.json) --url ${SCLUSTER}
solana airdrop 10000 $(solana address -k ${CLUSTER}/buyer1.json) --url ${SCLUSTER}
solana airdrop 10000 $(solana address -k ${CLUSTER}/buyer2.json) --url ${SCLUSTER}
solana airdrop 10000 $(solana address -k ${CLUSTER}/buyer3.json) --url ${SCLUSTER}
solana airdrop 10000 $(solana address -k ${CLUSTER}/buyer4.json) --url ${SCLUSTER}
solana airdrop 100 $(solana address -k ${CLUSTER}/treasure.json) --url ${SCLUSTER}
```

**Note:** Adjust amounts based on your testing needs. These amounts match the test suite.

**Important:** The `${CLUSTER}/deployer.json` keypair is required for initializing the Income Dispatcher program.
The deployer public key must match the `DEPLOYER` constant in the contract.

### 3. Create XYBER Token Mint

Create XYBER token mint (if not exists):

```bash
export XYBER_MINT=$(solana address -k ${CLUSTER}/xyber-mint.json)
export CREATOR=$(solana address -k ${CLUSTER}/creator.json)
export MULTISIG=$(solana address -k ${CLUSTER}/multisig.json)

# Create XYBER token mint
spl-token create-token \
  --url ${SCLUSTER} \
  --fee-payer ${CLUSTER}/multisig.json \
  --mint-authority ${CLUSTER}/multisig.json \
  --decimals 6 \
  ${CLUSTER}/xyber-mint.json

# Create token account for creator
spl-token create-account $XYBER_MINT \
  --owner $CREATOR \
  --url ${SCLUSTER} \
  --fee-payer ${CLUSTER}/creator.json

# Create token account for treasury
export TREASURY=$(solana address -k ${CLUSTER}/treasure.json)
spl-token create-account $XYBER_MINT \
  --owner $TREASURY \
  --url ${SCLUSTER} \
  --fee-payer ${CLUSTER}/multisig.json

# Mint tokens to creator
spl-token mint --url ${SCLUSTER} --recipient-owner $CREATOR --mint-authority ${CLUSTER}/multisig.json $XYBER_MINT 1000000000
```

### 4. Initialize Engine Configuration

Initialize the global engine configuration. First run must be signed by deployer:

```bash
anchor run init-engine-config --provider.cluster ${CLUSTER} -- \
  --treasury $(solana address -k ${CLUSTER}/treasure.json) \
  --xyber-mint $(solana address -k ${CLUSTER}/xyber-mint.json) \
  --realloc-fund-lamports 3000000000 \
  --signer-keypair ${CLUSTER}/deployer.json \
  --new-multisig $(solana address -k ${CLUSTER}/multisig.json)
```

For subsequent updates, use the stored multisig as signer:

```bash
anchor run init-engine-config --provider.cluster ${CLUSTER} -- \
  --treasury $(solana address -k ${CLUSTER}/treasure.json) \
  --xyber-mint $(solana address -k ${CLUSTER}/xyber-mint.json) \
  --realloc-fund-lamports 3000000000 \
  --signer-keypair ${CLUSTER}/multisig.json \
  --new-multisig $(solana address -k ${CLUSTER}/multisig.json)
```

### 5. Fund Realloc PDA (Optional)

The realloc_funds PDA is initially funded during `init-engine-config` via `--realloc-fund-lamports`.
To add more SOL later:

```bash
solana transfer \
  $(solana find-program-derived-address DhKVzFTjzax7MeLEqiEXmEhm6ERSjehYaamqai5oPKZ7 string:root-0-100-1 string:realloc_funds) \
  5 \
  --url ${SCLUSTER} \
  --fee-payer ${CLUSTER}/multisig.json
```

### 6. Create Launch Preset

Launch presets are reusable templates that store common launch parameters. Create a test preset for rapid local testing:

```bash
anchor run init-launch-preset --provider.cluster ${CLUSTER} -- \
  --payload ./presets/deployment-${CLUSTER}.json \
  --multisig-keypair ${CLUSTER}/multisig.json
```

## Launch Flow (Matches Test Suite)

### Step 1: Initialize Launch from Preset

Create a new launch using the preset. Project ID is automatically fetched from the counter:

```bash
anchor run init-launch --provider.cluster ${CLUSTER} -- \
  --preset-id 0 \
  --name TestToken \
  --symbol TEST \
  --uri https://example.com/metadata.json \
  --creator-keypair ${CLUSTER}/creator.json
```

Optionally, add a third-party signer for backend event tracking:

```bash
anchor run init-launch --provider.cluster ${CLUSTER} -- \
  --preset-id 0 \
  --name TestToken \
  --symbol TEST \
  --uri https://example.com/metadata.json \
  --creator-keypair ${CLUSTER}/creator.json \
  --third-party-keypair ${CLUSTER}/backend.json
```

### Step 2: Make Deposits

Make deposits to the launch. Lottery and contribution accounts are created automatically:

```bash
# Deposit 1 (150 SOL)
anchor run deposit --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID} --amount 150000000000 --user-keypair ${CLUSTER}/buyer1.json

# Deposit 2 (150 SOL)
anchor run deposit --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID} --amount 150000000000 --user-keypair ${CLUSTER}/buyer2.json

# Deposit 3 (150 SOL)
anchor run deposit --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID} --amount 150000000000 --user-keypair ${CLUSTER}/buyer3.json
```

### Step 3: Wait for Funding Period

Wait for the funding period to end. The duration is set in the preset (`fundingDurationSeconds`).

For test preset with `fundingDurationSeconds: 5`, just wait a few seconds.
For production presets with longer durations, wait accordingly.

### Step 4: Set VRF Seed

Set the VRF seed for randomness in winner selection:

```bash
anchor run set-seed --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID}
```

### Step 5: Finalize Lottery

Finalize the lottery by running the winner selection algorithm:

```bash
anchor run finalize-lottery --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID}
```

### Step 6: Create CLMM Pool

Create the Raydium CLMM pool. This also generates the base mint:

```bash
anchor run create-clmm-pool --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID}
```

### Step 7: Add Liquidity to CLMM Pool

Add liquidity to the created CLMM pool:

```bash
anchor run add-clmm-liquidity --provider.cluster ${CLUSTER} -- --project-id ${PROJECT_ID}
```

### Step 8: Initialize Income Dispatcher

Initialize the Income Dispatcher program. First run must be signed by deployer:

- **devnet/localnet**: `3paTDrXrsXjh9J3KLwSNup3nMPRSbSjS1h3iYTKPfqbP`
- **mainnet**: `7xLqtwhLTSmXwNi3ddwpoxsCcGQXtvwdMCd3YdtgHVnF`

```bash
anchor run dispatcher-init --provider.cluster ${CLUSTER} -- \
  --backend $(solana address -k ${CLUSTER}/backend.json) \
  --platform-wallet $(solana address -k ${CLUSTER}/platform.json) \
  --community-wallet $(solana address -k ${CLUSTER}/backend.json) \
  --signer-keypair ./${CLUSTER}/deployer.json \
  --new-multisig $(solana address -k ${CLUSTER}/multisig.json)
```

For subsequent updates, use the stored multisig as signer:

```bash
anchor run dispatcher-init --provider.cluster ${CLUSTER} -- \
  --backend $(solana address -k ${CLUSTER}/backend.json) \
  --platform-wallet $(solana address -k ${CLUSTER}/platform.json) \
  --community-wallet $(solana address -k ${CLUSTER}/backend.json) \
  --signer-keypair ./${CLUSTER}/multisig.json \
  --new-multisig $(solana address -k ${CLUSTER}/multisig.json)
```

### Step 9: Check Vesting Info

After claims are opened, participants can check their vesting status:

```bash
# Check Sale bucket vesting for a buyer
anchor run vesting --provider.cluster ${CLUSTER} -- info \
  --project-id ${PROJECT_ID} \
  --participant ./${CLUSTER}/buyer1.json
```

```bash
# Check Team bucket vesting for creator
anchor run vesting --provider.cluster ${CLUSTER} -- info \
  --project-id ${PROJECT_ID} \
  --participant ./${CLUSTER}/creator.json \
  --bucket 1
```

### Step 10: Claim Vested Tokens

Participants can claim their vested tokens as they unlock:

```bash
# Buyer claims from Sale bucket
anchor run vesting --provider.cluster ${CLUSTER} -- claim \
  --project-id ${PROJECT_ID} \
  --participant-keypair ./${CLUSTER}/buyer1.json
```

```bash
# Creator claims from Team bucket
anchor run vesting --provider.cluster ${CLUSTER} -- claim \
  --project-id ${PROJECT_ID} \
  --participant-keypair ./${CLUSTER}/creator.json \
  --bucket 1
```

```bash
# Creator can also claim from Sale bucket (if participated)
anchor run vesting --provider.cluster ${CLUSTER} -- claim \
  --project-id ${PROJECT_ID} \
  --participant-keypair ./${CLUSTER}/creator.json \
  --bucket 0
```

### Step 11: Refund (for losing tickets or cancelled launches)

After the lottery is finalized, participants can claim refunds for losing tickets.
If the launch is cancelled (min raise not met), full refund is available.

```bash
# Check refund info
anchor run refund --provider.cluster ${CLUSTER} -- info \
  --project-id ${PROJECT_ID} \
  --participant ./${CLUSTER}/buyer1.json
```

```bash
# Claim refunds for losing tickets or cancelled launches
anchor run refund --provider.cluster ${CLUSTER} -- claim \
  --project-id ${PROJECT_ID} \
  --user-keypair ./${CLUSTER}/buyer1.json
```
