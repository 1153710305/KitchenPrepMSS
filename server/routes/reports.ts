/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐报表相关路由（阶段C·业务规则迁移到后端，见 SQLite迁移规划.md）：
 * `preparedItemsRouter` 挂载在 /api/prepared-items 前缀下（备餐细项的增删与单元格更新）；
 * `groupsRouter` 挂载在 /api/groups 前缀下（一级人群配置的增改删）；
 * `categoriesRouter` 挂载在 /api/categories 前缀下（二级食材大类配置的增改删）；
 * `reportsRouter` 挂载在 /api/reports 前缀下（批量调价）。
 * 校验/级联规则均在 StorageService 对应方法内实现，本路由只负责把 HTTP 请求转成方法调用、
 * 把业务校验错误转成 400 响应。
 */

import express from "express";
import { StorageService } from "../storageService.ts";

/**
 * @description 备餐细项路由 Router 实例（/api/prepared-items）
 */
export const preparedItemsRouter = express.Router();

/**
 * @description 一级人群配置路由 Router 实例（/api/groups）
 */
export const groupsRouter = express.Router();

/**
 * @description 二级食材大类配置路由 Router 实例（/api/categories）
 */
export const categoriesRouter = express.Router();

/**
 * @description 报表相关杂项路由 Router 实例（/api/reports），目前只有批量调价一个端点
 */
export const reportsRouter = express.Router();

/**
 * @description 为某个人群月度报表新增一个备餐细项，尽力而为同步至台账
 * @route POST /api/prepared-items
 */
preparedItemsRouter.post("/", async (req, res) => {
  try {
    const { targetGroup, category, name, unit } = req.body ?? {};
    const item = await StorageService.addPreparedItem({ targetGroup, category, name, unit });
    res.json({ success: true, item });
  } catch (err: any) {
    console.error("[API PREPARED ITEM ADD ERROR]", err);
    res.status(400).json({ error: err.message || "新增备餐条目失败" });
  }
});

/**
 * @description 物理删除某个备餐细项
 * @route DELETE /api/prepared-items/:id
 */
preparedItemsRouter.delete("/:id", async (req, res) => {
  try {
    await StorageService.deletePreparedItem(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[API PREPARED ITEM DELETE ERROR]", err);
    res.status(400).json({ error: err.message || "删除备餐条目失败" });
  }
});

/**
 * @description 更新某个备餐细项在某一天的数量/单价，尽力而为反向同步至台账逐日流水
 * @route PUT /api/prepared-items/:id/cells/:day
 */
preparedItemsRouter.put("/:id/cells/:day", async (req, res) => {
  try {
    const { quantity, price } = req.body ?? {};
    const result = await StorageService.updateCell(req.params.id, req.params.day, quantity, price);
    res.json({ success: true, item: result.item, ledgerItem: result.ledgerItem });
  } catch (err: any) {
    console.error("[API PREPARED ITEM CELL UPDATE ERROR]", err);
    res.status(400).json({ error: err.message || "保存单元格失败" });
  }
});

/**
 * @description 新增或编辑一级人群配置，级联同步创建/改名对应台账
 * @route PUT /api/groups/:key
 */
groupsRouter.put("/:key", async (req, res) => {
  try {
    const { label, emoji } = req.body ?? {};
    const group = await StorageService.saveGroup(req.params.key, label, emoji);
    res.json({ success: true, group });
  } catch (err: any) {
    console.error("[API GROUP SAVE ERROR]", err);
    res.status(400).json({ error: err.message || "保存人群配置失败" });
  }
});

/**
 * @description 删除一级人群配置及关联的所有报表（系统默认人群禁止删除），级联同步删除对应台账
 * @route DELETE /api/groups/:key
 */
groupsRouter.delete("/:key", async (req, res) => {
  try {
    await StorageService.deleteGroup(req.params.key);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[API GROUP DELETE ERROR]", err);
    res.status(400).json({ error: err.message || "删除人群配置失败" });
  }
});

/**
 * @description 新增或编辑二级食材大类配置
 * @route PUT /api/categories/:key
 */
categoriesRouter.put("/:key", async (req, res) => {
  try {
    const { label } = req.body ?? {};
    const category = await StorageService.saveCategory(req.params.key, label);
    res.json({ success: true, category });
  } catch (err: any) {
    console.error("[API CATEGORY SAVE ERROR]", err);
    res.status(400).json({ error: err.message || "保存大类配置失败" });
  }
});

/**
 * @description 删除二级大类配置并清空所有报表里属于此大类的细分项（系统默认大类禁止删除）
 * @route DELETE /api/categories/:key
 */
categoriesRouter.delete("/:key", async (req, res) => {
  try {
    await StorageService.deleteCategory(req.params.key);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[API CATEGORY DELETE ERROR]", err);
    res.status(400).json({ error: err.message || "删除大类配置失败" });
  }
});

/**
 * @description 批量将某人群报表下某大类在某天的所有细项单价统一刷成同一数值
 * @route PUT /api/reports/:targetGroup/prices
 */
reportsRouter.put("/:targetGroup/prices", async (req, res) => {
  try {
    const { category, day, fixedPrice } = req.body ?? {};
    await StorageService.batchUpdatePriceCol(req.params.targetGroup, category, day, fixedPrice);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[API BATCH PRICE UPDATE ERROR]", err);
    res.status(400).json({ error: err.message || "批量调价失败" });
  }
});
