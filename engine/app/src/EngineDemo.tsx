import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import EngineSDK from '../../ts-sdk/src/engine';
import type { LaunchConfig } from './types/launch';
import { depositUsersParallel, fundUsersParallel, getChainTimeSec, preparePoolCreationWithRetry, mintForTestSafe, type SimUser } from './utils/flowHelpers';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { runFullFlow } from './utils/flowRunner';
import { executeClmmSwapSmokeTest, fetchClmmPoolSnapshot, performClmmSwap, type ClmmPoolSnapshot } from './utils/poolHelpers';

// Launch configuration interface

// --- New interface for simulation parameters ---
interface SimulationConfig {
  numUsers: number;
  maxTicketsPerUser: number;
  useTestMintForBase?: boolean;
}

// Error boundary component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error?: Error }> {
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

  
  const [sdk, setSdk] = useState<ReturnType<typeof EngineSDK.create> | null>(null);
  const [program, setProgram] = useState<any>(null);
  const [launchState, setLaunchState] = useState<PublicKey | null>(null);
  const [baseMint, setBaseMint] = useState<Keypair | null>(null);
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
  const [poolStateData, setPoolStateData] = useState<any | null>(null);
  const [raydiumPoolInfo, setRaydiumPoolInfo] = useState<ClmmPoolSnapshot | null>(null);
  const [isPoolInfoLoading, setIsPoolInfoLoading] = useState(false);
  const [swapDirection, setSwapDirection] = useState<'buy' | 'sell'>('buy');
  const [swapAmount, setSwapAmount] = useState('0.1');
  const [swapPending, setSwapPending] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);

  // --- New state for custom duration ---
  const [durationOption, setDurationOption] = useState('dropdown'); // 'dropdown' or 'custom'

  // --- New state for the full flow runner ---
  const [isFlowRunning, setIsFlowRunning] = useState(false);
  const [faucetAmount, setFaucetAmount] = useState(1000);

  // Helper to get seconds from dropdown value
  const getSecondsFromDropdown = (daysValue: number) => {
    switch (daysValue) {
      case 0: return 10;
      case 1: return 30;
      case 2: return 60;
      case 3: return 2 * 24 * 60 * 60;
      case 4: return 3 * 24 * 60 * 60;
      case 5: return 4 * 24 * 60 * 60;
      case 6: return 5 * 24 * 60 * 60;
      default: return 10;
    }
  };

  // Helper function to convert UI selection to seconds
  const getFundingDurationInSeconds = (): number => {
    if (durationOption === 'custom') {
      return launchConfig.fundingDurationSeconds;
    }
    return getSecondsFromDropdown(launchConfig.fundingDurationDays ?? 0);
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

  const formatTokenAmount = (value?: number, decimals = 9) => {
    if (value === undefined || value === null) return "0.0000";
    return (value / Math.pow(10, decimals)).toFixed(4);
  };

  const toPublicKey = (value: any): PublicKey | null => {
    if (!value) return null;
    if (value instanceof PublicKey) return value;
    try {
      if (typeof value === 'string') return new PublicKey(value);
      if (value?.toString) return new PublicKey(value.toString());
    } catch (_) {
      return null;
    }
    return null;
  };

  // Default launch configuration (matching tests)
  const defaultConfig: LaunchConfig = {
    hardCapLamports: 450 * 1e9, // 20,000 SOL for large tests
    minRaiseLamports: 100 * 1e9, // 1,000 SOL
    perWalletCap: 5 * 1e9, // 5 SOL
    tauLamports: 1 * 1e9, // 1 SOL
    // Target allocations for 1B total: Sale 48.14%, Team 11.12%, LP 40.74%
    // Provide human units; SDK will scale to atomic; base_total_allocation = 1,000,000,000
    saleAllocation: '481400000',
    lpAllocation: 407400000,
    fundingDurationDays: 0, // 10 seconds for quick testing
    fundingDurationSeconds: 15, // Default custom seconds
    unlockTimeSec: 1, // 1 sec for fast test
    rosterShardCap: 250, // Safe size for Solana account limits (250 * 40 bytes = 10,000 bytes)
    creatorInitialDepositLamports: 8 * 1e9, // 8 SOL creator deposit
    creatorDailyLamportsLimit: 1 * 1e9, // 1 SOL daily limit
    creatorClaimLockPeriodSec: 2, // 2 seconds for testing
    creatorMaxDepositLamports: 8 * 1e9,
    poolCreationGracePeriodSec: 360,
    // Raydium defaults (WSOL; ammConfig/clmmProgram optional)
    quoteMint: 'So11111111111111111111111111111111111111112',
    ammConfig: '',
    clmmProgram: '',
    teamVestingDurationSec: 1,
    // Team share inside 1B total supply
    teamAllocationBasisPoints: 1112,
  };

  // --- New state for simulation config ---
  const defaultSimConfig: SimulationConfig = {
    numUsers: 100,
    maxTicketsPerUser: 3,
    useTestMintForBase: false,
  };

  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(defaultConfig);
  const [simConfig, setSimConfig] = useState<SimulationConfig>(defaultSimConfig);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    setLogs(prev => [...prev, logEntry]);
  };
  const resolvedBaseMintPk = toPublicKey(baseMint?.publicKey || launchData?.clmmBaseMint || launchData?.baseMint);
  const resolvedQuoteMintPk = toPublicKey(launchConfig.quoteMint || 'So11111111111111111111111111111111111111112');
  const raydiumPoolPublicKey = poolStateData?.raydiumPoolState ? toPublicKey(poolStateData.raydiumPoolState) : null;
  const poolClaimsReady = !!poolStateData?.claimsReady;

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

  const refreshPoolInfo = useCallback(async (targetLaunch?: PublicKey) => {
    if (!sdk) return;
    const launchPk = targetLaunch ?? launchState;
    if (!launchPk) return;
    try {
      setIsPoolInfoLoading(true);
      let poolAccount: any = null;
      try {
        poolAccount = await sdk.fetchPoolState(launchPk);
        setPoolStateData(poolAccount);
        addLog('Pool state refreshed');
      } catch (error: any) {
        setPoolStateData(null);
        setRaydiumPoolInfo(null);
        if (error?.message?.includes('Account does not exist')) {
          addLog('Pool state account not found (pool not created yet).');
        } else {
          addLog(`ERROR: Failed to fetch pool state - ${error}`);
        }
        return;
      }
      if (poolAccount?.raydiumPoolState) {
        try {
          const poolId = new PublicKey(
            typeof poolAccount.raydiumPoolState === 'string'
              ? poolAccount.raydiumPoolState
              : poolAccount.raydiumPoolState.toString()
          );
          const snapshot = await fetchClmmPoolSnapshot({
            provider: sdk.program.provider,
            poolId,
            signer: testWallet || null,
          });
          setRaydiumPoolInfo(snapshot);
        } catch (snapshotError) {
          setRaydiumPoolInfo(null);
          addLog(`ERROR: Failed to load Raydium pool snapshot - ${snapshotError}`);
        }
      } else {
        setRaydiumPoolInfo(null);
      }
    } finally {
      setIsPoolInfoLoading(false);
    }
  }, [sdk, launchState, addLog, testWallet]);

  const handleManualSwap = useCallback(async () => {
    if (!sdk) {
      addLog('ERROR: SDK not initialized');
      return;
    }
    if (!launchState || !raydiumPoolPublicKey) {
      setSwapStatus('Pool not created yet.');
      return;
    }
    if (!resolvedBaseMintPk || !resolvedQuoteMintPk) {
      setSwapStatus('Missing mint information.');
      return;
    }
    const parsedAmount = parseFloat(swapAmount);
    if (!parsedAmount || parsedAmount <= 0) {
      setSwapStatus('Enter a valid amount.');
      return;
    }
    const lamports = new BN(Math.round(parsedAmount * 1_000_000_000));
    const inputMint = swapDirection === 'buy' ? resolvedQuoteMintPk : resolvedBaseMintPk;
    try {
      setSwapPending(true);
      setSwapStatus(null);
      const { txId } = await performClmmSwap({
        provider: sdk.program.provider,
        poolId: raydiumPoolPublicKey,
        baseMint: resolvedBaseMintPk,
        quoteMint: resolvedQuoteMintPk,
        addLog,
        signer: testWallet || null,
        inputMint,
        amountIn: lamports,
      });
      const directionLabel = swapDirection === 'buy' ? 'quote→base' : 'base→quote';
      setSwapStatus(`Swap submitted (${directionLabel}). Tx: ${txId}`);
      addLog(`Manual CLMM swap submitted. Signature: ${txId}`);
      await refreshPoolInfo(raydiumPoolPublicKey);
    } catch (error: any) {
      const message = error?.message || String(error);
      setSwapStatus(`Swap failed: ${message}`);
      addLog(`ERROR: Swap failed - ${message}`);
    } finally {
      setSwapPending(false);
    }
  }, [
    sdk,
    launchState,
    raydiumPoolPublicKey,
    resolvedBaseMintPk,
    resolvedQuoteMintPk,
    swapAmount,
    swapDirection,
    addLog,
    refreshPoolInfo,
    testWallet,
  ]);


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

      // Derive launch PDA by projectId (no base mint needed at init)

      // Mint exactly 1,000,000,000 total supply; sale/team/LP are slices within this total
      const baseTotalAllocationBN = new BN('1000000000');
      const baseSaleBpsBN = baseTotalAllocationBN.isZero()
        ? new BN(0)
        : new BN(Math.floor(new BN(launchConfig.saleAllocation).toNumber() * 10000 / baseTotalAllocationBN.toNumber()));

      let lastProjectId = 0;
      try {
        const counter: any = await sdk.fetchProjectCounter();
        lastProjectId = (counter?.lastProjectId?.toNumber && counter.lastProjectId.toNumber()) || 0;
      } catch (_) {
        lastProjectId = 0;
      }
      const projectId = lastProjectId + 1;
      const kCap = Math.floor(launchConfig.hardCapLamports / launchConfig.tauLamports);
      const rosterShardsTotal = launchConfig.rosterShardsTotal && launchConfig.rosterShardsTotal > 0
        ? Math.min(65535, launchConfig.rosterShardsTotal)
        : Math.min(65535, Math.ceil(kCap / Math.max(1, launchConfig.rosterShardCap)));
      const res = await sdk.initLaunch({
        projectId,
        hardCapLamports: new BN(launchConfig.hardCapLamports),
        minRaiseLamports: new BN(launchConfig.minRaiseLamports),
        perWalletCap: new BN(launchConfig.perWalletCap),
        tauLamports: new BN(launchConfig.tauLamports),
        baseTotalAllocation: baseTotalAllocationBN,
        baseSaleBasisPoints: baseSaleBpsBN,
        fundingDurationSeconds: getFundingDurationInSeconds(),
        unlockTimeSec: launchConfig.unlockTimeSec,
        rosterShardCap: launchConfig.rosterShardCap,
        rosterShardsTotal,
        creatorInitialDepositLamports: new BN(launchConfig.creatorInitialDepositLamports),
        creatorDailyLamportsLimit: new BN(launchConfig.creatorDailyLamportsLimit),
        creatorClaimLockPeriodSec: new BN(launchConfig.creatorClaimLockPeriodSec),
        creatorMaxDepositLamports: new BN(launchConfig.creatorMaxDepositLamports || launchConfig.creatorInitialDepositLamports),
        name: `Lumi Project #${projectId}`,
        symbol: "LUMI",
        uri: "https://metadata.xyberlabs.dev/lumi/default.json",
      });
      const [launchPda] = sdk.getLaunchPdaByProjectId(projectId);
      setLaunchState(launchPda);
      setBaseMint(null);
      addLog(`SUCCESS: Launch initialized - Signature: ${res.signature}`);
      addLog(`Launch PDA: ${launchPda.toString()}`);
      addLog(`Sale Mint will be created during pool setup`);
      await fetchLaunchData();
    } catch (error) {
      addLog(`ERROR: Failed to initialize launch - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, program, publicKey, launchConfig, fetchLaunchData]);
  const simulateUsers = useCallback(async () => {
    if (!sdk || !launchState) {
      addLog('ERROR: Launch not initialized');
      return;
    }
    try {
      setIsLoading(true);
      const provider = sdk.program.provider as any;
      const admin = provider.publicKey!;
      // Guard: ensure funding period still active
      const launch = await sdk.fetchLaunch(launchState);
      const now = await getChainTimeSec(provider);
      const fundingEnd = (launch.fundingPeriodEnd as any).toNumber?.() ?? Number(launch.fundingPeriodEnd);
      const remaining = Math.max(0, fundingEnd - now);
      if (remaining <= 0) {
        addLog('ERROR: Funding period has ended. Increase Funding Duration and Init Launch again.');
        return;
      }
      addLog(`Funding window remaining ~${remaining}s`);
      const users: SimUser[] = Array.from({ length: simConfig.numUsers }, (_, i) => {
        const keypair = Keypair.generate();
        const tickets = Math.floor(Math.random() * simConfig.maxTicketsPerUser) + 1;
        const depositAmount = new BN(launchConfig.tauLamports * tickets);
        const shardId = Math.floor(i / launchConfig.rosterShardCap);
        return { keypair, tickets, depositAmount, shardId };
      });
      await fundUsersParallel({ provider, admin, users, addLog });
      await depositUsersParallel({ sdk, launchPda: launchState, users, addLog });
      addLog('SUCCESS: Users funded and deposited');
    } catch (e) {
      addLog(`ERROR: Simulation failed - ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, launchConfig, simConfig]);



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
      const beforeLamports = await connection.getBalance((testWallet?.publicKey || publicKey)!);
      const activePublicKey = testWallet?.publicKey || publicKey;
      let shardId: number | undefined = undefined;
      try {
        if (activePublicKey) {
          const uc = await sdk.fetchUserContribution(launchState, activePublicKey);
          shardId = (uc as any).shardId ?? (uc as any).shard_id ?? undefined;
        }
      } catch {}
      const { signature } = await sdk.claimRefund({ launch: launchState, shardId });
      const afterLamports = await connection.getBalance((testWallet?.publicKey || publicKey)!);
      const netDelta = (afterLamports - beforeLamports) / 1e9;
      addLog(`SUCCESS: Refund claimed - Signature: ${signature}`);
      addLog(`Refund received (approx, net of fee): ${netDelta.toFixed(6)} SOL`);
      await fetchUserData();
    } catch (error) {
      addLog(`ERROR: Failed to claim refund - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, fetchUserData]);

  const claimTokens = useCallback(async () => {
    if (!sdk || !launchState || !baseMint) {
      addLog('ERROR: Launch or sale mint not initialized');
      return;
    }

    try {
      setIsLoading(true);
      addLog('Claiming tokens...');
      const userAta = sdk.getUserAta(baseMint.publicKey, (testWallet?.publicKey || publicKey)!);
      let before = 0;
      try {
        const b = await connection.getTokenAccountBalance(userAta);
        before = parseFloat(b.value.uiAmountString || '0');
      } catch {}
      const activePublicKey = testWallet?.publicKey || publicKey;
      let shardId: number | undefined = undefined;
      try {
        if (activePublicKey) {
          const uc = await sdk.fetchUserContribution(launchState, activePublicKey);
          shardId = (uc as any).shardId ?? (uc as any).shard_id ?? undefined;
        }
      } catch {}
      const { userAta: ata, signature } = await sdk.claimTokens({
        launch: launchState,
        baseMint: baseMint.publicKey,
        shardId,
        createAtaIfMissing: true,
      });
      addLog(`SUCCESS: Tokens claimed - Signature: ${signature}`);
      addLog(`User ATA: ${ata.toString()}`);
      try {
        const a = await connection.getTokenAccountBalance(ata);
        const after = parseFloat(a.value.uiAmountString || '0');
        const delta = after - before;
        addLog(`Claimed tokens: ${delta.toFixed(6)}`);
      } catch {}
      await fetchUserData();
    } catch (error) {
      addLog(`ERROR: Failed to claim tokens - ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [sdk, launchState, baseMint, fetchUserData, publicKey, testWallet]);

  const requestFaucet = useCallback(async () => {
    const activePublicKey = testWallet?.publicKey || publicKey;
    if (!activePublicKey) {
      addLog('ERROR: No wallet available (connect wallet or create test wallet)');
      return;
    }

    try {
      setIsLoading(true);
      addLog(`Requesting ${faucetAmount} SOL from faucet...`);
      addLog(`Requesting for address: ${activePublicKey.toString()}`);

      // Request airdrop from faucet
      const signature = await connection.requestAirdrop(
        activePublicKey,
        faucetAmount * 1e9 // 10 SOL in lamports
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
  }, [publicKey, connection, testWallet, fetchBalance, faucetAmount]);

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared');
  };

  const downloadLogs = () => {
    const logContent = logs.join('\n');
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flow-runner-logs.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog('Logs downloaded as flow-runner-logs.txt');
  };

  const resetState = () => {
    setLaunchState(null);
    setBaseMint(null);
    setEscrow(null);
    setRoster(null);
    setSelection(null);
    setLaunchData(null);
    setUserContributions(null);
    setCurrentProjectId(null);
    setPoolStateData(null);
    setRaydiumPoolInfo(null);
    setSwapStatus(null);
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
        let restoredBaseMint: Keypair;
        if (typeof project.baseMint === 'string') {
          // Old format - only public key, create a dummy keypair
          addLog('WARNING: Project saved in old format, baseMint keypair cannot be fully restored');
          restoredBaseMint = { publicKey: new PublicKey(project.baseMint) } as Keypair;
        } else {
          // New format - full keypair with secret key
          restoredBaseMint = Keypair.fromSecretKey(new Uint8Array(project.baseMint.secretKey));
        }
        setBaseMint(restoredBaseMint);
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
        const restoredLaunch = toPublicKey(project.launchState);
        if (restoredLaunch) {
          await refreshPoolInfo(restoredLaunch);
        }
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
  }, [defaultConfig, refreshPoolInfo]);

  // Derived flags
  const activePublicKey = testWallet?.publicKey || publicKey;
  const creatorPk = (launchData && (launchData as any).creator) ? new PublicKey((launchData as any).creator) : null;
  const isCreator = !!(creatorPk && activePublicKey && creatorPk.equals(activePublicKey));

  const claimsOpened = !!launchData?.claimsOpenedAt;

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
      addLog(`Sale Mint: ${project.baseMint ? project.baseMint.toString() : 'N/A'}`);

      // Set the project data
      setLaunchState(project.launchPda);
      setBaseMint(project.baseMint ? ({ publicKey: project.baseMint } as Keypair) : null);

      // Derive PDAs from launch
      addLog('Deriving PDAs...');
      try {
        const [escrowPda] = sdk.getEscrowPda(project.launchPda);
        const [rosterPda] = sdk.getRosterPda(project.launchPda);
        setEscrow(escrowPda);
        setRoster(rosterPda);
        setSelection(null);
        addLog(`Escrow PDA: ${escrowPda.toString()}`);
        addLog(`Roster PDA: ${rosterPda.toString()}`);
      } catch (e) {
        addLog(`ERROR: Failed to derive PDAs - ${e}`);
      }

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
    if (sdk && launchState) {
      refreshPoolInfo();
    }
  }, [sdk, launchState]); 

  useEffect(() => {
    setSwapStatus(null);
  }, [swapDirection]);

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
    addLog(`[DEBUG] Passing saleAllocation to flowRunner: ${launchConfig.saleAllocation}`);

    try {
      const result = await runFullFlow(
        sdk,
        program,
        sdk.program.provider,
        launchConfig,
        addLog,
        simConfig
      );
      if (result.success) {
        addLog(`--- ✅ FULL TEST FLOW SUCCEEDED ---`);
      } else {
        addLog(`--- ❌ FULL TEST FLOW FAILED: ${result.message} ---`);
      }
    } catch (error: any) {
      console.error("Error in handleRunFlow:", error);
      let errorMessage = "An unexpected error occurred in the UI.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      addLog(`--- ❌ FULL TEST FLOW FAILED: ${errorMessage} ---`);
    } finally {
      await refreshPoolInfo();
      setIsFlowRunning(false);
    }
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
                <input
                  type="number"
                  value={faucetAmount}
                  onChange={(e) => setFaucetAmount(Number(e.target.value))}
                  className="terminal-input w-24"
                />
                <button
                  onClick={requestFaucet}
                  className="terminal-button text-xs bg-yellow-600 hover:bg-yellow-500"
                  disabled={(!publicKey && !testWallet) || isLoading}
                >
                  💧 Request SOL
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
                  onChange={(e) =>
                    setLaunchConfig({
                      ...launchConfig,
                      tauLamports: Math.round(parseFloat(e.target.value) * 1e9),
                    })
                  }
                  className="terminal-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">Sale Allocation (atomic)</label>
                <input
                  type="text"
                  value={launchConfig.saleAllocation}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, saleAllocation: e.target.value }))}
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
                <div className="flex items-center space-x-2">
                  <select
                    value={durationOption}
                    onChange={(e) => {
                      const newOption = e.target.value;
                      setDurationOption(newOption);
                      if (newOption === 'dropdown') {
                        // Reset custom seconds to match dropdown
                        setLaunchConfig(prev => ({
                          ...prev,
                          fundingDurationSeconds: getSecondsFromDropdown(prev.fundingDurationDays ?? 0)
                        }));
                      }
                    }}
                    className="terminal-input w-1/3"
                  >
                    <option value="dropdown">Presets</option>
                    <option value="custom">Custom (s)</option>
                  </select>

                  {durationOption === 'dropdown' ? (
                    <select
                      value={launchConfig.fundingDurationDays}
                      onChange={(e) => {
                        const daysValue = parseInt(e.target.value);
                        setLaunchConfig(prev => ({
                          ...prev,
                          fundingDurationDays: daysValue,
                          fundingDurationSeconds: getSecondsFromDropdown(daysValue)
                        }));
                      }}
                      className="terminal-input w-2/3"
                    >
                      <option value={0}>10 seconds (testing)</option>
                      <option value={1}>30 seconds (testing)</option>
                      <option value={2}>60 seconds (testing)</option>
                      <option value={3}>2 days</option>
                      <option value={4}>3 days</option>
                      <option value={5}>4 days</option>
                      <option value={6}>5 days</option>
                    </select>
                  ) : (
                    <input
                      type="number"
                      value={launchConfig.fundingDurationSeconds}
                      onChange={(e) => setLaunchConfig(prev => ({ ...prev, fundingDurationSeconds: parseInt(e.target.value) || 0 }))}
                      className="terminal-input w-2/3"
                      placeholder="Enter seconds"
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">Unlock Time (s)</label>
                <input
                  type="number"
                  value={launchConfig.unlockTimeSec}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, unlockTimeSec: parseInt(e.target.value) }))}
                  className="terminal-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">Skip blockhash check after sec</label>
                <input
                  type="number"
                  value={launchConfig.poolCreationGracePeriodSec}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, poolCreationGracePeriodSec: parseInt(e.target.value) }))}
                  className="terminal-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">Roster Shard Capacity</label>
                <input
                  type="number"
                  value={launchConfig.rosterShardCap}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, rosterShardCap: parseInt(e.target.value) }))}
                  className="terminal-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">Roster Shards Total (override)</label>
                <input
                  type="number"
                  value={launchConfig.rosterShardsTotal || 0}
                  onChange={(e) => {
                    const v = parseInt(e.target.value) || 0;
                    setLaunchConfig(prev => ({ ...prev, rosterShardsTotal: v > 0 ? v : undefined }));
                  }}
                  className="terminal-input w-full"
                  placeholder="0 = auto"
                />
              </div>
              <div className="col-span-full mt-4">
                <h3 className="text-sm font-bold terminal-glow mb-2">Raydium Pool (optional)</h3>
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">Quote Mint</label>
                <input
                  type="text"
                  value={launchConfig.quoteMint || ''}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, quoteMint: e.target.value }))}
                  className="terminal-input w-full"
                  placeholder="So1111... (WSOL)"
                />
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">AmmConfig</label>
                <input
                  type="text"
                  value={launchConfig.ammConfig || ''}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, ammConfig: e.target.value }))}
                  className="terminal-input w-full"
                  placeholder="Raydium AmmConfig pubkey"
                />
              </div>
              <div>
                <label className="block text-xs terminal-output mb-1">CLMM Program</label>
                <input
                  type="text"
                  value={launchConfig.clmmProgram || ''}
                  onChange={(e) => setLaunchConfig(prev => ({ ...prev, clmmProgram: e.target.value }))}
                  className="terminal-input w-full"
                  placeholder="Raydium CLMM program id"
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
              <div>
                <label className="block text-xs terminal-output mb-1">Max Tickets Per User</label>
                <input
                  type="number"
                  value={simConfig.maxTicketsPerUser}
                  onChange={(e) => setSimConfig(prev => ({ ...prev, maxTicketsPerUser: parseInt(e.target.value) || 0 }))}
                  className="terminal-input w-full"
                />
              </div>
              <div className="flex items-center space-x-2 mt-2">
                <input
                  type="checkbox"
                  checked={!!simConfig.useTestMintForBase}
                  onChange={(e) => setSimConfig(prev => ({ ...prev, useTestMintForBase: e.target.checked }))}
                  className="terminal-input"
                />
                <span className="text-xs terminal-output">
                  Use test mint for base token (skip Raydium CLMM)
                </span>
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
                          className={`flex items-center justify-between p-3 rounded border ${launchData?.projectId && safeToNumber(launchData.projectId) === project.projectId
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
                              Sale Mint: {project.baseMint ? project.baseMint.toString().slice(0, 8) + '...' : 'N/A'}
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
                <span className={baseMint ? 'terminal-success' : 'terminal-error'}>
                  {baseMint ? baseMint.publicKey.toString().slice(0, 8) + '...' : 'NONE'}
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
                    <span className={claimsOpened ? 'terminal-success' : 'terminal-error'}>
                      {claimsOpened ? 'YES' : 'NO'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-600 space-y-1 text-xs">
              <div className="terminal-prompt mb-2 text-xs">Pool Info:</div>
              <div className="flex justify-between">
                <span className="terminal-output">Raydium Pool:</span>
                <span className={raydiumPoolPublicKey ? 'terminal-success' : 'terminal-error'}>
                  {raydiumPoolPublicKey ? `${raydiumPoolPublicKey.toString().slice(0, 8)}...` : 'NOT CREATED'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="terminal-output">Pool Created:</span>
                <span className={poolStateData?.created ? 'terminal-success' : 'terminal-error'}>
                  {poolStateData?.created ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="terminal-output">Claims Ready:</span>
                <span className={poolClaimsReady ? 'terminal-success' : 'terminal-error'}>
                  {poolClaimsReady ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="terminal-output">CLMM Base Mint:</span>
                <span className={resolvedBaseMintPk ? 'terminal-success' : 'terminal-error'}>
                  {resolvedBaseMintPk ? `${resolvedBaseMintPk.toString().slice(0, 8)}...` : 'NONE'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="terminal-output">Pool ID:</span>
                <span className={poolStateData?.poolId ? 'terminal-success' : 'terminal-error'}>
                  {poolStateData?.poolId ? `#${safeToNumber(poolStateData.poolId)}` : 'N/A'}
                </span>
              </div>
              {raydiumPoolInfo && (
                <>
                  <div className="flex justify-between">
                    <span className="terminal-output">Price (A/B):</span>
                    <span className="terminal-success">{raydiumPoolInfo.price?.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="terminal-output">{raydiumPoolInfo.mintA.symbol || 'Base'} Liquidity:</span>
                    <span className="terminal-success">
                      {formatTokenAmount(raydiumPoolInfo.mintAmountA, raydiumPoolInfo.mintA.decimals)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="terminal-output">{raydiumPoolInfo.mintB.symbol || 'Quote'} Liquidity:</span>
                    <span className="terminal-success">
                      {formatTokenAmount(raydiumPoolInfo.mintAmountB, raydiumPoolInfo.mintB.decimals)}
                    </span>
                  </div>
                </>
              )}
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
                    addLog('Initializing roster shard 1...');
                    // Ensure launch account exists
                    try { await sdk.fetchLaunch(launchState); } catch (e) { addLog('ERROR: Launch not found on-chain'); throw e; }
                    const { signature } = await sdk.initRosterShard({
                      launch: launchState,
                      shardId: 1,
                      signers: [],
                    });
                    addLog(`SUCCESS: Roster shard 1 initialized - Signature: ${signature}`);
                    try {
                      const [rosterPda] = sdk.getRosterPda(launchState);
                      setRoster(rosterPda);
                      addLog(`Roster PDA set: ${rosterPda.toString()}`);
                    } catch {}
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
                    addLog('Finalizing roster shard 1...');
                    const { signature } = await sdk.finalizeRosterShard({
                      launch: launchState,
                      shardId: 1,
                      signers: [],
                    });
                    addLog(`SUCCESS: Roster shard 1 finalized - Signature: ${signature}`);
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
                    addLog('Preparing pool creation (will finalize selection and open claims)...');
                    await preparePoolCreationWithRetry({ sdk, launchPda: launchState, addLog });
                    addLog('Minting base tokens to escrow (test)...');
                    const mintedBaseMint = await mintForTestSafe({ sdk, launchPda: launchState, baseMintKeypair: baseMint, addLog });
                    if (!baseMint || !('secretKey' in (baseMint as any))) {
                      setBaseMint({ publicKey: mintedBaseMint } as Keypair);
                    }
                    await fetchLaunchData();
                    addLog('SUCCESS: Pool prepared and test mint complete. Claims should be open.');
                    if (launchState) await refreshPoolInfo(launchState);
                  } catch (error) {
                    addLog(`ERROR: Failed to prepare pool + test mint - ${error}`);
                  } finally {
                    setIsLoading(false);
                  }
                }}
                className="terminal-button w-full text-left"
                disabled={!launchState || isLoading || isFlowRunning}
              >
                <span className="terminal-prompt">$</span> Prepare Pool + Test Mint
              </button>



              <div className="my-4 border-t-2 border-dashed border-gray-600"></div>

              <button
                onClick={handleRunFullFlow}
                className="terminal-button w-full text-left bg-green-700 hover:bg-green-600 disabled:bg-gray-600"
                disabled={!sdk || isLoading || isFlowRunning}
              >
                <span className="terminal-prompt">$</span> ▶️ Run Full E2E Flow
              </button>

              <button
                onClick={simulateUsers}
                className="terminal-button w-full text-left bg-purple-700 hover:bg-purple-600 disabled:bg-gray-600"
                disabled={!sdk || !launchState || isLoading || isFlowRunning}
              >
                <span className="terminal-prompt">$</span> 👥 Simulate Users Deposits ({simConfig.numUsers})
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
              {isCreator && (
                <>
                  <button
                    onClick={async () => {
                      if (!sdk || !launchState) return;
                      try {
                        setIsLoading(true);
                        const amt = new BN(1 * 1e9);
                        addLog('Creator deposit 1 SOL...');
                        await sdk.creatorDeposit({ launch: launchState, amountLamports: amt });
                        await fetchLaunchData();
                        addLog('SUCCESS: Creator deposit complete');
                      } catch (e) {
                        addLog(`ERROR: Creator deposit failed - ${e}`);
                      } finally { setIsLoading(false); }
                    }}
                    className="terminal-button w-full text-left"
                    disabled={!launchState || isLoading || isFlowRunning}
                  >
                    <span className="terminal-prompt">$</span> Creator Deposit (1 SOL)
                  </button>

                  <button
                    onClick={async () => {
                      if (!sdk || !launchState) return;
                      try {
                        setIsLoading(true);
                        const amt = new BN(1 * 1e9);
                        addLog('Creator withdraw 1 SOL...');
                        await sdk.creatorWithdraw({ launch: launchState, amountLamports: amt });
                        await fetchLaunchData();
                        addLog('SUCCESS: Creator withdraw complete');
                      } catch (e) {
                        addLog(`ERROR: Creator withdraw failed - ${e}`);
                      } finally { setIsLoading(false); }
                    }}
                    className="terminal-button w-full text-left"
                    disabled={!launchState || isLoading || isFlowRunning}
                  >
                    <span className="terminal-prompt">$</span> Creator Withdraw (1 SOL)
                  </button>
                  <div className="my-2 border-t border-gray-600"></div>
                </>
              )}
              <button
                onClick={deposit}
                className="terminal-button w-full text-left"
                disabled={!launchState || !roster || isLoading || isFlowRunning || isCreator}
              >
                <span className="terminal-prompt">$</span> Deposit (2 SOL)
              </button>

              <button
                onClick={withdraw}
                className="terminal-button w-full text-left"
                disabled={!launchState || isLoading || isFlowRunning || isCreator}
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
                disabled={!launchState || !baseMint || isLoading || isFlowRunning}
              >
                <span className="terminal-prompt">$</span> Claim Tokens
              </button>

              <button
                onClick={async () => {
                  if (!sdk || !launchState || !baseMint) {
                    addLog('ERROR: Launch or base mint not initialized');
                    return;
                  }
                  try {
                    setIsLoading(true);
                    addLog('Claiming Creator Tokens...');
                    try {
                      const grant = await sdk.fetchCreatorGrant(launchState);
                      addLog(`Creator grant state: reserved=${(grant as any).reservedTickets}, claimed=${(grant as any).claimedTickets}, dailyCap=${(grant as any).dailyTicketCap}`);
                      if ((grant as any).claimedTickets >= (grant as any).reservedTickets) {
                        addLog('Nothing to claim: all reserved tickets already claimed.');
                      }
                    } catch {}
                    const { signature, creatorAta } = await sdk.claimCreatorTokens({
                      launch: launchState,
                      baseMint: baseMint.publicKey,
                      createAtaIfMissing: true,
                    });
                    addLog(`SUCCESS: Creator tokens claimed - Signature: ${signature}`);
                    addLog(`Creator ATA: ${creatorAta.toString()}`);
                    await fetchLaunchData();
                  } catch (error) {
                    addLog(`ERROR: Failed to claim creator tokens - ${error}`);
                  } finally {
                    setIsLoading(false);
                  }
                }}
                className="terminal-button w-full text-left"
                disabled={!launchState || !baseMint || !isCreator || isLoading || isFlowRunning}
              >
                <span className="terminal-prompt">$</span> Claim Creator Tokens
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

          {/* Pool Panel */}
          <div className="terminal-card lg:col-span-3">
            <div className="flex justify-between items-center mb-4">
              <div className="terminal-prompt">
                <span className="terminal-glow">pool@engine:~$</span>
                <span className="terminal-command ml-2">clmm-details</span>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => refreshPoolInfo()}
                  className="terminal-button text-xs"
                  disabled={!sdk || !launchState || isPoolInfoLoading}
                >
                  {isPoolInfoLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="text-xs terminal-output mb-4">
              Pool existence, claims status, and mint info now live in the status panel above.
              This section focuses on Raydium-specific metrics and swap controls.
            </div>

            {raydiumPoolInfo ? (
              <div className="space-y-1 text-xs mb-4">
                <div className="flex justify-between">
                  <span className="terminal-output">Price (A/B):</span>
                  <span className="terminal-success">{raydiumPoolInfo.price?.toFixed(6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">{raydiumPoolInfo.mintA.symbol || 'Base'} Liquidity:</span>
                  <span className="terminal-success">
                    {formatTokenAmount(raydiumPoolInfo.mintAmountA, raydiumPoolInfo.mintA.decimals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">{raydiumPoolInfo.mintB.symbol || 'Quote'} Liquidity:</span>
                  <span className="terminal-success">
                    {formatTokenAmount(raydiumPoolInfo.mintAmountB, raydiumPoolInfo.mintB.decimals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="terminal-output">Tick Current:</span>
                  <span className="terminal-success">{raydiumPoolInfo.tickCurrent}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs terminal-output mb-4">
                No Raydium snapshot available yet. Create the pool or refresh once it's live.
              </div>
            )}

            {raydiumPoolPublicKey && resolvedBaseMintPk && resolvedQuoteMintPk && (
              <div className="border-t border-gray-700 pt-4">
                <div className="terminal-output text-xs mb-2">Manual Swap (Raydium CLMM)</div>
                <div className="flex flex-col md:flex-row md:items-center md:space-x-2 space-y-2 md:space-y-0">
                  <select
                    value={swapDirection}
                    onChange={(e) => setSwapDirection(e.target.value as 'buy' | 'sell')}
                    className="terminal-input md:w-40"
                  >
                    <option value="buy">Buy Base (pay quote)</option>
                    <option value="sell">Sell Base (receive quote)</option>
                  </select>
                  <input
                    type="number"
                    value={swapAmount}
                    onChange={(e) => setSwapAmount(e.target.value)}
                    className="terminal-input flex-1"
                    placeholder={swapDirection === 'buy' ? 'Quote amount' : 'Base amount'}
                    min="0"
                  />
                  <button
                    onClick={handleManualSwap}
                    className="terminal-button text-xs"
                    disabled={swapPending}
                  >
                    {swapPending ? 'Swapping...' : 'Swap'}
                  </button>
                </div>
                <div className="terminal-output text-xs mt-1">
                  Input units: {swapDirection === 'buy'
                    ? (raydiumPoolInfo?.mintB.symbol || 'Quote')
                    : (raydiumPoolInfo?.mintA.symbol || 'Base')}
                </div>
                {swapStatus && (
                  <div
                    className={`text-xs mt-2 break-all ${
                      swapStatus.toLowerCase().includes('failed') ? 'terminal-error' : 'terminal-success'
                    }`}
                  >
                    {swapStatus}
                  </div>
                )}
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
              <button onClick={downloadLogs} className="terminal-button text-xs">
                Download Logs
              </button>
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