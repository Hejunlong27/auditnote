import { defineConfig } from "vitest/config";

export default defineConfig({
  // 缓存落在项目内，避免使用系统临时目录（部分受管环境会拒绝写入）
  cacheDir: "./.vitest-cache",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // 受管环境里多个 worker 并发写 Vite 的 SSR 临时目录会偶发 EPERM，
    // 表现是"某个测试文件莫名没被收集"（测试数变少）。串行跑稳定，代价只有几秒。
    fileParallelism: false,
    reporters: "default",
  },
});
