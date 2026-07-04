/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 数据持久化相关路由：挂载在 /api/storage 前缀下，提供全量数据的加载、保存、历史快照列表查询与快照恢复接口。
 */

import express from "express";
import { StorageService } from "../storageService.ts";

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
    const data = await StorageService.load();
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
 * @description 保存全量数据到云端或本地存储并生成快照
 * @route POST /api/storage/save
 */
storageRouter.post("/save", async (req, res) => {
  try {
    const success = await StorageService.save(req.body);
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

/**
 * @description 获取历史备份快照列表
 * @route GET /api/storage/backups
 */
storageRouter.get("/backups", async (req, res) => {
  try {
    const backups = await StorageService.getBackups();
    res.json(backups);
  } catch (err: any) {
    console.error("[API BACKUPS ERROR] 获取备份列表失败:", err);
    res.status(500).json({ error: "获取备份快照列表失败: " + err.message });
  }
});

/**
 * @description 从历史备份快照恢复数据
 * @route POST /api/storage/restore
 */
storageRouter.post("/restore", async (req, res) => {
  try {
    const { backupName } = req.body;
    if (!backupName) {
      return res.status(400).json({ error: "参数不完整，缺少快照名称 backupName" });
    }
    const data = await StorageService.restore(backupName);
    if (data) {
      res.json({ success: true, data });
    } else {
      res.status(500).json({ error: "从快照恢复数据失败，文件可能不存在或已损坏" });
    }
  } catch (err: any) {
    console.error("[API RESTORE ERROR] 恢复快照数据失败:", err);
    res.status(500).json({ error: "恢复备份数据失败: " + err.message });
  }
});
