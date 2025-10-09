import * as fs from 'fs';
import * as anchor from '@coral-xyz/anchor';
import { LiteSVM } from 'litesvm';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export async function setupRaydiumCLMM(client: LiteSVM) {
  const RAYDIUM_CLMM_ID = new anchor.web3.PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
  const WSOL_MINT = new anchor.web3.PublicKey('So11111111111111111111111111111111111111112');
  const METADATA_PROGRAM_ID = new anchor.web3.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

  const wsolMintData = Buffer.alloc(82);
  let offset = 0;
  wsolMintData.writeUInt32LE(0, offset);
  offset += 36;
  wsolMintData.writeBigUInt64LE(0n, offset);
  offset += 8;
  wsolMintData.writeUInt8(9, offset);
  offset += 1;
  wsolMintData.writeUInt8(1, offset);
  offset += 1;
  wsolMintData.writeUInt32LE(0, offset);

  client.setAccount(WSOL_MINT, {
    lamports: 1_000_000_000n,
    data: wsolMintData,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });

  console.log('✅ WSOL mint created');

  console.log('Loading Raydium CLMM program...');
  const raydiumBinary = fs.readFileSync('./raydium_clmm.so');
  client.addProgram(RAYDIUM_CLMM_ID, raydiumBinary);
  console.log('✅ Raydium CLMM program loaded');

  console.log('Loading Metaplex Token Metadata program...');
  const metaplexBinary = fs.readFileSync('./metaplex_metadata.so');
  client.addProgram(METADATA_PROGRAM_ID, metaplexBinary);
  console.log('✅ Metaplex Token Metadata program loaded');

  const ammConfigPubkey = anchor.web3.Keypair.generate().publicKey;

  const discriminator = Buffer.from('daf42168cbcb2b6f', 'hex');
  const bump = Buffer.from([255]);
  const index = Buffer.alloc(2);
  index.writeUInt16LE(0, 0);

  const owner = new anchor.web3.PublicKey('11111111111111111111111111111111');
  const protocolFeeRate = Buffer.alloc(4);
  const tradeFeeRate = Buffer.alloc(4);
  tradeFeeRate.writeUInt32LE(2500, 0);

  const tickSpacing = Buffer.alloc(2);
  tickSpacing.writeUInt16LE(60, 0);

  const fundFeeRate = Buffer.alloc(4);
  const paddingU32 = Buffer.alloc(4);
  const fundOwner = new anchor.web3.PublicKey('11111111111111111111111111111111');
  const padding = Buffer.alloc(24);

  const configData = Buffer.concat([
    discriminator,
    bump,
    index,
    owner.toBuffer(),
    protocolFeeRate,
    tradeFeeRate,
    tickSpacing,
    fundFeeRate,
    paddingU32,
    fundOwner.toBuffer(),
    padding,
  ]);

  client.setAccount(ammConfigPubkey, {
    lamports: 1_000_000_000n,
    data: configData,
    owner: RAYDIUM_CLMM_ID,
    executable: false,
  });

  console.log('✅ AMM Config created:', ammConfigPubkey.toString());

  return {
    raydiumProgramId: RAYDIUM_CLMM_ID,
    ammConfig: ammConfigPubkey,
  };
}
