# Zero to Hundred Engine - Smart Contract Testing Interface

This is a comprehensive visual interface for testing the Zero to Hundred Engine smart contract functionality. The interface provides a terminal-style UI that allows you to interact with all smart contract methods through buttons and forms.

## Features

### 🚀 Launch Configuration
- **Configurable Parameters**: Toggle to show/hide launch parameter customization
- **Default Values**: Pre-configured with test values (100 SOL hard cap, 10 SOL min raise, etc.)
- **Real-time Updates**: Parameters update the launch initialization in real-time

### 📊 Status Monitoring
- **SDK Status**: Shows initialization status
- **Account Status**: Displays all PDA addresses (Launch, Sale Mint, Escrow, Roster, Selection)
- **Launch Data**: Real-time display of launch state (funding status, deposits, tickets, etc.)
- **User Data**: Shows user contribution status and claim states
- **Selection Data**: Displays batch processing progress and heap information

### 🎮 Smart Contract Methods
All methods from the test suite are available as UI buttons:

#### Admin Controls
- **Initialize SDK**: Connect to the smart contract
- **Init Launch**: Create a new launch with configurable parameters
- **Open Funding**: Start accepting deposits
- **Init Roster**: Initialize the participant roster
- **Close Deposits**: Stop accepting new deposits
- **Set VRF Seed**: Set the random seed for selection
- **Process Batch**: Process tickets in batches (cranking)
- **Finalize Selection**: Complete the winner selection process
- **Open Claims**: Enable token and refund claims

#### User Actions
- **Deposit**: Deposit SOL to participate (2 SOL default)
- **Withdraw**: Withdraw deposited SOL
- **Claim Refund**: Claim refund if not selected
- **Claim Tokens**: Claim tokens if selected as winner

### 📝 Enhanced Logging
- **Transaction Signatures**: All transactions show their signature
- **Detailed Status**: Step-by-step progress updates
- **Error Handling**: Clear error messages with context
- **Timestamped Logs**: All actions are timestamped

## Usage Flow

1. **Connect Wallet**: Use the wallet button in the top-right to connect your Solana wallet
2. **Initialize SDK**: Click "Initialize SDK" to connect to the smart contract
3. **Configure Launch** (Optional): Check "Customize Parameters" to modify launch settings
4. **Init Launch**: Create a new launch with your parameters
5. **Test Flow**: Follow the complete flow:
   - Open Funding → Init Roster → Deposit → Close Deposits → Set VRF Seed → Process Batch → Finalize Selection → Open Claims → Claim Tokens/Refund

## Technical Details

- **Framework**: React with TypeScript
- **Wallet Integration**: Solana Wallet Adapter
- **Styling**: Tailwind CSS with terminal theme
- **Smart Contract**: Uses the Zero to Hundred Engine SDK
- **Network**: Configured for Solana Localnet

## Testing

The interface replicates the complete test flow from `tests/engine.ts`, allowing you to:
- Test individual methods
- Run the complete launch flow
- Monitor state changes in real-time
- Debug transaction issues
- Verify smart contract behavior

## Localnet Setup

The UI is configured to work with Solana localnet:

1. **Start Local Validator**: Make sure `solana-test-validator` is running
2. **Deploy Program**: Run `anchor deploy` to deploy the smart contract
3. **Get Test SOL**: Use the "💧 Request 1000 SOL" button to get test tokens
4. **Connect Wallet**: Use Phantom or Solflare wallet

### Prerequisites
- Solana CLI installed
- Local validator running on `http://127.0.0.1:8899`
- Program deployed to localnet
- Wallet connected with test SOL

## Default Configuration

- **Hard Cap**: 100 SOL
- **Min Raise**: 10 SOL  
- **Per Wallet Cap**: 5 SOL
- **Tau**: 1 SOL (price per ticket)
- **Sale Allocation**: 1,000,000 tokens
- **LP Allocation**: 500,000 tokens

You can customize these values using the configuration form before initializing a launch.
