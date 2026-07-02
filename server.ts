/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 后端服务入口文件：初始化 Express 实例与中间件、挂载数据持久化与杂项路由、在开发环境挂载 Vite HMR 中间件（生产环境托管静态构建产物），并注册进程级与路由级的全局异常捕获。
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { LogService } from "./server/logService.ts";
import { storageRouter } from "./server/routes/storage.ts";
import { miscRouter } from "./server/routes/misc.ts";

// 加载环境变量
dotenv.config();

/**
 * @description 初始化 Express 实例
 */
const app = express();

/**
 * @description 后门默认常规绑定端口
 */
const PORT = 3000;

// 配置 JSON 解析器
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 记录请求日志中转器
app.use((req, res, next) => {
  console.log(`[HTTP LOG] [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// 挂载数据持久化相关路由 (/api/storage/load|save|backups|restore)
app.use("/api/storage", storageRouter);

// 挂载杂项路由 (/api/log、/api/health)
app.use("/api", miscRouter);

/**
 * @description 挂载 Vite 开发中间件以保高画质更新
 */
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[SYSTEM BOOT] 已成功以 VITE 实时 HMR 仿真宿主模式挂载 Express 客户端页面件");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("[SYSTEM BOOT] 生产模式启动：托管静态主包路径在 dist/");
  }

  // 挂载全局路由执行错误捕获器，确保服务端异常不引起停机且保留堆栈日志
  app.use((err: any, req: any, res: any, next: any) => {
    const errMsg = err instanceof Error ? `${err.message}\nStack: ${err.stack}` : String(err);
    console.error("[HTTP ERROR] 路由遭遇运行时内部执行异常:", err);
    LogService.write("ERROR", "ExpressRouter", `URL: ${req.method} ${req.url} - ${errMsg}`);
    res.status(500).json({ error: "服务器内部异常", details: err.message || String(err) });
  });

  // 绑定宿主 0.0.0.0 以绕过沙箱
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[KITCHEN SYSTEM LIVE] 服务就绪! 请访问外部绑定端口层: http://localhost:${PORT}`);
  });
}

// 监听进程级别未捕获异常
process.on("uncaughtException", (err) => {
  console.error("[FATAL ERROR] 捕获到未处理的致命运行时异常:", err);
  LogService.write("ERROR", "UncaughtException", `${err.message}\nStack: ${err.stack}`);
});

// 监听 Promise 异步未处理拒绝
process.on("unhandledRejection", (reason: any) => {
  console.error("[FATAL ERROR] 捕获到未处理的致命 Promise Rejection:", reason);
  const msg = reason instanceof Error ? `${reason.message}\nStack: ${reason.stack}` : String(reason);
  LogService.write("ERROR", "UnhandledRejection", msg);
});

bootstrap().catch((err) => {
  console.error("[FATAL ERROR] 启动服务器引擎阶段直接死亡:", err);
  LogService.write("ERROR", "Bootstrap", String(err));
});
