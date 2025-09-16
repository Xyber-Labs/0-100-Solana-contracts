# Engine Solana Program

A comprehensive Solana program implementing a lottery/raffle system with fair winner selection using VRF (Verifiable Random Function) and cranking mechanism.

## Features

- **Fair Selection**: Uses VRF-based ticket scoring for transparent winner selection
- **Cranking System**: Processes tickets in batches to handle large-scale lotteries
- **Over-subscription Handling**: Manages deposits exceeding hard cap
- **Refund System**: Automatic refunds for non-winning participants
- **Token Distribution**: Minting and distribution of tokens to winners

## Quick Start

### Prerequisites

- Node.js and Yarn
- Solana CLI tools
- Anchor framework

### Running Tests

#### Option 1: Using Makefile (Recommended)
```bash
# Run all tests (builds, deploys, and tests)
make test

# Quick test run (assumes program is already built/deployed)
make test-quick

# Run only basic tests
make test-basic

# See all available commands
make help
```

#### Option 2: Using the Script
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

#### Option 3: Manual Commands
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

The test suite provides comprehensive coverage of all program functions:

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
4. **Cranking**: Processes all tickets in batches of 10
5. **Selection**: Selects 40 winners (K capacity = hard_cap / tau)
6. **Claims**: Tests refunds and token claims

### Test Results
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

## Program Architecture

### Key Components

- **LaunchState**: Main program state with configuration and status
- **Roster**: Tracks user deposits and ticket counts
- **SelectionState**: Manages VRF-based winner selection
- **EscrowAccount**: Holds deposited SOL
- **UserContribution**: Individual user deposit tracking

### Selection Algorithm

1. **Ticket Generation**: Each SOL deposit creates tickets (amount / tau)
2. **VRF Scoring**: Deterministic score generation using wallet + ticket index
3. **Heap Management**: Maintains top-K winners during processing
4. **Threshold Setting**: Final threshold for tie-breaking
5. **Claims Processing**: Refunds losers, mints tokens for winners

## Development

### Building
```bash
anchor build
```

### Deploying
```bash
anchor deploy
```

### Testing
```bash
make test
```

### Cleaning
```bash
make clean
```

## Troubleshooting

### Common Issues

1. **"ANCHOR_PROVIDER_URL is not defined"**
   ```bash
   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
   ```

2. **"Program not found"**
   ```bash
   solana config set --url http://127.0.0.1:8899
   anchor build
   anchor deploy
   ```

3. **"Validator not running"**
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
```

## Files

- `programs/engine/src/lib.rs` - Main program implementation
- `tests/engine.ts` - Comprehensive test suite
- `Makefile` - Build and test automation
- `run-tests.sh` - Test runner script
- `TESTING.md` - Detailed testing guide

## License

ISC
