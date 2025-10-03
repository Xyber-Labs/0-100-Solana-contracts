import React, { useState, useEffect } from 'react';
import { Keypair } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';

interface TestWalletProps {
  onWalletChange: (keypair: Keypair | null) => void;
  currentWallet: Keypair | null;
  isRemoteNode?: boolean; // Optional since we're not using it anymore
}

const TestWallet: React.FC<TestWalletProps> = ({ onWalletChange, currentWallet }) => {
  const { connection } = useConnection();
  const [isOpen, setIsOpen] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Load saved wallet from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('test-wallet-secret');
    if (saved) {
      try {
        const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(saved)));
        onWalletChange(keypair);
        setSecretKey(saved);
      } catch (error) {
        console.error('Failed to load saved wallet:', error);
        localStorage.removeItem('test-wallet-secret');
      }
    }
  }, []); // Removed onWalletChange dependency to prevent infinite loops

  // Fetch balance when wallet changes
  useEffect(() => {
    if (currentWallet) {
      fetchBalance();
    } else {
      setBalance(0);
    }
  }, [currentWallet]); // Removed connection dependency to prevent infinite loops

  const fetchBalance = async () => {
    if (!currentWallet || !connection) return;
    
    try {
      const balance = await connection.getBalance(currentWallet.publicKey);
      setBalance(balance);
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  };

  const generateNewWallet = () => {
    const keypair = Keypair.generate();
    const secretKeyArray = Array.from(keypair.secretKey);
    
    setSecretKey(JSON.stringify(secretKeyArray));
    onWalletChange(keypair);
    localStorage.setItem('test-wallet-secret', JSON.stringify(secretKeyArray));
    setError('');
  };

  const importWallet = () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Try to parse as JSON array first
      let secretKeyArray: number[];
      try {
        secretKeyArray = JSON.parse(secretKey);
      } catch {
        // If not JSON, try to parse as base58 string
        const keypair = Keypair.fromSecretKey(
          new Uint8Array(secretKey.split(',').map(Number))
        );
        onWalletChange(keypair);
        localStorage.setItem('test-wallet-secret', secretKey);
        setError('');
        return;
      }
      
      if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
        throw new Error('Invalid secret key format');
      }
      
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
      onWalletChange(keypair);
      localStorage.setItem('test-wallet-secret', JSON.stringify(secretKeyArray));
      setError('');
    } catch (error) {
      setError(`Invalid secret key: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const clearWallet = () => {
    onWalletChange(null);
    setSecretKey('');
    setBalance(0);
    localStorage.removeItem('test-wallet-secret');
    setError('');
  };

  const requestAirdrop = async () => {
    if (!currentWallet || !connection) return;
    
    try {
      setIsLoading(true);
      setError('');
      
      console.log('Requesting airdrop for:', currentWallet.publicKey.toString());
      
      const signature = await connection.requestAirdrop(
        currentWallet.publicKey,
        2 * 1e9 // 2 SOL
      );
      
      console.log('Airdrop signature:', signature);
      
      // Wait for confirmation with longer timeout
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      });
      
      // Wait a bit more for balance to update
      setTimeout(async () => {
        await fetchBalance();
      }, 1000);
      
    } catch (error) {
      console.error('Airdrop error:', error);
      setError(`Airdrop failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Show test wallet for both local and remote nodes
  // if (!isRemoteNode) {
  //   return null;
  // }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="terminal-button text-xs bg-purple-600 hover:bg-purple-500 flex items-center space-x-2"
      >
        <span>🔑 {currentWallet ? 'Test Wallet' : 'No Wallet'}</span>
        <span className="text-xs opacity-75">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-gray-900 border border-gray-600 rounded shadow-lg z-50">
          <div className="p-3">
            <div className="text-xs terminal-output mb-3">Test Wallet Manager:</div>
            
            {currentWallet ? (
              <div className="space-y-3">
                <div className="p-2 bg-green-900 bg-opacity-30 border border-green-400 rounded">
                  <div className="text-xs terminal-success font-bold">Active Test Wallet</div>
                  <div className="text-xs terminal-output mt-1">
                    Address: {currentWallet.publicKey.toString().slice(0, 8)}...
                  </div>
                  <div className="text-xs terminal-output">
                    Balance: {(balance / 1e9).toFixed(4)} SOL
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <button
                    onClick={requestAirdrop}
                    className="terminal-button text-xs bg-yellow-600 hover:bg-yellow-500 flex-1"
                    disabled={isLoading}
                  >
                    💧 Request 2 SOL
                  </button>
                  <button
                    onClick={clearWallet}
                    className="terminal-button text-xs bg-red-600 hover:bg-red-500"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs terminal-output">No test wallet active</div>
                
                <div>
                  <label className="block text-xs terminal-output mb-1">
                    Secret Key (64 numbers, comma-separated):
                  </label>
                  <textarea
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="Enter secret key array or generate new one..."
                    className="terminal-input w-full h-20 text-xs"
                  />
                </div>
                
                {error && (
                  <div className="text-xs terminal-error bg-red-900 bg-opacity-30 p-2 rounded border border-red-400">
                    {error}
                  </div>
                )}
                
                <div className="flex space-x-2">
                  <button
                    onClick={importWallet}
                    className="terminal-button text-xs bg-green-600 hover:bg-green-500 flex-1"
                    disabled={!secretKey || isLoading}
                  >
                    Import Wallet
                  </button>
                  <button
                    onClick={generateNewWallet}
                    className="terminal-button text-xs bg-blue-600 hover:bg-blue-500"
                    disabled={isLoading}
                  >
                    Generate New
                  </button>
                </div>
              </div>
            )}
            
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="text-xs terminal-output">
                💡 Tip: Use test wallets for development and testing
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestWallet;
