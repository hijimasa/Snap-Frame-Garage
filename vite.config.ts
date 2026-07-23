import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three") || id.includes("node_modules/@react-three")) {
            return "three";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/zustand")) {
            return "react";
          }
        },
      },
    },
  },
} as Parameters<typeof defineConfig>[0]);
