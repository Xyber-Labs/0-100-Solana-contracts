import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@xyber-labs/0-100-sdk": path.resolve(__dirname, "../ts-sdk/src/engine.ts"),
      "zero-hundred-engine-sdk": path.resolve(__dirname, "../ts-sdk/src/engine.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["@xyber-labs/0-100-sdk", "zero-hundred-engine-sdk"],
  },
  ssr: {
    noExternal: ["@xyber-labs/0-100-sdk", "zero-hundred-engine-sdk"],
  },
});
