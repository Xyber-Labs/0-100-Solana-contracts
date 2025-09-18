import { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Keypair } from '@solana/web3.js';
import EngineSDK from 'zero-hundred-engine-sdk';
import { Program, AnchorProvider } from '@coral-xyz/anchor';

function EngineDemo() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  
  const [sdk, setSdk] = useState<any>(null);
  const [program, setProgram] = useState<any>(null);
  const [launchState, setLaunchState] = useState<PublicKey | null>(null);
  const [saleMint, setSaleMint] = useState<Keypair | null>(null);
  const [escrow, setEscrow] = useState<PublicKey | null>(null);
  const [roster, setRoster] = useState<PublicKey | null>(null);
  const [selection, setSelection] = useState<PublicKey | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    setLogs(prev => [...prev, logEntry]);
  };

  const initializeSDK = useCallback(async () => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      addLog('ERROR: Wallet not connected');
      return;
    }

    try {
      addLog('Initializing SDK...');
      
      // Create wallet adapter
      const wallet = {
        publicKey,
        signTransaction,
        signAllTransactions,
      };

      // Create provider
      const provider = new AnchorProvider(connection, wallet, {});
      
      // Load IDL dynamically
      const idl = await EngineSDK.loadIdl();
      
      // Import and initialize program using SDK's built-in IDL
      const program = new Program(idl as any, provider);
      
      // Create SDK instance
      const sdkInstance = EngineSDK.create(provider, program as any);
      
      setSdk(sdkInstance);
      setProgram(program);
      
      addLog('SUCCESS: SDK initialized successfully');
    } catch (error) {
      addLog(`ERROR: Failed to initialize SDK - ${error}`);
    }
  }, [publicKey, signTransaction, signAllTransactions, connection]);

  const createLaunchState = useCallback(async () => {
    if (!sdk || !program) {
      addLog('ERROR: SDK not initialized');
      return;
    }

    try {
      addLog('Creating launch state...');
      
      const saleMintKeypair = Keypair.generate();
      const [launchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("launch"), saleMintKeypair.publicKey.toBuffer()],
        program.programId
      );

      const tx = await sdk.createLaunchState({
        saleMint: saleMintKeypair.publicKey,
        launchState: launchPda,
      });

      await tx.rpc();
      
      setLaunchState(launchPda);
      setSaleMint(saleMintKeypair);
      
      addLog(`SUCCESS: Launch state created - ${launchPda.toString()}`);
    } catch (error) {
      addLog(`ERROR: Failed to create launch state - ${error}`);
    }
  }, [sdk, program]);

  const createSaleMint = useCallback(async () => {
    if (!saleMint) {
      addLog('ERROR: Sale mint not created');
      return;
    }

    try {
      addLog('Creating sale mint...');
      
      const tx = await sdk.createSaleMint({
        saleMint: saleMint.publicKey,
        decimals: 6,
      });

      await tx.rpc();
      
      addLog(`SUCCESS: Sale mint created - ${saleMint.publicKey.toString()}`);
    } catch (error) {
      addLog(`ERROR: Failed to create sale mint - ${error}`);
    }
  }, [sdk, saleMint]);

  const createEscrow = useCallback(async () => {
    if (!saleMint) {
      addLog('ERROR: Sale mint not available');
      return;
    }

    try {
      addLog('Creating escrow...');
      
      const [escrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), saleMint.publicKey.toBuffer()],
        program.programId
      );

      const tx = await sdk.createEscrow({
        saleMint: saleMint.publicKey,
        escrow: escrowPda,
      });

      await tx.rpc();
      
      setEscrow(escrowPda);
      addLog(`SUCCESS: Escrow created - ${escrowPda.toString()}`);
    } catch (error) {
      addLog(`ERROR: Failed to create escrow - ${error}`);
    }
  }, [sdk, program, saleMint]);

  const createRoster = useCallback(async () => {
    if (!saleMint) {
      addLog('ERROR: Sale mint not available');
      return;
    }

    try {
      addLog('Creating roster...');
      
      const [rosterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("roster"), saleMint.publicKey.toBuffer()],
        program.programId
      );

      const tx = await sdk.createRoster({
        saleMint: saleMint.publicKey,
        roster: rosterPda,
      });

      await tx.rpc();
      
      setRoster(rosterPda);
      addLog(`SUCCESS: Roster created - ${rosterPda.toString()}`);
    } catch (error) {
      addLog(`ERROR: Failed to create roster - ${error}`);
    }
  }, [sdk, program, saleMint]);

  const createSelection = useCallback(async () => {
    if (!saleMint) {
      addLog('ERROR: Sale mint not available');
      return;
    }

    try {
      addLog('Creating selection...');
      
      const [selectionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("selection"), saleMint.publicKey.toBuffer()],
        program.programId
      );

      const tx = await sdk.createSelection({
        saleMint: saleMint.publicKey,
        selection: selectionPda,
      });

      await tx.rpc();
      
      setSelection(selectionPda);
      addLog(`SUCCESS: Selection created - ${selectionPda.toString()}`);
    } catch (error) {
      addLog(`ERROR: Failed to create selection - ${error}`);
    }
  }, [sdk, program, saleMint]);

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared');
  };

  return (
    <div className="terminal-grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Status Panel */}
      <div className="terminal-card">
        <div className="terminal-prompt mb-4">
          <span className="terminal-glow">system@engine:~$</span>
          <span className="terminal-command ml-2">status</span>
        </div>
        
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="terminal-output">SDK Status:</span>
            <span className={sdk ? 'terminal-success' : 'terminal-error'}>
              {sdk ? 'INITIALIZED' : 'NOT INITIALIZED'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="terminal-output">Launch State:</span>
            <span className={launchState ? 'terminal-success' : 'terminal-error'}>
              {launchState ? launchState.toString().slice(0, 8) + '...' : 'NONE'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="terminal-output">Sale Mint:</span>
            <span className={saleMint ? 'terminal-success' : 'terminal-error'}>
              {saleMint ? saleMint.publicKey.toString().slice(0, 8) + '...' : 'NONE'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="terminal-output">Escrow:</span>
            <span className={escrow ? 'terminal-success' : 'terminal-error'}>
              {escrow ? escrow.toString().slice(0, 8) + '...' : 'NONE'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="terminal-output">Roster:</span>
            <span className={roster ? 'terminal-success' : 'terminal-error'}>
              {roster ? roster.toString().slice(0, 8) + '...' : 'NONE'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="terminal-output">Selection:</span>
            <span className={selection ? 'terminal-success' : 'terminal-error'}>
              {selection ? selection.toString().slice(0, 8) + '...' : 'NONE'}
            </span>
          </div>
        </div>
      </div>

      {/* Control Panel */}
      <div className="terminal-card">
        <div className="terminal-prompt mb-4">
          <span className="terminal-glow">admin@engine:~$</span>
          <span className="terminal-command ml-2">controls</span>
        </div>
        
        <div className="space-y-2">
          <button 
            onClick={initializeSDK}
            className="terminal-button w-full text-left"
            disabled={!publicKey}
          >
            <span className="terminal-prompt">$</span> Initialize SDK
          </button>
          
          <button 
            onClick={createLaunchState}
            className="terminal-button w-full text-left"
            disabled={!sdk}
          >
            <span className="terminal-prompt">$</span> Create Launch State
          </button>
          
          <button 
            onClick={createSaleMint}
            className="terminal-button w-full text-left"
            disabled={!saleMint}
          >
            <span className="terminal-prompt">$</span> Create Sale Mint
          </button>
          
          <button 
            onClick={createEscrow}
            className="terminal-button w-full text-left"
            disabled={!saleMint}
          >
            <span className="terminal-prompt">$</span> Create Escrow
          </button>
          
          <button 
            onClick={createRoster}
            className="terminal-button w-full text-left"
            disabled={!saleMint}
          >
            <span className="terminal-prompt">$</span> Create Roster
          </button>
          
          <button 
            onClick={createSelection}
            className="terminal-button w-full text-left"
            disabled={!saleMint}
          >
            <span className="terminal-prompt">$</span> Create Selection
          </button>
        </div>
      </div>

      {/* Logs Panel */}
      <div className="terminal-card lg:col-span-2">
        <div className="flex justify-between items-center mb-4">
          <div className="terminal-prompt">
            <span className="terminal-glow">logs@engine:~$</span>
            <span className="terminal-command ml-2">tail -f</span>
          </div>
          <button onClick={clearLogs} className="terminal-button text-xs">
            Clear Logs
          </button>
        </div>
        
        <div className="terminal-scroll bg-black bg-opacity-50 p-3 rounded border">
          {logs.length === 0 ? (
            <div className="terminal-output text-xs">
              <div>No logs yet. Initialize the SDK to start...</div>
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="terminal-output text-xs mb-1 font-mono">
                {log}
              </div>
            ))
          )}
          <div className="terminal-blink text-terminal-accent">█</div>
        </div>
      </div>
    </div>
  );
}

export default EngineDemo;