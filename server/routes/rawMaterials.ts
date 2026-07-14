/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 原料字典相关路由：挂载在 /api/raw-materials 前缀下，提供原料的增删改接口（阶段A·业务规则迁移到后端，
 * 见 SQLite迁移规划.md）。校验/级联规则均在 StorageService.addRawMaterial/updateRawMaterial/deleteRawMaterial 内实现，
 * 本路由只负责把 HTTP 请求转成方法调用、把业务校验错误转成 400 响应。
 */

import express from "express";
import { StorageService } from "../storageService.ts";

/**
 * @description 原料字典路由 Router 实例
 */
export const rawMaterialsRouter = express.Router();

/**
 * @description 新增一条原料字典条目
 * @route POST /api/raw-materials
 */
rawMaterialsRouter.post("/", async (req, res) => {
  try {
    const { name, category, unit, remark, conversionUnit, conversionRatio } = req.body ?? {};
    const item = await StorageService.addRawMaterial({ name, category, unit, remark, conversionUnit, conversionRatio });
    res.json({ success: true, item });
  } catch (err: any) {
    console.error("[API RAW MATERIAL ADD ERROR]", err);
    res.status(400).json({ error: err.message || "新增原料失败" });
  }
});

/**
 * @description 更新一条原料字典条目（可改名），并级联同步台账里的同名条目
 * @route PUT /api/raw-materials/:oldName
 */
rawMaterialsRouter.put("/:oldName", async (req, res) => {
  try {
    const { name, category, unit, remark, conversionUnit, conversionRatio } = req.body ?? {};
    const item = await StorageService.updateRawMaterial(
      decodeURIComponent(req.params.oldName),
      { name, category, unit, remark, conversionUnit, conversionRatio }
    );
    res.json({ success: true, item });
  } catch (err: any) {
    console.error("[API RAW MATERIAL UPDATE ERROR]", err);
    res.status(400).json({ error: err.message || "更新原料失败" });
  }
});

/**
 * @description 删除一条原料字典条目（系统默认原料禁止删除），并级联物理删除台账里的同名条目
 * @route DELETE /api/raw-materials/:name
 */
rawMaterialsRouter.delete("/:name", async (req, res) => {
  try {
    await StorageService.deleteRawMaterial(decodeURIComponent(req.params.name));
    res.json({ success: true });
  } catch (err: any) {
    console.error("[API RAW MATERIAL DELETE ERROR]", err);
    res.status(400).json({ error: err.message || "删除原料失败" });
  }
});
