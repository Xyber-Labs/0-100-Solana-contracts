# Engine Solana Program

A comprehensive Solana program implementing a lottery/raffle system with fair winner selection using VRF (Verifiable
Random Function) and cranking mechanism.

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

## Contract Management Scripts

Scripts for initializing and managing launches across any Solana environment (mainnet, devnet, testnet, localnet).

### Initialize Launch

```bash
anchor run --provider.cluster localnet init-launch
```

Configurable parameters: hard cap, min raise, per-wallet cap, tau, sale/LP allocations, funding duration, roster shard
cap, creator deposit/limits/lock period (use `--help` for details). The script outputs a transaction signature with and
explorer link for the cluster.

### Initialize Roster

```bash
anchor run --provider.cluster localnet init-roster -- --project-id <PROJECT_ID>
```

Initializes the roster (participant list) for a launch project. Use `--help` for parameter details. The script outputs a transaction signature with explorer link for the cluster.

## Development

### Building

```bash
anchor build
```

### Deploying

```bash
anchor deploy
```
