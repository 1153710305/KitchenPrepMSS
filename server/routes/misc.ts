/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 杂项路由：挂载在 /api 前缀下，提供客户端日志上报接口与服务健康检查心跳接口。
 */

import express from "express";
import { LogService } from "../logService.ts";

/**
 * @description 杂项路由 Router 实例
 */
export const miscRouter = express.Router();

/**
 * @description 接收系统日志上报接口，保存到本地日志文件
 * @route POST /api/log
 */
miscRouter.post("/log", (req, res) => {
  const { level = "INFO", category = "System", message = "" } = req.body;
  LogService.write(level, category, message);
  res.json({ success: true });
});

/**
 * @description 历史测试心跳
 * @route GET /api/health
 */
miscRouter.get("/health", (req, res) => {
  res.json({ status: "alive", timestamp: new Date().toISOString() });
});
