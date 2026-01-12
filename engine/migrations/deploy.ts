import * as anchor from "@coral-xyz/anchor";

if (require.main === module) {
  const provider = (anchor as any).AnchorProvider.env();
  (module.exports as any)(provider).catch((e: any) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
