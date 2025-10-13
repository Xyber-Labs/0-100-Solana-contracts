import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Keypair, SystemProgram, Transaction, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import EngineSDK from '../../ts-sdk/src/engine';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { createInitializeMintInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { runFullFlow } from './utils/flowRunner';

// Launch configuration interface
interface LaunchConfig {
  hardCapLamports: number;
  minRaiseLamports: number;
  perWalletCap: number;
  tauLamports: number;
  saleAllocation: number;
  lpAllocation: number;
  fundingDurationDays: number; // 0-5 (0=10s, 1=30s for testing, 2-5=days)
  numBlocks: number;
  creatorInitialDepositLamports: number;
  creatorDailyLamportsLimit: number;
  creatorClaimLockPeriodSec: number;
}

// --- New interface for simulation parameters ---
interface SimulationConfig {
  numUsers: number;
}

// Error boundary component
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error?: Error}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="terminal-card">
          <div className="terminal-prompt mb-4">
            <span className="terminal-glow">error@engine:~$</span>
            <span className="terminal-command ml-2">component-error</span>
          </div>
          <div className="text-xs terminal-error">
            <div>Component crashed: {this.state.error?.message}</div>
            <button 
              onClick={() => this.setState({ hasError: false })}
              className="terminal-button mt-2"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface EngineDemoProps {
  testWallet?: Keypair | null;
}

