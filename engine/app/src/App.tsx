import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import EngineDemo from './EngineDemo';

// Import styles
import '@solana/wallet-adapter-react-ui/styles.css';
import './index.css';

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

function App() {
  return (
    <ConnectionProvider endpoint="http://127.0.0.1:8899">
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="min-h-screen bg-black">
            {/* Terminal Header */}
            <div className="terminal-window m-4">
              <div className="terminal-header">
                <div className="terminal-dot terminal-dot-red"></div>
                <div className="terminal-dot terminal-dot-yellow"></div>
                <div className="terminal-dot terminal-dot-green"></div>
                <span className="text-green-400 font-mono text-sm ml-4">
                  Zero to Hundred Engine - Smart Contract Terminal
                </span>
              </div>
              <div className="terminal-content">
                <div className="flex items-center justify-between mb-4">
                  <div className="terminal-prompt">
                    <span className="terminal-glow">root@engine:~$</span>
                    <span className="terminal-command ml-2">./zero-to-hundred-engine</span>
                  </div>
                  <WalletMultiButton />
                </div>
                <div className="terminal-output text-xs mb-4">
                  <div>Initializing Zero to Hundred Engine SDK...</div>
                  <div>Connecting to Solana Devnet...</div>
                  <div>Loading smart contract interface...</div>
                </div>
                <EngineDemo />
              </div>
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;