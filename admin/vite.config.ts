import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "../dist-admin",
    emptyOutDir: true,
  },
});
