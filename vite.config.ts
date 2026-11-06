import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 约定：固定端口 1420，供 tauri.conf.json 的 devUrl 使用
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          // 重量级渲染库拆包，保证冷启动只加载主包
          mermaid: ["mermaid"],
          katex: ["katex"],
          codemirror: [
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/lang-markdown",
          ],
        },
      },
    },
  },
});
