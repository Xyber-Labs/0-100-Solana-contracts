# Testing Guide for Engine Solana Program

This guide explains how to run the comprehensive tests for the Engine Solana program.

## Quick Start

### Option 1: Using Makefile (Recommended)
```bash
# Run all tests (builds, deploys, and tests)
make test

# Quick test run (assumes program is already built/deployed)
make test-quick

# Run only basic tests
make test-basic
```

### Option 2: Using the Script
```bash
# Run all tests
./run-tests.sh

# Quick test run
./run-tests.sh quick

# Run only basic tests
./run-tests.sh basic

# Run with verbose output
./run-tests.sh verbose
```

### Option 3: Manual Commands
```bash
# Set environment variables
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=~/.config/solana/id.json

# Set Solana config to localhost
solana config set --url http://127.0.0.1:8899

# Start validator (in background)
solana-test-validator --reset &

# Build and deploy
anchor build
anchor deploy

# Run tests
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

## Test Coverage

The test suite covers all functions in the Engine program:

### Basic Functions (6 tests)
- ✅ `init_launch` - Initialize launch state
- ✅ `open_funding` - Open funding window
- ✅ `close_deposits` - Close deposits and build roster
- ✅ `set_seed` - Set VRF seed for selection
- ✅ `deposit` - User deposits SOL
- ✅ `withdraw` - User withdraws SOL

### Advanced Functions (1 comprehensive test)
- ✅ `process_batch` - Cranking ticket selection
- ✅ `finalize_selection` - Set threshold score
- ✅ `open_claims` - Open token claims
- ✅ `claim_refund` - Refund losers
- ✅ `claim_tokens` - Mint tokens for winners

## Comprehensive Flow Test

The comprehensive test demonstrates the complete lottery/raffle flow:

1. **Setup**: Creates 15 users with 20 SOL each
2. **Deposits**: 30 SOL total (exceeds 20 SOL hard cap)
3. **Tickets**: 60 tickets generated (30 SOL ÷ 0.5 SOL per ticket)
4. **Cranking**: Processes all tickets in batches
5. **Selection**: Selects 40 winners (K capacity)
6. **Claims**: Tests refunds and token claims

## Troubleshooting

### Common Issues

1. **"ANCHOR_PROVIDER_URL is not defined"**
   ```bash
   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
   ```

2. **"ANCHOR_WALLET is not set"**
   ```bash
   export ANCHOR_WALLET=~/.config/solana/id.json
   ```

3. **"Program not found"**
   ```bash
   solana config set --url http://127.0.0.1:8899
   anchor build
   anchor deploy
   ```

4. **"Validator not running"**
   ```bash
   solana-test-validator --reset &
   ```

### Debug Commands

```bash
# Check Solana config
solana config get

# Check if validator is running
curl http://127.0.0.1:8899

# Check if program is deployed
solana program show HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb

# Check validator logs
ps aux | grep solana-test-validator
```

## Makefile Commands

```bash
make help          # Show all available commands
make test          # Run all tests (comprehensive coverage)
make test-quick    # Quick test run
make test-basic    # Run only basic tests (6 tests)
make build         # Build program
make deploy        # Deploy program
make validator     # Start validator
make clean         # Clean build artifacts
make setup         # Full setup (build + deploy + test)
```

## Environment Variables

- `ANCHOR_PROVIDER_URL`: Solana RPC URL (default: http://127.0.0.1:8899)
- `ANCHOR_WALLET`: Path to Solana wallet (default: ~/.config/solana/id.json)

## Test Results

When all tests pass, you should see:
```
✔ Initializes the launch state
✔ Opens funding
✔ Closes funding  
✔ Sets the VRF seed
✔ Allows deposits
✔ Allows withdrawals
✔ Complete flow: Multiple users deposit beyond hard cap, cranking selects winners

7 passing (40s)
```

The comprehensive test shows:
- Total deposited: 30 SOL (exceeds 20 SOL hard cap)
- Total tickets: 60
- Winners selected: 40
- Threshold score calculated
- Tokens per ticket: 25,000
- Refund and token claims working