function EngineDemo({ testWallet }: EngineDemoProps) {
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
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [launchData, setLaunchData] = useState<any>(null);
  const [userContributions, setUserContributions] = useState<any>(null);
  const [showLaunchForm, setShowLaunchForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  const [savedProjects, setSavedProjects] = useState<any[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [blockchainProjects, setBlockchainProjects] = useState<any[]>([]);
  const [projectSearchId, setProjectSearchId] = useState<string>('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isProjectManagerCollapsed, setIsProjectManagerCollapsed] = useState(true);

  // --- New state for the full flow runner ---
  const [isFlowRunning, setIsFlowRunning] = useState(false);

  // Helper function to convert UI selection to seconds
  const getFundingDurationInSeconds = (daysValue: number): number => {
    switch (daysValue) {
      case 0: return 10; // 10 seconds for testing
      case 1: return 30; // 30 seconds for testing
      case 2: return 2 * 24 * 60 * 60;
      case 3: return 3 * 24 * 60 * 60;
      case 4: return 4 * 24 * 60 * 60;
      case 5: return 5 * 24 * 60 * 60;
      default: return 10;
    }
  };

  // Helper function to safely get numeric values from BN, string, or number
  const safeToNumber = (value: any): number => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = Number(value);
      return isNaN(num) ? 0 : num;
    }
    if (value.toNumber && typeof value.toNumber === 'function') {
      try {
        return value.toNumber();
      } catch (error) {
        // If toNumber() fails due to 53-bit limit, use toString() and convert
        return Number(value.toString());
      }
    }
    return 0;
  };
  
  // Default launch configuration (matching tests)
  const defaultConfig: LaunchConfig = {
    hardCapLamports: 20 * 1e9, // 20 SOL
    minRaiseLamports: 10 * 1e9, // 10 SOL
    perWalletCap: 5 * 1e9, // 5 SOL
    tauLamports: 1 * 1e9, // 1 SOL
    saleAllocation: 1000000,
    lpAllocation: 500000,
    fundingDurationDays: 0, // 10 seconds for quick testing
    numBlocks: 1024, // ~1 minute window
    creatorInitialDepositLamports: 8 * 1e9, // 8 SOL creator deposit
    creatorDailyLamportsLimit: 1 * 1e9, // 1 SOL daily limit
    creatorClaimLockPeriodSec: 2, // 2 seconds for testing
  };

  // --- New state for simulation config ---
  const defaultSimConfig: SimulationConfig = {
    numUsers: 300,
  };
  
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(defaultConfig);
  const [simConfig, setSimConfig] = useState<SimulationConfig>(defaultSimConfig);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    setLogs(prev => [...prev, logEntry]);
  };

  const initializeSDK = useCallback(async () => {
    // Use test wallet if available, otherwise use connected wallet
    let activeWallet;
    
    if (testWallet) {
      // Create wallet adapter for test wallet
      activeWallet = {
        publicKey: testWallet.publicKey,
        signTransaction: async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
          if (transaction instanceof Transaction) {
            // Use partialSign to add signature without removing existing ones
            transaction.partialSign(testWallet);
            console.log('TestWallet partially signed transaction with:', testWallet.publicKey.toString());
          }
          return transaction;
        },
        signAllTransactions: async <T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> => {
          transactions.forEach(tx => {
            if (tx instanceof Transaction) {
              // Use partialSign to add signature without removing existing ones
              tx.partialSign(testWallet);
              console.log('TestWallet partially signed transaction with:', testWallet.publicKey.toString());
            }
          });
          return transactions;
        },
      };
    } else if (publicKey && signTransaction && signAllTransactions) {
      activeWallet = {
        publicKey,
        signTransaction,
        signAllTransactions,
      };
    }

    if (!activeWallet) {
      addLog('ERROR: No wallet available (connect wallet or create test wallet)');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Initializing SDK...');
      
      if (testWallet) {
        addLog(`Using test wallet: ${testWallet.publicKey.toString().slice(0, 8)}...`);
      } else {
        addLog(`Using connected wallet: ${publicKey?.toString().slice(0, 8)}...`);
      }

      // Create provider with custom wallet that handles additional signers
      const provider = new AnchorProvider(connection, activeWallet, {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
      });
      
      // Load IDL dynamically with proper error handling
      const idl = await EngineSDK.loadIdl();
      
      // Debug: Check IDL structure
      console.log('IDL structure:', {
        address: idl.address,
        instructions: idl.instructions?.length,
        accounts: idl.accounts?.length,
        types: idl.types?.length
      });
      
      // Initialize program using standard Anchor approach
      const program = new Program(idl, provider);
      
      // Create SDK instance
      const sdkInstance = EngineSDK.create(provider, program as any);
      
      setSdk(sdkInstance);
      setProgram(program);
      
      addLog('SUCCESS: SDK initialized successfully');
    } catch (error) {
      addLog(`ERROR: Failed to initialize SDK - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, signTransaction, signAllTransactions, connection, testWallet]);

  const fetchLaunchData = useCallback(async () => {
    if (!sdk || !launchState) return;
    
    try {
      const data = await sdk.fetchLaunch(launchState);
      setLaunchData(data);
      addLog('Launch data refreshed');
    } catch (error) {
      addLog(`ERROR: Failed to fetch launch data - ${error}`);
      
      // If account doesn't exist yet, wait and retry
      if (error instanceof Error && error.message.includes('Account does not exist')) {
        addLog('Account not found, waiting and retrying...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        try {
          const retryData = await sdk.fetchLaunch(launchState);
          setLaunchData(retryData);
          addLog('Launch data refreshed after retry');
        } catch (retryError) {
          addLog(`ERROR: Retry failed - ${retryError}`);
        }
      }
    }
  }, [sdk, launchState]);

  const fetchUserData = useCallback(async () => {
    const activePublicKey = testWallet?.publicKey || publicKey;
    if (!sdk || !launchState || !activePublicKey) return;
    
    try {
      const data = await sdk.fetchUserContribution(launchState, activePublicKey);
      setUserContributions(data);
      addLog('User contribution data refreshed');
    } catch (error: any) {
      // User account doesn't exist yet - this is normal before first deposit
      if (error.message?.includes('Account does not exist')) {
        setUserContributions(null);
        addLog('User account not created yet (normal before first deposit)');
      } else {
        addLog(`ERROR: Failed to fetch user data - ${error}`);
      }
    }
  }, [sdk, launchState, publicKey, testWallet]);

  
  const fetchBalance = useCallback(async () => {
    const activePublicKey = testWallet?.publicKey || publicKey;
    if (!activePublicKey) return;
    
    try {
      const currentBalance = await connection.getBalance(activePublicKey);
      setBalance(currentBalance);
    } catch (error) {
      addLog(`ERROR: Failed to fetch balance - ${error}`);
    }
  }, [publicKey, connection, testWallet]);
  
  const initLaunch = useCallback(async () => {
    if (!sdk || !program) {
      addLog('ERROR: SDK not initialized');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Initializing launch with custom parameters...');
      
      const saleMintKeypair = Keypair.generate();
      const [launchPda] = sdk.getLaunchPda(saleMintKeypair.publicKey);
      const [escrowPda] = sdk.getEscrowPda(launchPda);

      // Get mint authority PDA
      const [mintAuth] = sdk.getMintAuthPda(launchPda);
      const [creatorGrant] = sdk.getCreatorGrantPda(launchPda);
      const [projectCounter] = sdk.getProjectCounterPda();

      console.log('Creating initLaunch transaction with:');
      console.log('saleMint:', saleMintKeypair.publicKey.toString());
      console.log('signers:', [saleMintKeypair].map(kp => kp.publicKey.toString()));
      
      // Create the transaction manually to handle signers properly
      const transaction = new Transaction();

      // Add compute unit limit
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
      );
      
      addLog(`Creating transaction for saleMint: ${saleMintKeypair.publicKey.toString()}`);
      
      // Add pre-instructions
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: (testWallet?.publicKey || publicKey)!,
          newAccountPubkey: saleMintKeypair.publicKey,
          space: 82,
          lamports: await connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        })
      );
      
      transaction.add(
        createInitializeMintInstruction(
          saleMintKeypair.publicKey,
          6,
          mintAuth,
          (testWallet?.publicKey || publicKey)!
        )
      );
      
      // Add the main instruction
      const initLaunchIx = await program.methods
        .initLaunch({
          hardCapLamports: new BN(launchConfig.hardCapLamports),
          minRaiseLamports: new BN(launchConfig.minRaiseLamports),
          perWalletCap: new BN(launchConfig.perWalletCap),
          tauLamports: new BN(launchConfig.tauLamports),
          saleAllocation: new BN(launchConfig.saleAllocation),
          lpAllocation: new BN(launchConfig.lpAllocation),
          fundingDurationSeconds: new BN(getFundingDurationInSeconds(launchConfig.fundingDurationDays)),
          numBlocks: new BN(launchConfig.numBlocks),
          creatorInitialDepositLamports: new BN(launchConfig.creatorInitialDepositLamports),
          creatorDailyLamportsLimit: new BN(launchConfig.creatorDailyLamportsLimit),
          creatorClaimLockPeriodSec: new BN(launchConfig.creatorClaimLockPeriodSec),
        })
        .accountsStrict({
          creator: (testWallet?.publicKey || publicKey)!,
          projectCounter,
          launchState: launchPda,
          saleMint: saleMintKeypair.publicKey,
          escrow: escrowPda,
          creatorGrant,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      transaction.add(initLaunchIx);
      
      addLog(`Transaction instructions count: ${transaction.instructions.length}`);
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = (testWallet?.publicKey || publicKey)!;
      
      addLog(`Transaction prepared with blockhash: ${blockhash}`);
      addLog(`Fee payer: ${(testWallet?.publicKey || publicKey)!.toString()}`);
      addLog(`Transaction signers: ${transaction.signatures.map(sig => sig.publicKey.toString()).join(', ')}`);
      
      let signature: string;
      
      if (testWallet) {
        // For TestWallet, sign manually
        addLog(`Signing with TestWallet: ${testWallet.publicKey.toString()}`);
        transaction.sign(testWallet, saleMintKeypair);
        const signers = [testWallet, saleMintKeypair].filter(Boolean) as Keypair[];
        addLog(`Sending transaction with signers: ${signers.map(s => s.publicKey.toString()).join(', ')}`);
        signature = await connection.sendTransaction(transaction, signers);
      } else {
        // For browser wallet, use signTransaction
        if (!signTransaction) {
          throw new Error('No signTransaction function available');
        }
        
        addLog(`Signing with browser wallet: ${publicKey?.toString()}`);
        // Sign with browser wallet first
        const signedTransaction = await signTransaction(transaction);
        addLog(`Browser wallet signed transaction`);
        addLog(`Signed transaction signatures: ${signedTransaction.signatures.map(sig => sig.publicKey.toString()).join(', ')}`);
        
        // Send the transaction with saleMintKeypair as additional signer
        addLog(`Sending transaction with additional signer: ${saleMintKeypair.publicKey.toString()}`);
        addLog(`Transaction feePayer: ${signedTransaction.feePayer?.toString()}`);
        addLog(`Transaction recentBlockhash: ${signedTransaction.recentBlockhash}`);
        addLog(`Transaction instructions count: ${signedTransaction.instructions.length}`);
        
        // Check if saleMintKeypair is already signed
        const isSaleMintSigned = signedTransaction.signatures.some(sig => 
          sig.publicKey.equals(saleMintKeypair.publicKey) && sig.signature !== null
        );
        addLog(`SaleMint already signed: ${isSaleMintSigned}`);
        
        try {
          if (isSaleMintSigned) {
            // If already signed, send without additional signers
            addLog(`Sending transaction without additional signers (already signed)`);
            signature = await connection.sendRawTransaction(signedTransaction.serialize());
          } else {
            // If not signed, send with additional signer
            addLog(`Sending transaction with additional signer`);
            signature = await connection.sendTransaction(signedTransaction, [saleMintKeypair]);
          }
          addLog(`Transaction sent, signature: ${signature}`);
        } catch (sendError) {
          addLog(`ERROR: Failed to send transaction - ${sendError}`);
          addLog(`Error details: ${JSON.stringify(sendError)}`);
          throw sendError;
        }
      }
      
      setLaunchState(launchPda);
      setSaleMint(saleMintKeypair);
      setEscrow(escrowPda);
      
      if (!signature) {
        throw new Error('Transaction signature is empty');
      }
      
      addLog(`SUCCESS: Launch initialized - Signature: ${signature}`);
      addLog(`Launch PDA: ${launchPda.toString()}`);
      addLog(`Sale Mint: ${saleMintKeypair.publicKey.toString()}`);
      addLog(`Transaction sent successfully`);
      
      // Wait for transaction confirmation and account creation
      addLog('Waiting for transaction confirmation...');
      await connection.confirmTransaction(signature, 'confirmed');
      
      // Wait a bit more for account to be fully created
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fetch initial launch data
      await fetchLaunchData();
    } catch (error) {
      addLog(`ERROR: Failed to initialize launch - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, program, publicKey, launchConfig, fetchLaunchData]);



  const setSeed = useCallback(async () => {
    if (!sdk || !launchState) {
      addLog('ERROR: Launch not initialized');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Setting VRF seed using blockhash...');
      const { selectionPda, signature } = await sdk.setSeed({
        launch: launchState,
      });
      setSelection(selectionPda);
      addLog(`SUCCESS: VRF seed set using blockhash - Signature: ${signature}`);
      addLog(`Selection PDA: ${selectionPda.toString()}`);
      await fetchLaunchData();
    } catch (error) {
      addLog(`ERROR: Failed to set seed - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, fetchLaunchData]);


  const deposit = useCallback(async () => {
    if (!sdk || !launchState) {
      addLog('ERROR: Launch not initialized');
      return;
    }

    try {
      setIsLoading(true);
      const depositAmount = new BN(2 * 1e9); // 2 SOL
      addLog(`Depositing ${depositAmount.toNumber() / 1e9} SOL...`);
      const { userPda, signature } = await sdk.deposit({
        launch: launchState,
        amountLamports: depositAmount,
      });
      addLog(`SUCCESS: Deposit made - Signature: ${signature}`);
      addLog(`User PDA: ${userPda.toString()}`);
      await fetchLaunchData();
      await fetchUserData();
      await fetchBalance();
    } catch (error) {
      addLog(`ERROR: Failed to deposit - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, fetchBalance, fetchLaunchData, fetchUserData]);

  const withdraw = useCallback(async () => {
    if (!sdk || !launchState) {
      addLog('ERROR: Launch not initialized');
      return;
    }

    try {
      setIsLoading(true);
      const withdrawAmount = new BN(2 * 1e9); // 2 SOL
      addLog(`Withdrawing ${withdrawAmount.toNumber() / 1e9} SOL...`);
      const { signature } = await sdk.withdraw({
        launch: launchState,
        amountLamports: withdrawAmount,
      });
      addLog(`SUCCESS: Withdrawal made - Signature: ${signature}`);
      await fetchLaunchData();
      await fetchUserData();
      await fetchBalance();
    } catch (error) {
      addLog(`ERROR: Failed to withdraw - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, fetchBalance, fetchLaunchData, fetchUserData]);

  const claimRefund = useCallback(async () => {
    if (!sdk || !launchState) {
      addLog('ERROR: Launch not initialized');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Claiming refund...');
      const { signature } = await sdk.claimRefund({ launch: launchState });
      addLog(`SUCCESS: Refund claimed - Signature: ${signature}`);
      await fetchUserData();
    } catch (error) {
      addLog(`ERROR: Failed to claim refund - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, fetchUserData]);

  const claimTokens = useCallback(async () => {
    if (!sdk || !launchState || !saleMint) {
      addLog('ERROR: Launch or sale mint not initialized');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Claiming tokens...');
      const { userAta, signature } = await sdk.claimTokens({
        launch: launchState,
        saleMint: saleMint.publicKey,
        createAtaIfMissing: true,
      });
      addLog(`SUCCESS: Tokens claimed - Signature: ${signature}`);
      addLog(`User ATA: ${userAta.toString()}`);
      await fetchUserData();
    } catch (error) {
      addLog(`ERROR: Failed to claim tokens - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, saleMint, fetchUserData]);

  const requestFaucet = useCallback(async () => {
    const activePublicKey = testWallet?.publicKey || publicKey;
    if (!activePublicKey) {
      addLog('ERROR: No wallet available (connect wallet or create test wallet)');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Requesting 1000 SOL from faucet...');
      addLog(`Requesting for address: ${activePublicKey.toString()}`);
      
      // Request airdrop from faucet
      const signature = await connection.requestAirdrop(
        activePublicKey,
        1000 * 1e9 // 10 SOL in lamports
      );
      
      addLog(`Airdrop signature: ${signature}`);
      addLog('Waiting for confirmation...');
      
      // Wait for confirmation
      await connection.confirmTransaction(signature);
      
      addLog('Transaction confirmed, updating balance...');
      
      // Update balance
      await fetchBalance();
      
      // Get fresh balance for logging
      const freshBalance = await connection.getBalance(activePublicKey);
      
      addLog(`SUCCESS: Faucet request completed - Signature: ${signature}`);
      addLog(`New balance: ${(freshBalance / 1e9).toFixed(2)} SOL`);
    } catch (error) {
      addLog(`ERROR: Failed to request faucet - ${error}`);
      console.error('Faucet error details:', error);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, testWallet, fetchBalance]);

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared');
  };

  const resetState = () => {
    setLaunchState(null);
    setSaleMint(null);
    setEscrow(null);
    setRoster(null);
    setSelection(null);
    setLaunchData(null);
    setUserContributions(null);
    setSelectionData(null);
    setCurrentProjectId(null);
    addLog('State reset');
  };

  const loadProject = useCallback(async (project: any) => {
    try {
      setIsLoading(true);
      addLog(`Loading project: ${project.name}`);
      
      // Step by step restoration with error handling
      try {
        addLog('Restoring launch state...');
        setLaunchState(new PublicKey(project.launchState));
      } catch (error) {
        addLog(`ERROR: Failed to restore launch state - ${error}`);
        throw error;
      }
      
      try {
        addLog('Restoring sale mint...');
        // Handle both old format (string) and new format (object with secretKey)
        let restoredSaleMint: Keypair;
        if (typeof project.saleMint === 'string') {
          // Old format - only public key, create a dummy keypair
          addLog('WARNING: Project saved in old format, saleMint keypair cannot be fully restored');
          restoredSaleMint = { publicKey: new PublicKey(project.saleMint) } as Keypair;
        } else {
          // New format - full keypair with secret key
          restoredSaleMint = Keypair.fromSecretKey(new Uint8Array(project.saleMint.secretKey));
        }
        setSaleMint(restoredSaleMint);
      } catch (error) {
        addLog(`ERROR: Failed to restore sale mint - ${error}`);
        throw error;
      }
      
      try {
        addLog('Restoring other accounts...');
        setEscrow(project.escrow ? new PublicKey(project.escrow) : null);
        setRoster(project.roster ? new PublicKey(project.roster) : null);
        setSelection(project.selection ? new PublicKey(project.selection) : null);
      } catch (error) {
        addLog(`ERROR: Failed to restore accounts - ${error}`);
        throw error;
      }
      
      try {
        addLog('Restoring configuration and data...');
        setLaunchConfig(project.launchConfig || defaultConfig);
        
        // Helper function to convert strings/numbers back to BN objects
        const convertToBN = (obj: any): any => {
          if (obj && typeof obj === 'object') {
            if (typeof obj === 'number') {
              return new BN(obj);
            }
            if (typeof obj === 'string' && !isNaN(Number(obj))) {
              // Check if this looks like a BN value (large numbers)
              return new BN(obj);
            }
            if (Array.isArray(obj)) {
              return obj.map(convertToBN);
            }
            const converted: any = {};
            for (const key in obj) {
              converted[key] = convertToBN(obj[key]);
            }
            return converted;
          }
          return obj;
        };
        
        // Restore launch data with proper BN conversion
        if (project.launchData) {
          const restoredLaunchData = convertToBN(project.launchData);
          setLaunchData(restoredLaunchData);
        }
        
        // Restore user contributions with proper BN conversion
        if (project.userContributions) {
          const restoredUserContributions = convertToBN(project.userContributions);
          setUserContributions(restoredUserContributions);
        }
        
        setCurrentProjectId(project.id);
      } catch (error) {
        addLog(`ERROR: Failed to restore data - ${error}`);
        throw error;
      }
      
      addLog(`SUCCESS: Project "${project.name}" loaded`);
    } catch (error) {
      addLog(`ERROR: Failed to load project - ${error}`);
      // Reset to safe state
      resetState();
    } finally {
      setIsLoading(false);
    }
  }, [defaultConfig]);

  const deleteProject = useCallback((projectId: string) => {
    const updatedProjects = savedProjects.filter(p => p.id !== projectId);
    setSavedProjects(updatedProjects);
    localStorage.setItem('savedProjects', JSON.stringify(updatedProjects));
    
    if (currentProjectId === projectId) {
      resetState();
    }
    
    addLog('Project deleted');
  }, [savedProjects, currentProjectId]);

  // Load all projects from blockchain
  const loadBlockchainProjects = useCallback(async () => {
    if (!sdk) {
      addLog('ERROR: SDK not initialized');
      return;
    }

    try {
      setIsLoadingProjects(true);
      addLog('Loading projects from blockchain...');
      
      // Debug: Check what functions are available in SDK
      addLog(`SDK functions available: ${Object.keys(sdk).join(', ')}`);
      
      if (!sdk.fetchAllProjects) {
        addLog('ERROR: fetchAllProjects function not found in SDK');
        return;
      }
      
      const projects = await sdk.fetchAllProjects();
      setBlockchainProjects(projects);
      
      addLog(`SUCCESS: Loaded ${projects.length} projects from blockchain`);
    } catch (error) {
      addLog(`ERROR: Failed to load projects from blockchain - ${error}`);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [sdk]);

  // Load project by ID
  const loadProjectById = useCallback(async (projectId: number) => {
    if (!sdk) {
      addLog('ERROR: SDK not initialized');
      return;
    }

    try {
      setIsLoading(true);
      addLog(`Loading project #${projectId} from blockchain...`);
      
      // First, let's check if the project exists
      addLog(`Searching for project #${projectId}...`);
      
      if (!sdk.findProjectById) {
        addLog('ERROR: findProjectById function not found in SDK');
        addLog(`Available SDK functions: ${Object.keys(sdk).join(', ')}`);
        return;
      }
      
      const project = await sdk.findProjectById(projectId);
      
      if (!project) {
        addLog(`ERROR: Project #${projectId} not found in blockchain`);
        
        // Let's also try to get all projects to see what's available
        addLog('Fetching all available projects...');
        const allProjects = await sdk.fetchAllProjects();
        addLog(`Found ${allProjects.length} projects in blockchain:`);
        allProjects.forEach((p: any) => {
          addLog(`  - Project #${p.projectId} (Launch: ${p.launchPda.toString().slice(0, 8)}...)`);
        });
        return;
      }

      addLog(`Found project #${projectId}, loading...`);
      addLog(`Launch PDA: ${project.launchPda.toString()}`);
      addLog(`Sale Mint: ${project.saleMint.toString()}`);

      // Set the project data
      setLaunchState(project.launchPda);
      setSaleMint({ publicKey: project.saleMint } as Keypair); // We can't restore the full keypair, but we can use the public key
      
      // Derive other PDAs
      addLog('Deriving PDAs...');
      const pdas = sdk.deriveAllPdas(project.saleMint);
      setEscrow(pdas.escrow);
      setRoster(pdas.roster);
      setSelection(pdas.selection);
      
      addLog(`Escrow PDA: ${pdas.escrow.toString()}`);
      addLog(`Roster PDA: ${pdas.roster.toString()}`);
      addLog(`Selection PDA: ${pdas.selection.toString()}`);
      
      // Fetch current data
      addLog('Fetching launch data...');
      await fetchLaunchData();
      addLog('Fetching user data...');
      await fetchUserData();
      
      addLog(`SUCCESS: Project #${projectId} loaded from blockchain`);
    } catch (error) {
      addLog(`ERROR: Failed to load project #${projectId} - ${error}`);
      console.error('Detailed error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [sdk]); // Removed function dependencies

  // Search for project by ID
  const searchProjectById = useCallback(async () => {
    const projectId = parseInt(projectSearchId);
    if (isNaN(projectId)) {
      addLog('ERROR: Please enter a valid project ID number');
      return;
    }
    
    await loadProjectById(projectId);
  }, [projectSearchId, loadProjectById]);

  // Load saved projects on component mount
  useEffect(() => {
    const saved = localStorage.getItem('savedProjects');
    if (saved) {
      try {
        const projects = JSON.parse(saved);
        // Validate project structure
        const validProjects = projects.filter((project: any) => {
          return project.id && project.name && project.launchState;
        });
        setSavedProjects(validProjects);
        addLog(`Loaded ${validProjects.length} saved projects`);
        
        if (validProjects.length !== projects.length) {
          addLog(`WARNING: ${projects.length - validProjects.length} invalid projects were filtered out`);
        }
      } catch (error) {
        addLog('ERROR: Failed to load saved projects - clearing corrupted data');
        localStorage.removeItem('savedProjects');
        setSavedProjects([]);
      }
    }
  }, []);

  // Auto-refresh data when launch state changes
  useEffect(() => {
    if (launchState && sdk) {
      try {
        fetchLaunchData();
        fetchUserData();
      } catch (error) {
        addLog(`ERROR: Failed to refresh data after state change - ${error}`);
      }
    }
  }, [launchState, sdk, fetchLaunchData, fetchUserData]);

  // Auto-fetch balance when wallet connects or test wallet changes
  useEffect(() => {
    if (publicKey || testWallet) {
      fetchBalance();
    }
  }, [publicKey, testWallet, fetchBalance]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleRunFullFlow = useCallback(async () => {
    if (!sdk || !program) {
      addLog('ERROR: SDK not initialized. Please connect wallet and initialize SDK.');
      return;
    }

    setIsFlowRunning(true);
    addLog('--- RUNNING FULL TEST FLOW ---');
    
    const result = await runFullFlow(sdk, program, sdk.program.provider, launchConfig, addLog, simConfig);

    if (result.success) {
      addLog('--- ✅ FULL TEST FLOW COMPLETED SUCCESSFULLY ---');
    } else {
      addLog(`--- ❌ FULL TEST FLOW FAILED: ${result.message} ---`);
    }

    setIsFlowRunning(false);
  }, [sdk, program, launchConfig, addLog, simConfig]);

  return (
    <ErrorBoundary>
      <div className="space-y-4">
      {/* Launch Configuration Form */}
      <div className="terminal-card">
        <div className="flex justify-between items-center mb-4">
          <div className="terminal-prompt">
            <span className="terminal-glow">config@engine:~$</span>
            <span className="terminal-command ml-2">launch-parameters</span>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-xs terminal-output">
                Balance: <span className="terminal-success">{(balance / 1e9).toFixed(2)} SOL</span>
              </span>
              <button 
                onClick={requestFaucet} 
                className="terminal-button text-xs bg-yellow-600 hover:bg-yellow-500"
                disabled={(!publicKey && !testWallet) || isLoading}
              >
                💧 Request 1000 SOL
              </button>
            </div>
            <label className="flex items-center space-x-2 text-xs">
              <input
                type="checkbox"
                checked={showLaunchForm}
                onChange={(e) => setShowLaunchForm(e.target.checked)}
                className="terminal-input"
              />
              <span className="terminal-output">Customize Parameters</span>
            </label>
            <button 
              onClick={() => {
                setShowProjectManager(!showProjectManager);
                if (!showProjectManager) {
                  setIsProjectManagerCollapsed(false);
                }
              }} 
              className="terminal-button text-xs bg-blue-600 hover:bg-blue-500"
            >
              📁 Projects ({blockchainProjects.length}) {showProjectManager && !isProjectManagerCollapsed ? '▼' : '▶'}
            </button>
            <button onClick={resetState} className="terminal-button text-xs">
              Reset State
            </button>
          </div>
        </div>
        
        {showLaunchForm && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-black bg-opacity-30 rounded border">
            {/* --- Launch Parameters --- */}
            <div className="col-span-full">
              <h3 className="text-sm font-bold terminal-glow mb-2">Launch Parameters</h3>
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Hard Cap (SOL)</label>
              <input
                type="number"
                value={launchConfig.hardCapLamports / 1e9}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, hardCapLamports: parseFloat(e.target.value) * 1e9 }))}
                className="terminal-input w-full"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Min Raise (SOL)</label>
              <input
                type="number"
                value={launchConfig.minRaiseLamports / 1e9}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, minRaiseLamports: parseFloat(e.target.value) * 1e9 }))}
                className="terminal-input w-full"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Per Wallet Cap (SOL)</label>
              <input
                type="number"
                value={launchConfig.perWalletCap / 1e9}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, perWalletCap: parseFloat(e.target.value) * 1e9 }))}
                className="terminal-input w-full"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Tau (SOL)</label>
              <input
                type="number"
                value={launchConfig.tauLamports / 1e9}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, tauLamports: parseFloat(e.target.value) * 1e9 }))}
                className="terminal-input w-full"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Sale Allocation</label>
              <input
                type="number"
                value={launchConfig.saleAllocation}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, saleAllocation: parseInt(e.target.value) }))}
                className="terminal-input w-full"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">LP Allocation</label>
              <input
                type="number"
                value={launchConfig.lpAllocation}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, lpAllocation: parseInt(e.target.value) }))}
                className="terminal-input w-full"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Funding Duration</label>
              <select
                value={launchConfig.fundingDurationDays}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, fundingDurationDays: parseInt(e.target.value) }))}
                className="terminal-input w-full"
              >
                <option value={0}>10 seconds (testing)</option>
                <option value={1}>30 seconds (testing)</option>
                <option value={2}>2 days</option>
                <option value={3}>3 days</option>
                <option value={4}>4 days</option>
                <option value={5}>5 days</option>
              </select>
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Num Blocks (Window)</label>
              <input
                type="number"
                value={launchConfig.numBlocks}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, numBlocks: parseInt(e.target.value) }))}
                className="terminal-input w-full"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Creator Initial Deposit (SOL)</label>
              <input
                type="number"
                value={launchConfig.creatorInitialDepositLamports / 1e9}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, creatorInitialDepositLamports: parseFloat(e.target.value) * 1e9 }))}
                className="terminal-input w-full"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Creator Daily Limit (SOL)</label>
              <input
                type="number"
                value={launchConfig.creatorDailyLamportsLimit / 1e9}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, creatorDailyLamportsLimit: parseFloat(e.target.value) * 1e9 }))}
                className="terminal-input w-full"
                step="0.1"
              />
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Creator Claim Lock (s)</label>
              <input
                type="number"
                value={launchConfig.creatorClaimLockPeriodSec}
                onChange={(e) => setLaunchConfig(prev => ({ ...prev, creatorClaimLockPeriodSec: parseInt(e.target.value) }))}
                className="terminal-input w-full"
              />
            </div>
            {/* --- Simulation Parameters --- */}
            <div className="col-span-full mt-4">
               <h3 className="text-sm font-bold terminal-glow mb-2">Simulation Parameters</h3>
            </div>
            <div>
              <label className="block text-xs terminal-output mb-1">Number of Users</label>
              <input
                type="number"
                value={simConfig.numUsers}
                onChange={(e) => setSimConfig(prev => ({ ...prev, numUsers: parseInt(e.target.value) || 0 }))}
                className="terminal-input w-full"
              />
            </div>
          </div>
        )}

        {/* Project Manager Panel */}
        {showProjectManager && (
          <div className="mt-4 p-4 bg-black bg-opacity-30 rounded border">
            <div className="flex justify-between items-center mb-4">
              <div className="terminal-prompt text-sm">
                <span className="terminal-glow">projects@engine:~$</span>
                <span className="terminal-command ml-2">blockchain-manage</span>
              </div>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setIsProjectManagerCollapsed(!isProjectManagerCollapsed)}
                  className="terminal-button text-xs"
                >
                  {isProjectManagerCollapsed ? '▼ Expand' : '▲ Collapse'}
                </button>
                <button 
                  onClick={loadBlockchainProjects}
                  className="terminal-button text-xs bg-green-600 hover:bg-green-500"
                  disabled={!sdk || isLoadingProjects}
                >
                  🔄 Refresh Projects
                </button>
              </div>
            </div>
            
            {!isProjectManagerCollapsed && (
              <>
            
            {/* Project Search */}
            <div className="mb-4 p-3 bg-black bg-opacity-50 rounded border">
              <div className="terminal-prompt mb-2 text-xs">
                <span className="terminal-glow">search@engine:~$</span>
                <span className="terminal-command ml-2">find-project-by-id</span>
              </div>
              <div className="flex space-x-2">
                <input
                  type="number"
                  placeholder="Enter Project ID..."
                  value={projectSearchId}
                  onChange={(e) => setProjectSearchId(e.target.value)}
                  className="terminal-input flex-1"
                />
                <button
                  onClick={searchProjectById}
                  className="terminal-button text-xs"
                  disabled={!projectSearchId || isLoading}
                >
                  🔍 Load Project
                </button>
              </div>
            </div>
            
            {/* Blockchain Projects List */}
            {blockchainProjects.length === 0 ? (
              <div className="text-xs terminal-output text-center py-4">
                No projects found on blockchain. Click "Refresh Projects" to load them.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="terminal-prompt mb-2 text-xs">
                  <span className="terminal-glow">list@engine:~$</span>
                  <span className="terminal-command ml-2">blockchain-projects</span>
                </div>
                {blockchainProjects.map((project) => (
                  <div 
                    key={project.projectId} 
                    className={`flex items-center justify-between p-3 rounded border ${
                      launchData?.projectId && safeToNumber(launchData.projectId) === project.projectId
                        ? 'bg-green-900 bg-opacity-30 border-green-400' 
                        : 'bg-gray-900 bg-opacity-30 border-gray-600'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs terminal-success font-bold">
                          Project #{project.projectId}
                        </span>
                        {launchData?.projectId && safeToNumber(launchData.projectId) === project.projectId && (
                          <span className="text-xs terminal-success">(ACTIVE)</span>
                        )}
                      </div>
                      <div className="text-xs terminal-output mt-1">
                        Launch PDA: {project.launchPda.toString().slice(0, 8)}...
                      </div>
                      <div className="text-xs terminal-output">
                        Sale Mint: {project.saleMint.toString().slice(0, 8)}...
                      </div>
                      <div className="text-xs terminal-output">
                        Funding Period End: {new Date(safeToNumber(project.account.fundingPeriodEnd) * 1000).toLocaleString()}
                      </div>
                      <div className="text-xs terminal-output">
                        Total Deposited: {(safeToNumber(project.account.totalDeposited) / 1e9).toFixed(2)} SOL
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => loadProjectById(project.projectId)}
                        className="terminal-button text-xs"
                        disabled={isLoading}
                      >
                        Load
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Legacy Saved Projects (for backward compatibility) */}
            {savedProjects.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-600">
                <div className="terminal-prompt mb-2 text-xs">
                  <span className="terminal-glow">legacy@engine:~$</span>
                  <span className="terminal-command ml-2">saved-projects</span>
                </div>
                <div className="text-xs terminal-output mb-2">
                  Legacy saved projects (localStorage):
                </div>
                <div className="space-y-2">
                  {savedProjects.map((project) => (
                    <div 
                      key={project.id} 
                      className="flex items-center justify-between p-2 rounded border bg-gray-800 bg-opacity-30 border-gray-700"
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs terminal-output">
                            {project.name}
                          </span>
                          {currentProjectId === project.id && (
                            <span className="text-xs terminal-success">(ACTIVE)</span>
                          )}
                        </div>
                        <div className="text-xs terminal-output">
                          Project ID: {project.projectId ? `#${project.projectId}` : 'Unknown'}
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => loadProject(project)}
                          className="terminal-button text-xs"
                          disabled={isLoading}
                        >
                          Load
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete project "${project.name}"?`)) {
                              deleteProject(project.id);
                            }
                          }}
                          className="terminal-button text-xs bg-red-600 hover:bg-red-500"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Grid */}
      <div className="terminal-grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Status Panel */}
        <div className="terminal-card">
          <div className="terminal-prompt mb-4">
            <span className="terminal-glow">system@engine:~$</span>
            <span className="terminal-command ml-2">status</span>
          </div>
          
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="terminal-output">Current Project:</span>
              <span className={launchData?.projectId ? 'terminal-success' : 'terminal-error'}>
                {launchData?.projectId ? `Project #${safeToNumber(launchData.projectId)}` : 'NONE'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="terminal-output">Project ID:</span>
              <span className={launchData?.projectId ? 'terminal-success' : 'terminal-error'}>
                {launchData?.projectId ? `#${safeToNumber(launchData.projectId)}` : 'NONE'}
              </span>
            </div>
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

          {/* Launch Data Display */}
          {launchData && (
            <div className="mt-4 pt-4 border-t border-gray-600">
              <div className="terminal-prompt mb-2 text-xs">Launch Data:</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="terminal-output">Project ID:</span>
                  <span className="terminal-success">
                    #{safeToNumber(launchData.projectId)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Funding Period End:</span>
                  <span className="terminal-success">
                    {new Date(safeToNumber(launchData.fundingPeriodEnd) * 1000).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Funding Active:</span>
                  <span className={Date.now() / 1000 < safeToNumber(launchData.fundingPeriodEnd) ? 'terminal-success' : 'terminal-error'}>
                    {Date.now() / 1000 < safeToNumber(launchData.fundingPeriodEnd) ? 'YES' : 'NO'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Total Deposited:</span>
                  <span className="terminal-success">
                    {(safeToNumber(launchData.totalDeposited) / 1e9).toFixed(2)} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Total Tickets:</span>
                  <span className="terminal-success">{launchData.totalTickets || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Selection Finalized:</span>
                  <span className={launchData.selectionFinalized ? 'terminal-success' : 'terminal-error'}>
                    {launchData.selectionFinalized ? 'YES' : 'NO'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Claims Open:</span>
                  <span className={launchData.claimsOpen ? 'terminal-success' : 'terminal-error'}>
                    {launchData.claimsOpen ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>
            </div>
          )}
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
              disabled={(!publicKey && !testWallet) || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Initialize SDK
            </button>
            
            <button 
              onClick={initLaunch}
              className="terminal-button w-full text-left"
              disabled={!sdk || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Init Launch
            </button>
            
            <div className="my-2 border-t border-gray-600"></div>
            
            <button 
              onClick={async () => {
                if (!sdk || !launchState) return;
                try {
                  setIsLoading(true);
                  addLog('Initializing roster shard 0...');
                  const { signature } = await sdk.initRosterShard({
                    launch: launchState,
                    shardId: 0,
                  });
                  addLog(`SUCCESS: Roster shard 0 initialized - Signature: ${signature}`);
                } catch (error) {
                  addLog(`ERROR: Failed to initialize roster shard - ${error}`);
                } finally {
                  setIsLoading(false);
                }
              }}
              className="terminal-button w-full text-left"
              disabled={!launchState || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Init Roster Shard
            </button>
            
            
            <button 
              onClick={setSeed}
              className="terminal-button w-full text-left"
              disabled={!launchState || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Set VRF Seed
            </button>
            
            <button 
              onClick={async () => {
                if (!sdk || !launchState) return;
                try {
                  setIsLoading(true);
                  addLog('Finalizing roster shard 0...');
                  const { signature } = await sdk.finalizeRosterShard({
                    launch: launchState,
                    shardId: 0,
                  });
                  addLog(`SUCCESS: Roster shard 0 finalized - Signature: ${signature}`);
                } catch (error) {
                  addLog(`ERROR: Failed to finalize roster shard - ${error}`);
                } finally {
                  setIsLoading(false);
                }
              }}
              className="terminal-button w-full text-left"
              disabled={!launchState || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Finalize Roster Shard
            </button>
            
            <button 
              onClick={async () => {
                if (!sdk || !launchState) return;
                try {
                  setIsLoading(true);
                  addLog('Opening claims...');
                  const { signature } = await sdk.openClaims({
                    launch: launchState,
                  });
                  addLog(`SUCCESS: Claims opened - Signature: ${signature}`);
                  await fetchLaunchData();
                } catch (error) {
                  addLog(`ERROR: Failed to open claims - ${error}`);
                } finally {
                  setIsLoading(false);
                }
              }}
              className="terminal-button w-full text-left"
              disabled={!launchState || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Open Claims
            </button>
            
            
            <div className="my-4 border-t-2 border-dashed border-gray-600"></div>

            <button 
              onClick={handleRunFullFlow}
              className="terminal-button w-full text-left bg-green-700 hover:bg-green-600 disabled:bg-gray-600"
              disabled={!sdk || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> ▶️ Run Full E2E Flow
            </button>
          </div>
        </div>

        {/* User Actions Panel */}
        <div className="terminal-card">
          <div className="terminal-prompt mb-4">
            <span className="terminal-glow">user@engine:~$</span>
            <span className="terminal-command ml-2">actions</span>
          </div>
          
          <div className="space-y-2">
            <button 
              onClick={deposit}
              className="terminal-button w-full text-left"
              disabled={!launchState || !roster || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Deposit (2 SOL)
            </button>
            
            <button 
              onClick={withdraw}
              className="terminal-button w-full text-left"
              disabled={!launchState || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Withdraw (2 SOL)
            </button>
            
            <button 
              onClick={claimRefund}
              className="terminal-button w-full text-left"
              disabled={!launchState || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Claim Refund
            </button>
            
            <button 
              onClick={claimTokens}
              className="terminal-button w-full text-left"
              disabled={!launchState || !saleMint || isLoading || isFlowRunning}
            >
              <span className="terminal-prompt">$</span> Claim Tokens
            </button>
          </div>

          {/* User Data Display */}
          {userContributions && (
            <div className="mt-4 pt-4 border-t border-gray-600">
              <div className="terminal-prompt mb-2 text-xs">User Data:</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="terminal-output">Deposited:</span>
                  <span className="terminal-success">
                    {(safeToNumber(userContributions.deposited) / 1e9).toFixed(2)} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Claimed Refund:</span>
                  <span className={userContributions.claimedRefund ? 'terminal-success' : 'terminal-error'}>
                    {userContributions.claimedRefund ? 'YES' : 'NO'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Claimed Tokens:</span>
                  <span className={userContributions.claimedTokens ? 'terminal-success' : 'terminal-error'}>
                    {userContributions.claimedTokens ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Flow Guide */}
      <div className="terminal-card">
        <div className="terminal-prompt mb-4">
          <span className="terminal-glow">guide@engine:~$</span>
          <span className="terminal-command ml-2">testing-flow</span>
        </div>
        <div className="text-xs terminal-output space-y-1">
          <div><span className="terminal-success">1.</span> Initialize SDK</div>
          <div><span className="terminal-success">2.</span> Init Launch</div>
          <div><span className="terminal-success">3.</span> Init Roster Shard <span className="terminal-error">(Required before deposits!)</span></div>
          <div><span className="terminal-success">4.</span> Deposit SOL (Wait for funding period to start)</div>
          <div><span className="terminal-success">5.</span> Wait for Funding Period to End</div>
          <div><span className="terminal-success">6.</span> Set VRF Seed</div>
          <div><span className="terminal-success">7.</span> Finalize Roster Shard</div>
          <div><span className="terminal-success">8.</span> Open Claims</div>
          <div><span className="terminal-success">9.</span> Claim Tokens/Refund</div>
        </div>
      </div>

      {/* Logs Panel */}
      <div className="terminal-card">
        <div className="flex justify-between items-center mb-4">
          <div className="terminal-prompt">
            <span className="terminal-glow">logs@engine:~$</span>
            <span className="terminal-command ml-2">tail -f</span>
          </div>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 text-xs">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="terminal-input"
              />
              <span className="terminal-output">Auto-scroll</span>
            </label>
            <button onClick={clearLogs} className="terminal-button text-xs">
              Clear Logs
            </button>
          </div>
        </div>
        
        <div ref={logContainerRef} className="terminal-scroll bg-black bg-opacity-50 p-3 rounded border max-h-64">
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
    </ErrorBoundary>
  );
}

export default EngineDemo;