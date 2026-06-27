import react from "@vitejs/plugin-react";
import tailwind from "tailwindcss";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [react()],
  publicDir: "./static",
  base: "./",
  css: {
    postcss: {
      plugins: [tailwind()],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Loads .env into process.env before every test file, including
    // unprefixed vars like SUPABASE_SERVICE_ROLE_KEY that Vitest's
    // automatic VITE_-prefix loading would otherwise skip.
    setupFiles: ['./src/test-setup.ts'],
  },
});
