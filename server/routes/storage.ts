/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 数据持久化相关路由：挂载在 /api/storage 前缀下，提供全量数据的加载与增量保存接口。
 */

import express from "express";
import { StorageService, type SyncOp } from "../storageService.ts";

/**
 * @description 数据持久化路由 Router 实例
 */
export const storageRouter = express.Router();

/**
 * @description 获取云端或本地存储的完整数据
 * @route GET /api/storage/load
 */
storageRouter.get("/load", async (req, res) => {
  try {
    const { start, end, bypassCache } = req.query;
    
    // 如果没有明确要求绕过缓存，且前端携带了版本号，进行 304 判断
    if (bypassCache !== "true") {
      const baseVersionStr = req.header("X-Base-Version");
      if (baseVersionStr) {
        const baseVersion = parseInt(baseVersionStr, 10);
        const currentVersion = StorageService.getDbVersion();
        if (baseVersion === currentVersion) {
          // 数据未发生任何改变，且前端请求的是与其当前内存一致的日期范围（由前端控制 bypassCache 保证），直接返回 304
          return res.status(304).end();
        }
      }
    }

    const data = await StorageService.load(start as string, end as string);
    // 首次启动判定：直接看加载结果是否为空对象即可，无需探测某个具体存储引擎的内部文件/连接细节。
    // 这样无论本地 SQLite 阶段一迁移前后、还是云端 COS 模式，判定逻辑都是同一套，也不再需要越权访问私有字段
    const isFirstBoot = Object.keys(data).length === 0;
    res.json({
      ...data,
      isFirstBoot
    });
  } catch (err: any) {
    console.error("[API LOAD ERROR] 读取数据失败:", err);
    res.status(500).json({ error: "读取存储数据失败: " + err.message });
  }
});

/**
 * @description 保存一批增量同步操作到云端或本地存储。
 * 阶段三·增量写协议：请求体固定为 { protocolVersion: 2, ops: SyncOp[] }，不再是此前的"整体状态"JSON。
 * protocolVersion 校验仅作为开发期快速失败断言（本项目前后端一起打包离线部署，没有独立升级场景，
 * 不为旧协议维护兼容解析层，避免旧缓存/未刷新页面静默写坏数据）。
 * @route POST /api/storage/save
 */
storageRouter.post("/save", async (req, res) => {
  try {
    const { protocolVersion, ops } = req.body ?? {};
    if (protocolVersion !== 2 || !Array.isArray(ops)) {
      return res.status(400).json({ error: "不支持的同步协议版本或请求体格式，期望 { protocolVersion: 2, ops: SyncOp[] }" });
    }
    const success = await StorageService.save(ops as SyncOp[]);
    if (success) {
      res.json({ success: true, timestamp: new Date().toISOString() });
    } else {
      res.status(500).json({ error: "保存数据失败" });
    }
  } catch (err: any) {
    console.error("[API SAVE ERROR] 保存数据失败:", err);
    res.status(500).json({ error: "写入存储数据失败: " + err.message });
  }
});
