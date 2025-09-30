# 🚀 Zero to Hundred Engine - SDK Demo

A React application that demonstrates the Zero to Hundred Engine SDK functionality with a beautiful, interactive UI.

## Features

- **Wallet Integration**: Connect with Phantom, Solflare, and other Solana wallets
- **Complete SDK Testing**: Test all engine methods through an intuitive interface
- **Real-time Logging**: See transaction signatures and status updates
- **State Management**: Track launch state, PDAs, and account information
- **Responsive Design**: Works on desktop and mobile devices

## Available Functions

### 🚀 Launch Management
- **Initialize Launch**: Create a new launch with configurable parameters
- **Open Funding**: Start accepting deposits
- **Initialize Roster**: Set up the participant tracking system
- **Close Deposits**: End the funding phase

### 🎲 Selection Process
- **Set VRF Seed**: Configure the random selection seed
- **Process Batch**: Run the selection algorithm on batches of participants
- **Finalize Selection**: Complete the winner selection process
- **Open Claims**: Enable token and refund claims

### 💰 User Actions
- **Deposit**: Contribute SOL to the launch (2 SOL default)
- **Withdraw**: Remove SOL from the launch (1 SOL default)
- **Claim Refund**: Get refunded for unselected tickets
- **Claim Tokens**: Receive tokens for winning tickets

### 📊 Data Fetching
- **Fetch Launch State**: View current launch configuration and status

## Getting Started

### Prerequisites
- Node.js 18+ 
- A Solana wallet (Phantom, Solflare, etc.)
- Some SOL on Devnet for testing

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:5173`

### Usage

1. **Connect Wallet**: Click the wallet button in the header to connect your Solana wallet
2. **Initialize Launch**: Click "Initialize Launch" to create a new launch (this will create a new mint)
3. **Follow the Flow**: Use the buttons in order to test the complete engine flow:
   - Open Funding → Initialize Roster → Make Deposits → Close Deposits
   - Set VRF Seed → Process Batch → Finalize Selection → Open Claims
   - Claim Refund/Tokens as needed

### Configuration

The app is configured to use:
- **Network**: Solana Devnet
- **Program ID**: `HMVJWXWhpxEWWGhvLHYnTvkmYJcA819jAxw3EgdNYiYb`
- **Default Values**:
  - Hard Cap: 100 SOL
  - Min Raise: 10 SOL
  - Per Wallet Cap: 5 SOL
  - Tau (ticket price): 1 SOL
  - Sale Allocation: 1,000,000 tokens
  - LP Allocation: 500,000 tokens

## Architecture

- **React + TypeScript**: Modern frontend framework
- **Vite**: Fast build tool and dev server
- **Solana Wallet Adapter**: Wallet integration
- **Zero to Hundred Engine SDK**: Custom SDK for engine interactions
- **Anchor**: Solana program framework

## File Structure

```
src/
├── App.tsx              # Main app component with wallet providers
├── App.css              # Styling and responsive design
├── EngineDemo.tsx       # Main demo component with SDK integration
└── sdk/                 # Zero to Hundred Engine SDK
    ├── src/
    │   └── engine.ts    # SDK implementation (used by UI, not test file)
    └── idl/             # Program IDL and types
```

## Troubleshooting

### Common Issues

1. **Wallet Connection Failed**: Make sure you have a Solana wallet installed and unlocked
2. **Transaction Failed**: Check that you have enough SOL for transaction fees
3. **SDK Not Initialized**: Ensure your wallet is connected before using SDK functions
4. **Network Issues**: Verify you're connected to Solana Devnet

### Getting Devnet SOL

Use the Solana CLI or visit https://faucet.solana.com to get free Devnet SOL for testing.

## Development

### Building for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

### Linting

```bash
npm run lint
```

## Contributing

This demo app is part of the Zero to Hundred Engine project. For contributions to the engine itself, see the main project repository.

## License

This project is part of the Zero to Hundred Engine and follows the same license terms.