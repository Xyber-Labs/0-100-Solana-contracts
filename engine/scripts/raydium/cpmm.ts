import {
    Connection,
    Keypair,
    PublicKey,
    LAMPORTS_PER_SOL,
    clusterApiUrl,
} from '@solana/web3.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    getMint,
    getAccount,
    transfer,
    burn,
    NATIVE_MINT,
} from '@solana/spl-token'
import {
    Raydium,
    DEVNET_PROGRAM_ID,
    getCpmmPdaAmmConfigId,
    type TokenInfo,
    CurveCalculator,
    toPercent,
    FeeOn,
} from '@raydium-io/raydium-sdk-v2'
import { CpmmConfigInfoLayout } from '@raydium-io/raydium-sdk-v2/lib/raydium/cpmm/layout.js'
import BN from 'bn.js'
import bs58 from 'bs58'

// ------------------------- CONFIG ---------------------------
const RPC = process.env.ANCHOR_PROVIDER_URL || process.env.RPC_URL || 'http://127.0.0.1:8899'
const SECRET = process.env.WALLET_SECRET_BASE58
const OWNER: Keypair = (() => {
    if (SECRET) return Keypair.fromSecretKey(bs58.decode(SECRET))
    const kpPath = process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json')
    const raw = fs.readFileSync(kpPath, 'utf8')
    const bytes = Uint8Array.from(JSON.parse(raw))
    return Keypair.fromSecretKey(bytes)
})()

// ---------- Local Raydium constants (no env) ----------
// Raydium CPMM program (from validator scripts)
const CPMM_PROGRAM_ID_CONST = new PublicKey('DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb')
// Raydium AMM_CONFIG account loaded into validator
const AMM_CONFIG_ID_CONST = new PublicKey('5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy')
// Pool fee account: by default send fees to our wallet on localnet
const CPMM_POOL_FEE_ACC_CONST = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC

// Choose quote mint: 'WSOL' (default) or 'USDC'
const QUOTE_KIND = (process.env.QUOTE_KIND || 'WSOL').toUpperCase() as 'WSOL' | 'USDC'
const USDC_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const QUOTE_MINT = QUOTE_KIND === 'WSOL' ? NATIVE_MINT : USDC_DEVNET

// Start price: (quote/base) * 1.15
const REF_PRICE = Number(process.env.REF_PRICE ?? '0.01') // quote (SOL or USDC) per 1 BASE
const TARGET_PRICE = REF_PRICE * 1.15

// How much BASE to seed initially (human units)
const BASE_DEPOSIT_HUMAN = Number(process.env.BASE_DEPOSIT ?? '100')

// Lock/Burn parameters (percent of received LP tokens)
const LOCK_PCT = Number(process.env.LOCK_PCT ?? '30') // send to incinerator (effectively locked)
const BURN_PCT = Number(process.env.BURN_PCT ?? '20') // burn LP permanently

// Trading campaign
const TRADE_COUNT = Number(process.env.TRADE_COUNT ?? '50')
const TRADE_QUOTE_TOTAL = Number(process.env.TRADE_QUOTE_TOTAL ?? (QUOTE_KIND === 'WSOL' ? '0.5' : '50'))
const TRADE_BASE_TOTAL = Number(process.env.TRADE_BASE_TOTAL ?? '1000')

// Claim (withdraw) a portion of remaining LP to realize fees
const CLAIM_PCT = Number(process.env.CLAIM_PCT ?? '10')

