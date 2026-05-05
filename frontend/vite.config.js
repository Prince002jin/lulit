import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true
      },
      "/ws": {
        target: "ws://127.0.0.1:8080",
        ws: true,
        changeOrigin: true
      },
      "/messaging-api": {
        target: "http://127.0.0.1:8090",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/messaging-api/, "")
      }
    }
  }
});
