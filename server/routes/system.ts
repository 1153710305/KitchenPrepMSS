/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 系统维护路由：提供导出数据库和清空台账流水等高危操作
 */

import express from "express";
import path from "path";
import fs from "fs";
import { StorageService } from "../storageService.ts";
import { LogService } from "../logService.ts";

export const systemRouter = express.Router();

/**
 * @description 获取管理员密码（优先从环境变量读取，默认为 admin）
 */
const getAdminPassword = () => process.env.VITE_ADMIN_PASSWORD || "admin";

/**
 * @description 简单的密码验证中间件
 */
const requireAdminPassword = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // 兼容从 header (x-admin-password) 或 body 读取密码
  const reqPassword = req.headers["x-admin-password"] || req.body?.password || req.query?.password;
  if (reqPassword === getAdminPassword()) {
    next();
  } else {
    res.status(401).json({ error: "管理员密码错误，拒绝访问" });
  }
};

/**
 * @description 导出数据库文件
 * @route GET /api/system/export-db
 */
systemRouter.get("/export-db", requireAdminPassword, async (req, res) => {
  try {
    const storageType = process.env.STORAGE_TYPE || "local";
    if (storageType === "cos") {
      // 如果使用了云端存储，返回 JSON 结构
      StorageService.load().then(data => {
        res.setHeader("Content-disposition", "attachment; filename=kitchen_db_export.json");
        res.setHeader("Content-type", "application/json");
        res.send(JSON.stringify(data, null, 2));
      }).catch(err => {
        res.status(500).json({ error: "导出 COS 数据失败: " + err.message });
      });
      return;
    }

    // 本地 SQLite 模式导出 .sqlite 文件
    const dbPath = path.resolve(process.env.LOCAL_DATA_DIR || "data", "kpmss.sqlite");
    if (fs.existsSync(dbPath)) {
      LogService.write("WARN", "SystemMaintenance", "管理员执行了导出数据库文件操作");
      
      // 使用 better-sqlite3 的 backup 接口导出完整的一致性备份，以处理 WAL 模式下丢失缓存的可能
      const backupDir = path.resolve(process.env.LOCAL_DATA_DIR || "data", "backups");
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupFileName = `kpmss_${new Date().toISOString().split('T')[0]}_full.sqlite`;
      const backupPath = path.join(backupDir, backupFileName);
      
      await StorageService.backupLocalDb(backupPath);
      
      res.download(backupPath, backupFileName, (err) => {
        // 传送完成后，删除临时的备份文件以节省空间
        if (fs.existsSync(backupPath)) {
           fs.unlinkSync(backupPath);
        }
      });
    } else {
      res.status(404).json({ error: "找不到本地数据库文件" });
    }
  } catch (err: any) {
    res.status(500).json({ error: "导出数据库失败: " + err.message });
  }
});

/**
 * @description 一键清空所有台账日常流水记录（保留原材料底表配置）
 * @route POST /api/system/clear-records
 */
systemRouter.post("/clear-records", requireAdminPassword, async (req, res) => {
  try {
    const success = await StorageService.clearDailyRecords();
    if (success) {
      LogService.write("WARN", "SystemMaintenance", "管理员执行了【一键清空所有台账记录】操作");
      res.json({ success: true, message: "所有台账流水记录已成功清空" });
    } else {
      res.status(500).json({ error: "清空台账流水记录时发生内部错误" });
    }
  } catch (err: any) {
    res.status(500).json({ error: "清空记录失败: " + err.message });
  }
});