// ------------------------- UTILS ----------------------------
function tenPow(n: number) { return BigInt(10) ** BigInt(n) }
function toAtomic(amountHuman: string | number, decimals: number): bigint {
    const [i, f = ''] = String(amountHuman).split('.')
    const frac = f.padEnd(decimals, '0').slice(0, decimals)
    return BigInt(i) * tenPow(decimals) + BigInt(frac || 0)
}
function bigintToBN(x: bigint) { return new BN(x.toString()) }
function bnToBigint(x: BN) { return BigInt(x.toString()) }
function fmt(n: bigint, decimals: number, digits = 6) {
    const s = n.toString()
    const pad = decimals - s.length
    const sign = s.startsWith('-') ? '-' : ''
    const abs = sign ? s.slice(1) : s
    const whole = pad >= 0 ? '0'.repeat(pad) + abs : abs
    const intPart = whole.slice(0, whole.length - decimals) || '0'
    const fracPart = whole.slice(whole.length - decimals).replace(/0+$/, '')
    const frac = fracPart ? '.' + fracPart.slice(0, digits) : ''
    return sign + intPart + frac
}
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`
const green = (s: string) => `\x1b[92m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[93m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[96m${s}\x1b[0m`

function priceFromReserves(baseRes: BN, quoteRes: BN, db: number, dq: number) {
    const base = Number(bnToBigint(baseRes)) / Number(tenPow(db))
    const quote = Number(bnToBigint(quoteRes)) / Number(tenPow(dq))
    return quote / base
}

async function prettyBalances(connection: Connection, mint: PublicKey, owner: PublicKey) {
    const decimals = (await getMint(connection, mint)).decimals
    const ata = await getOrCreateAssociatedTokenAccount(connection, OWNER, mint, owner)
    const bal = await getAccount(connection, ata.address)
    return fmt(BigInt(bal.amount.toString()), decimals)
}

// ---------------------- CORE STEPS -------------------------
async function mintBaseToken(connection: Connection, decimals = 6) {
    const baseMint = await createMint(connection, OWNER, OWNER.publicKey, null, decimals)
    const ata = await getOrCreateAssociatedTokenAccount(connection, OWNER, baseMint, OWNER.publicKey)
    const supply = toAtomic(2_000_000_000, decimals) // 2B BASE for headroom
    await mintTo(connection, OWNER, baseMint, ata.address, OWNER.publicKey, Number(supply))
    return { baseMint, baseAta: ata.address, baseDecimals: decimals }
}

async function initSdk(connection: Connection) {
    return await Raydium.load({ owner: OWNER, connection, cluster: 'devnet' })
}

async function pickTokenInfo(raydium: Raydium, mint: PublicKey) {
    return (await raydium.token.getTokenInfo(mint.toBase58())) as TokenInfo
}

async function computeInitialDeposits(connection: Connection, baseMint: PublicKey, quoteMint: PublicKey, baseDepositHuman: number) {
    const baseMintAcc = await getMint(connection, baseMint)
    const db = baseMintAcc.decimals
    const dq = quoteMint.equals(NATIVE_MINT) ? 9 : (await getMint(connection, quoteMint)).decimals
    const baseDeposit = toAtomic(baseDepositHuman, db)
    const SCALE = 1_000_000_000
    const quoteDeposit = (baseDeposit * BigInt(Math.round(TARGET_PRICE * SCALE)) * tenPow(dq)) / (tenPow(db) * BigInt(SCALE))
    return { baseDeposit, quoteDeposit, db, dq }
}

async function createCpmmPool(
    raydium: Raydium,
    baseInfo: TokenInfo,
    quoteInfo: TokenInfo,
    baseDeposit: bigint,
    quoteDeposit: bigint
) {
    const CPMM_PROGRAM_ID = CPMM_PROGRAM_ID_CONST

    // Берём конфиг напрямую с локального RPC (не из публичного API)
    const targetId = AMM_CONFIG_ID_CONST
    const acc = await raydium.connection.getAccountInfo(targetId)
    if (!acc?.data) throw new Error('AMM config account not found on RPC: ' + targetId.toBase58())
    const cfgFromRpc: any = CpmmConfigInfoLayout.decode(acc.data)
    const feeConfig: any = {
        id: targetId.toBase58(),
        index: cfgFromRpc.index,
        tradeFeeRate: cfgFromRpc.tradeFeeRate,
        protocolFeeRate: cfgFromRpc.protocolFeeRate,
        fundFeeRate: cfgFromRpc.fundFeeRate,
        creatorFeeRate: cfgFromRpc.creatorFeeRate,
    }
    if (feeConfig.tradeFeeRate === undefined) throw new Error('Invalid AMM config from RPC')

    // Use the devnet pool fee account constant so it matches the devnet config we cloned.
    const poolFeeAccount = new PublicKey(
        (DEVNET_PROGRAM_ID as any).CREATE_CPMM_POOL_FEE_ACC ?? CPMM_POOL_FEE_ACC_CONST
    )

    const { execute, extInfo } = await raydium.cpmm.createPool({
        programId: CPMM_PROGRAM_ID,
        poolFeeAccount,
        mintA: baseInfo,
        mintB: quoteInfo,
        mintAAmount: bigintToBN(baseDeposit),
        mintBAmount: bigintToBN(quoteDeposit),
        startTime: new BN(0),
        feeConfig,
        associatedOnly: false,
        ownerInfo: { useSOLBalance: true, feePayer: OWNER.publicKey },
    })

    const { txId } = await execute({ sendAndConfirm: true })
    return { txId, extInfo }
}

async function getPoolOnchain(raydium: Raydium, poolId: string) {
    const data = await raydium.cpmm.getPoolInfoFromRpc(poolId)
    return data // { poolInfo, poolKeys, rpcData }
}

async function lockAndBurnLp(connection: Connection, lpMint: PublicKey, owner: PublicKey) {
    const lpDecimals = (await getMint(connection, lpMint)).decimals
    const ownerLpAta = await getOrCreateAssociatedTokenAccount(connection, OWNER, lpMint, owner)
    const lpAcc = await getAccount(connection, ownerLpAta.address)
    const total = BigInt(lpAcc.amount.toString())
    const toLock = (total * BigInt(Math.floor(LOCK_PCT * 100))) / BigInt(10000)
    const toBurn = (total * BigInt(Math.floor(BURN_PCT * 100))) / BigInt(10000)

    // 1) LOCK: send to incinerator ATA (unrecoverable)
    const INCINERATOR = new PublicKey('1nc1nerator11111111111111111111111111111111')
    const incAta = await getOrCreateAssociatedTokenAccount(connection, OWNER, lpMint, INCINERATOR, true)
    if (toLock > 0n) {
        await transfer(connection, OWNER, ownerLpAta.address, incAta.address, owner, Number(toLock))
    }

    // 2) BURN: burn LP from our ATA
    if (toBurn > 0n) {
        await burn(connection, OWNER, ownerLpAta.address, lpMint, owner, Number(toBurn))
    }

    const afterAcc = await getAccount(connection, ownerLpAta.address)
    const remaining = BigInt(afterAcc.amount.toString())

    return { lpDecimals, total, toLock, toBurn, remaining }
}

async function simulateTrades(
    raydium: Raydium,
    poolId: string,
    mintA: TokenInfo,
    mintB: TokenInfo,
    db: number,
    dq: number,
) {
    // We alternate directions; totals target: quote (SOL/USDC) IN + base IN
    const targetBaseIn = toAtomic(TRADE_BASE_TOTAL, db)
    const targetQuoteIn = QUOTE_KIND === 'WSOL' ? toAtomic(TRADE_QUOTE_TOTAL, 9) : toAtomic(TRADE_QUOTE_TOTAL, dq)

    let remBase = targetBaseIn
    let remQuote = targetQuoteIn
    let executed = 0
    let baseInActual = 0n
    let quoteInActual = 0n

    for (let i = 0; i < TRADE_COUNT; i++) {
        const refresh = await raydium.cpmm.getPoolInfoFromRpc(poolId)
        const { poolInfo, poolKeys, rpcData } = refresh

        const baseInTurn = i % 2 === 0 && remBase > 0n
        const quoteInTurn = !baseInTurn && remQuote > 0n
        if (!baseInTurn && !quoteInTurn) break

        // size as 1/remainingTrades with small jitter
        const remainingTrades = TRADE_COUNT - i
        const jitter = 0.7 + Math.random() * 0.6 // 0.7..1.3

        if (baseInTurn) {
            const chunk = remBase / BigInt(Math.max(1, remainingTrades))
            const amt = chunk > 0n ? BigInt(Math.max(1, Number(chunk * BigInt(Math.round(jitter * 1000)) / 1000n))) : 0n
            if (amt === 0n) continue
            const inputAmount = bigintToBN(amt)
            const swapResult = CurveCalculator.swapBaseInput(
                inputAmount,
                rpcData.baseReserve,
                rpcData.quoteReserve,
                rpcData.configInfo!.tradeFeeRate,
                rpcData.configInfo!.creatorFeeRate,
                rpcData.configInfo!.protocolFeeRate,
                rpcData.configInfo!.fundFeeRate,
                true,
            )
            const { execute } = await raydium.cpmm.swap({
                poolInfo,
                poolKeys,
                inputAmount,
                swapResult,
                slippage: 0.005,
                baseIn: true,
            })
            await execute({ sendAndConfirm: true })
            remBase -= amt
            baseInActual += amt
            executed++
        } else if (quoteInTurn) {
            const chunk = remQuote / BigInt(Math.max(1, remainingTrades))
            const amt = chunk > 0n ? BigInt(Math.max(1, Number(chunk * BigInt(Math.round(jitter * 1000)) / 1000n))) : 0n
            if (amt === 0n) continue
            const inputAmount = bigintToBN(amt)
            const swapResult = CurveCalculator.swapBaseInput(
                inputAmount,
                rpcData.quoteReserve,
                rpcData.baseReserve,
                rpcData.configInfo!.tradeFeeRate,
                rpcData.configInfo!.creatorFeeRate,
                rpcData.configInfo!.protocolFeeRate,
                rpcData.configInfo!.fundFeeRate,
                true,
            )
            const { execute } = await raydium.cpmm.swap({
                poolInfo,
                poolKeys,
                inputAmount,
                swapResult,
                slippage: 0.005,
                baseIn: false,
            })
            await execute({ sendAndConfirm: true })
            remQuote -= amt
            quoteInActual += amt
            executed++
        }
    }
    return { executed, baseInActual, quoteInActual }
}

async function claimByRemovingLiquidity(
    raydium: Raydium,
    connection: Connection,
    poolId: string,
    lpMint: PublicKey,
) {
    const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId)
    const lpDecimals = (await getMint(connection, lpMint)).decimals
    const lpAta = await getOrCreateAssociatedTokenAccount(connection, OWNER, lpMint, OWNER.publicKey)
    const lpAcc = await getAccount(connection, lpAta.address)
    const have = BigInt(lpAcc.amount.toString())
    if (have === 0n) return { withdrawnLp: 0n, outA: 0n, outB: 0n, lpDecimals }

    const toWithdraw = (have * BigInt(Math.floor(CLAIM_PCT * 100))) / BigInt(10000)
    if (toWithdraw === 0n) return { withdrawnLp: 0n, outA: 0n, outB: 0n, lpDecimals }

    // Estimate min amounts by pro-rata share (very conservative)
    const share = Number(toWithdraw) / Number(bnToBigint(rpcData.lpAmount))
    const { execute } = await raydium.cpmm.withdrawLiquidity({
        poolInfo,
        poolKeys,
        lpAmount: bigintToBN(toWithdraw),
        slippage: toPercent(0.05),
    })
    const { txId } = await execute({ sendAndConfirm: true })

    // Re-fetch approximate balances change (best-effort)
    const { rpcData: after } = await raydium.cpmm.getPoolInfoFromRpc(poolId)
    const outA = bnToBigint(rpcData.baseReserve.sub(after.baseReserve))
    const outB = bnToBigint(rpcData.quoteReserve.sub(after.quoteReserve))
    return { withdrawnLp: toWithdraw, outA, outB, lpDecimals, txId }
}

// ------------------------- MAIN -----------------------------
async function main() {
    const connection = new Connection(RPC, 'confirmed')

    console.log(bold('Raydium CPMM • Demo: Create → Lock&Burn → Trade x100 → Claim → Summary'))
    console.log(gray(`RPC: ${RPC}`))
    console.log(gray(`Wallet: ${OWNER.publicKey.toBase58()}`))
    console.log(gray(`Quote: ${QUOTE_KIND} (${QUOTE_MINT.toBase58()})`))

    // Airdrop SOL for local validator (configurable via AIRDROP_SOL)
    try {
        const airdropSol = Number(process.env.AIRDROP_SOL || '5000')
        const sig = await connection.requestAirdrop(OWNER.publicKey, Math.round(airdropSol * LAMPORTS_PER_SOL))
        await connection.confirmTransaction(sig, 'confirmed')
    } catch { }

    // 1) Mint BASE and grab token infos
    const { baseMint, baseAta, baseDecimals } = await mintBaseToken(connection, 6)
    const raydium = await initSdk(connection)
    const baseInfo = await pickTokenInfo(raydium, baseMint)
    const quoteInfo = await pickTokenInfo(raydium, QUOTE_MINT)

    // 2) Compute deposits for target price
    const { baseDeposit, quoteDeposit, db, dq } = await computeInitialDeposits(connection, baseMint, QUOTE_MINT, BASE_DEPOSIT_HUMAN)

    console.log('\n' + bold('Create pool + seed liquidity'))
    console.log('Target price (quote/base):', TARGET_PRICE)
    console.log('Initial deposits:', {
        base: `${BASE_DEPOSIT_HUMAN} BASE`,
        quote: `${fmt(quoteDeposit, dq)} ${QUOTE_KIND}`,
    })

    const created = await createCpmmPool(raydium, baseInfo, quoteInfo, baseDeposit, quoteDeposit)
    console.log(green('✓ Pool created'), 'txId:', created.txId)

    const poolId = created.extInfo.address.poolId.toBase58()
    const lpMint = created.extInfo.address.lpMint
    console.log('Pool ID:', poolId)

    // 3) Inspect initial on-chain state
    let { rpcData: before } = await getPoolOnchain(raydium, poolId)
    const price0 = priceFromReserves(before.baseReserve, before.quoteReserve, db, dq)
    console.log('Initial reserves:', {
        base: fmt(bnToBigint(before.baseReserve), db),
        quote: fmt(bnToBigint(before.quoteReserve), dq),
        price: price0,
    })

    // 4) Lock&Burn LP
    console.log('\n' + bold('Lock & Burn LP tokens'))
    const lb = await lockAndBurnLp(connection, lpMint, OWNER.publicKey)
    console.log('LP totals:', {
        received: fmt(lb.total, lb.lpDecimals),
        locked: fmt(lb.toLock, lb.lpDecimals),
        burned: fmt(lb.toBurn, lb.lpDecimals),
        remaining: fmt(lb.remaining, lb.lpDecimals),
    })

    // 5) Trading campaign (100 swaps: total ~50 SOL and ~50M BASE)
    console.log('\n' + bold('Run trading campaign'))
    const sim = await simulateTrades(raydium, poolId, baseInfo, quoteInfo, db, dq)
    console.log('Executed swaps:', sim.executed, '/', TRADE_COUNT)
    console.log('Totals in:', {
        baseIn: `${fmt(sim.baseInActual, db)} BASE`,
        quoteIn: `${fmt(sim.quoteInActual, dq)} ${QUOTE_KIND}`,
    })

    // 6) Claim commissions (by withdrawing a slice of remaining LP)
    console.log('\n' + bold('Claim LP fees (withdraw % of LP)'))
    const claim = await claimByRemovingLiquidity(raydium, connection, poolId, lpMint)
    console.log('Withdrawn LP:', fmt(claim.withdrawnLp, claim.lpDecimals))
    console.log('Out amounts (approx, on-chain diff):', {
        base: `${fmt(claim.outA, db)} BASE`,
        quote: `${fmt(claim.outB, dq)} ${QUOTE_KIND}`,
    })

    // 7) Final state & summary
    let { rpcData: after } = await getPoolOnchain(raydium, poolId)
    const price1 = priceFromReserves(after.baseReserve, after.quoteReserve, db, dq)

    console.log('\n' + bold('— SUMMARY —'))
    console.log('Pool reserves (before → after):')
    console.log('  BASE :', fmt(bnToBigint(before.baseReserve), db), '→', fmt(bnToBigint(after.baseReserve), db))
    console.log('  QUOTE:', fmt(bnToBigint(before.quoteReserve), dq), '→', fmt(bnToBigint(after.quoteReserve), dq))
    console.log('Price (quote/base):', price0.toFixed(12), '→', price1.toFixed(12))
    console.log('LP:', {
        lockedPct: LOCK_PCT + '%',
        burnedPct: BURN_PCT + '%',
        claimPct: CLAIM_PCT + '%',
    })
    console.log('Totals traded IN:', {
        baseIn: `${fmt(sim.baseInActual, db)} BASE`,
        quoteIn: `${fmt(sim.quoteInActual, dq)} ${QUOTE_KIND}`,
    })
    console.log('Claimed (by withdraw):', {
        base: `${fmt(claim.outA, db)} BASE`,
        quote: `${fmt(claim.outB, dq)} ${QUOTE_KIND}`,
    })
    console.log('\n' + cyan('Tip: in CPMM торговые комиссии авто-реинвестируются в резервы; их «клеймят» через частичный вывод LP — это и демонстрирует шаг Claim.'))
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
