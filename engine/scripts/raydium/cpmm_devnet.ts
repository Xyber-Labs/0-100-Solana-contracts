import {
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token'
import {
  Raydium,
  DEVNET_PROGRAM_ID,
  getCpmmPdaAmmConfigId,
  type TokenInfo,
  CurveCalculator,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2'

import BN from 'bn.js'
import bs58 from 'bs58'
import fs from 'fs'
import os from 'os'
import path from 'path'

const RPC = 'https://api.devnet.solana.com'
const OWNER_SECRET_BASE58 = process.env.WALLET_SECRET_BASE58 || ''
const OWNER: Keypair = (() => {
  if (OWNER_SECRET_BASE58) return Keypair.fromSecretKey(bs58.decode(OWNER_SECRET_BASE58))
  const kpPath = process.env.ANCHOR_WALLET || process.env.SOLANA_KEYPAIR || path.join(os.homedir(), '.config/solana/id.json')
  const raw = fs.readFileSync(kpPath, 'utf8')
  const bytes = Uint8Array.from(JSON.parse(raw))
  return Keypair.fromSecretKey(bytes)
})()

function toAtomicBn(amount: number, decimals: number) {
  // works for integers and fractional amounts without floating rounding errors
  const s = String(amount)
  const [whole, fracRaw = ''] = s.split('.')
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals)
  const base = new BN(10).pow(new BN(decimals))
  return new BN(whole || '0').mul(base).add(new BN(frac || '0'))
}

async function initSdk(connection: Connection) {
  return await Raydium.load({ owner: OWNER, connection, cluster: 'devnet' })
}

async function pickTokenInfo(raydium: Raydium, mint: PublicKey) {
  return (await raydium.token.getTokenInfo(mint.toBase58())) as TokenInfo
}

async function main() {
  const connection = new Connection(RPC, 'confirmed')

  // 1) Mint tokens: XYBER (BASE) and WSOL_MOCK (QUOTE)
  const XYBER_DECIMALS = 6
  const WSOL_MOCK_DECIMALS = 9
  const xyberMint = await createMint(connection, OWNER, OWNER.publicKey, null, XYBER_DECIMALS)
  const wsolMockMint = await createMint(connection, OWNER, OWNER.publicKey, null, WSOL_MOCK_DECIMALS)
  const xyberAta = await getOrCreateAssociatedTokenAccount(connection, OWNER, xyberMint, OWNER.publicKey)
  const wsolAta = await getOrCreateAssociatedTokenAccount(connection, OWNER, wsolMockMint, OWNER.publicKey)

  // 3) Init Raydium SDK
  const raydium = await initSdk(connection)

  // 4) Token infos
  const baseInfo = await pickTokenInfo(raydium, xyberMint) // XYBER
  const quoteInfo = await pickTokenInfo(raydium, wsolMockMint) // WSOL_MOCK

  // 5) Amounts: 450M XYBER, 300 WSOL_MOCK
  const baseAmount = toAtomicBn(450_000_000, XYBER_DECIMALS)
  const quoteAmount = toAtomicBn(300, WSOL_MOCK_DECIMALS)

  // Mint exact deposit amounts to owner ATAs
  await mintTo(connection, OWNER, xyberMint, xyberAta.address, OWNER.publicKey, baseAmount.toNumber())
  await mintTo(connection, OWNER, wsolMockMint, wsolAta.address, OWNER.publicKey, quoteAmount.toNumber())

  // 6) Fee config from API, remapped to devnet PDA id; pool fee account from config
  const feeConfigs = await raydium.api.getCpmmConfigs()
  feeConfigs.forEach((cfg: any) => {
    cfg.id = getCpmmPdaAmmConfigId(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, cfg.index).publicKey.toBase58()
  })
  const cfg = feeConfigs[0]
  if (!cfg) throw new Error('No CPMM fee configs on devnet API')
  const poolFeeAccountStr =
    (cfg as any).collectFeeAccount ||
    (cfg as any).feeAccount ||
    (cfg as any).fundFeeAccount ||
    DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC.toBase58()
  const poolFeeAccount = new PublicKey(poolFeeAccountStr)

  // 7) Create pool
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount,
    mintA: baseInfo,
    mintB: quoteInfo,
    mintAAmount: baseAmount,
    mintBAmount: quoteAmount,
    startTime: new BN(0),
    feeConfig: cfg,
    associatedOnly: true,
    ownerInfo: { useSOLBalance: false, feePayer: OWNER.publicKey },
  })
  const { txId } = await execute({ sendAndConfirm: true })

  console.log('✓ Pool created')
  console.log('txId:', txId)
  console.log('poolId:', extInfo.address.poolId.toBase58())
  console.log('lpMint:', extInfo.address.lpMint.toBase58())

  // 0) LP received
  const lpMint = extInfo.address.lpMint
  const lpAta = await getOrCreateAssociatedTokenAccount(connection, OWNER, lpMint, OWNER.publicKey)
  const lpAcc = await getAccount(connection, lpAta.address)
  console.log('LP received (raw):', lpAcc.amount.toString())
  let feeKeyMint: PublicKey | null = null

  // 1) Permanently lock a portion of LP via Raydium SDK (Burn & Earn)
  {
    // Fetch pool info/keys from RPC on devnet
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(extInfo.address.poolId.toBase58())
    // Determine how much to lock (50% of current LP)
    const cur = await getAccount(connection, lpAta.address)
    const total = new BN(cur.amount.toString())
    // const toLock = total.div(new BN(2))
    const toLock = total
    if (toLock.gt(new BN(0))) {
      // Ensure wallet token accounts are cached (SDK uses them to build ATAs for fee destinations)
      await raydium.account.fetchWalletTokenAccounts()
      const { execute: execLock, extInfo: lockInfo } = await raydium.cpmm.lockLp({
        programId: DEVNET_PROGRAM_ID.LOCK_CPMM_PROGRAM,
        authProgram: DEVNET_PROGRAM_ID.LOCK_CPMM_AUTH,
        poolKeys,
        poolInfo,
        lpAmount: toLock,
        withMetadata: true,
        txVersion: TxVersion.V0,
      })
      const { txId: lockTx } = await execLock({ sendAndConfirm: true })
      console.log('✓ LP locked — txId:', lockTx)
      // Persist the Fee Key NFT mint for harvesting later
      // `lockInfo` exposes the minted NFT used as the proof-of-right to fees
      // Prefer `lockInfo.nftMint` if present; fallback to nested address bag
      // @ts-ignore — tolerate optional chaining at runtime
      feeKeyMint = (lockInfo?.nftMint ?? lockInfo?.address?.nftMint) as PublicKey | null
      if (feeKeyMint) {
        console.log('Fee Key NFT mint:', feeKeyMint.toBase58())
      } else {
        console.warn('Warning: Fee Key NFT mint not found in extInfo; ensure SDK is up to date')
      }
    } else {
      console.warn('No LP to lock')
    }
  }

  // Mint extra balances for swaps (not using SOL) — after lock/burn to ensure balances suffice
  const extraBase = toAtomicBn(10_000_000, XYBER_DECIMALS)
  const extraQuote = toAtomicBn(10, WSOL_MOCK_DECIMALS)
  await mintTo(connection, OWNER, xyberMint, xyberAta.address, OWNER.publicKey, extraBase.toNumber())
  await mintTo(connection, OWNER, wsolMockMint, wsolAta.address, OWNER.publicKey, extraQuote.toNumber())

  // 2) 25 swap operations (buy/sell alternating)
  const SWAPS = 25
  // small fixed sizes to avoid insufficient funds and price impact
  const basePerSwapDefault = toAtomicBn(10_000, XYBER_DECIMALS)
  const quotePerSwapDefault = toAtomicBn(0.01, WSOL_MOCK_DECIMALS)
  for (let i = 0; i < SWAPS; i++) {
    const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(extInfo.address.poolId.toBase58())
    const baseIn = i % 2 === 0
    const inputAmount = baseIn ? basePerSwapDefault : quotePerSwapDefault
    const tradeFee = rpcData.configInfo!.tradeFeeRate
    const creatorFee = rpcData.configInfo!.creatorFeeRate
    const protocolFee = rpcData.configInfo!.protocolFeeRate
    const fundFee = rpcData.configInfo!.fundFeeRate
    const feeOnRaw = (rpcData.configInfo as any).feeOn
    const feeOn = typeof feeOnRaw?.toNumber === 'function' ? feeOnRaw.toNumber() : (feeOnRaw ?? 0)
    const inputIsA = baseIn // we constructed pool with MintA=BASE (XYBER)
    const isCreatorFeeOnInput = feeOn === 0 /*BothToken*/ || (feeOn === 1 /*OnlyTokenA*/ && inputIsA) || (feeOn === 2 /*OnlyTokenB*/ && !inputIsA)
    const computed = CurveCalculator.swapBaseInput(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      tradeFee,
      creatorFee,
      protocolFee,
      fundFee,
      isCreatorFeeOnInput,
    )
    const { execute: exSwap } = await raydium.cpmm.swap({
      poolInfo,
      poolKeys,
      inputAmount,
      swapResult: computed,
      slippage: 0.005,
      baseIn,
      config: { associatedOnly: true },
    })
    await exSwap({ sendAndConfirm: true })
  }

  // 3) Claim fees (harvest) from the locked LP using the Fee Key NFT
  {
    if (!feeKeyMint) {
      console.warn('Fee Key NFT mint unknown — cannot harvest. Make sure lock step succeeded.')
    } else {
      const { poolInfo } = await raydium.cpmm.getPoolInfoFromRpc(extInfo.address.poolId.toBase58())
      // Use a large cap to collect all currently available fees
      const maxToHarvest = new BN('999999999999999')
      const { execute: execHarvest } = await raydium.cpmm.harvestLockLp({
        poolInfo,
        nftMint: feeKeyMint,
        lpFeeAmount: maxToHarvest,
        txVersion: TxVersion.V0,
      })
      const { txId: harvestTx } = await execHarvest({ sendAndConfirm: true })
      console.log('✓ Harvested fees — txId:', harvestTx)
    }
  }

  // 4) SUMMARY with current price
  const { rpcData } = await raydium.cpmm.getPoolInfoFromRpc(extInfo.address.poolId.toBase58())
  const baseDec = XYBER_DECIMALS
  const quoteDec = WSOL_MOCK_DECIMALS
  const price = rpcData.quoteReserve.mul(new BN(10).pow(new BN(baseDec))).toNumber() / rpcData.baseReserve.mul(new BN(10).pow(new BN(quoteDec))).toNumber()
  console.log('— SUMMARY —')
  console.log('Reserves base:', rpcData.baseReserve.toString(), 'quote:', rpcData.quoteReserve.toString())
  console.log('Price (quote/base):', price)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


