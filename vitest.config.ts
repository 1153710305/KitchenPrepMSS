/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Vitest 测试运行配置：复用 vite.config.ts 的插件与解析规则，前端测试默认使用 jsdom 环境，server/ 目录下的后端测试使用 node 环境。
 */

import { defineConfig, mergeConfig } from "vitest/config";
import viteConfigFn from "./vite.config.ts";

// vite.config.ts 导出的是一个返回配置对象的函数（defineConfig(() => {...})），
// mergeConfig 只接受纯配置对象，这里先手动调用一次拿到实际的配置对象
const viteConfig = typeof viteConfigFn === "function" ? (viteConfigFn as any)({ mode: "test", command: "serve" }) : viteConfigFn;

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      environmentMatchGlobs: [["server/**", "node"]],
      setupFiles: ["./vitest.setup.ts"],
      css: false,
      globals: false,
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        include: [
          "src/services/**",
          "src/hooks/**",
          "src/utils.ts",
          "src/components/**",
          "server/**"
        ]
      }
    }
  })
);
