import { Raydium } from '@raydium-io/raydium-sdk-v2'
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js'

import { getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2'

async function getCPMMConfig() {
    const CPMM_ID = new PublicKey('DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb') // CPMM
    const { publicKey, nonce } = getCpmmPdaAmmConfigId(CPMM_ID, 0)
    console.log('CPMM AmmConfig[0]:', publicKey.toBase58(), 'bump:', nonce)
}

async function main() {
    const connection = new Connection(clusterApiUrl('mainnet-beta'))
    const raydium = await Raydium.load({ owner: null as any, connection, cluster: 'mainnet' })

    const data = await raydium.api.fetchPoolById({
        ids: '2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv'
    })
    console.log(data)
}

main().catch(err => {
    console.error('Error in main:', err)
    process.exit(1)
})

getCPMMConfig()