/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description /api/prepared-items、/api/groups、/api/categories、/api/reports 下的批量调价端点等路由的
 * HTTP 层集成测试（阶段C·业务规则迁移到后端，见 SQLite迁移规划.md）：覆盖 addPreparedItem/updateCell/
 * deletePreparedItem/batchUpdatePriceCol/saveGroup/deleteGroup/saveCategory/deleteCategory 的校验错误文案、
 * 重算逻辑、以及人群/大类默认数据保护、跨表级联（人群↔台账、大类↔备餐细项）效果（含孤儿行清理）。
 * 仿照 server/routes/ledgers.test.ts 的 supertest 集成测试范式。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
let app: express.Express;

/** 按阶段三协议包装一批增量 op 并 POST 到 /api/storage/save，用于预先造出测试夹具数据 */
function saveOps(ops: any[]) {
  return request(app).post("/api/storage/save").send({ protocolVersion: 2, ops });
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kpmss-reports-route-test-"));
  process.env.STORAGE_TYPE = "local";
  process.env.LOCAL_DATA_DIR = path.join(tmpDir, "data");
  process.env.SKIP_SEEDING = "1";

  vi.resetModules();
  const { storageRouter } = await import("./storage.ts");
  const { preparedItemsRouter, groupsRouter, categoriesRouter, reportsRouter } = await import("./reports.ts");

  app = express();
  app.use(express.json());
  app.use("/api/storage", storageRouter);
  app.use("/api/prepared-items", preparedItemsRouter);
  app.use("/api/groups", groupsRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/reports", reportsRouter);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.STORAGE_TYPE;
  delete process.env.LOCAL_DATA_DIR;
  delete process.env.SKIP_SEEDING;
  vi.restoreAllMocks();
});

describe("POST /api/prepared-items", () => {
  beforeEach(async () => {
    await saveOps([{ entity: "report", op: "upsert", key: { targetGroup: "KID", year: 2026, month: 7 } }]);
  });

  it("adds a new prepared item with a 31-day zero matrix", async () => {
    const res = await request(app).post("/api/prepared-items").send({ targetGroup: "KID", category: "VEGETABLE", name: "西红柿", unit: "斤" });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ name: "西红柿", category: "VEGETABLE", targetGroup: "KID", unit: "斤" });
    expect(res.body.item.dailyData["1"]).toEqual({ quantity: 0, price: 0, amount: 0 });
    expect(Object.keys(res.body.item.dailyData)).toHaveLength(31);
  });

  it("rejects an empty name", async () => {
    const res = await request(app).post("/api/prepared-items").send({ targetGroup: "KID", category: "VEGETABLE", name: "  ", unit: "斤" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("原料名称不能为空");
  });

  it("rejects when the target group's report does not exist", async () => {
    const res = await request(app).post("/api/prepared-items").send({ targetGroup: "TEACHER", category: "VEGETABLE", name: "西红柿", unit: "斤" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/无法找到目标人群分类/);
  });

  it("CASCADE: also creates a matching ledger item when a ledger exists for the target group and no duplicate name exists", async () => {
    await saveOps([{ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" } }]);

    const res = await request(app).post("/api/prepared-items").send({ targetGroup: "KID", category: "VEGETABLE", name: "西红柿", unit: "斤" });
    expect(res.status).toBe(200);

    const loadRes = await request(app).get("/api/storage/load");
    const ledgerItem = loadRes.body.ledgerItems.find((i: any) => i.ledgerId === "KID" && i.name === "西红柿");
    expect(ledgerItem).toBeDefined();
    expect(ledgerItem.id).toBeDefined();
  });

  it("does not create a duplicate ledger item when one with the same name already exists in that ledger", async () => {
    await saveOps([
      { entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" } },
      { entity: "ledgerItem", op: "upsert", key: "li_existing", data: { id: "li_existing", ledgerId: "KID", name: "西红柿", unit: "斤", spec: "", initialStock: 0, currentStock: 0 } }
    ]);

    await request(app).post("/api/prepared-items").send({ targetGroup: "KID", category: "VEGETABLE", name: "西红柿", unit: "斤" });

    const loadRes = await request(app).get("/api/storage/load");
    const matches = loadRes.body.ledgerItems.filter((i: any) => i.ledgerId === "KID" && i.name === "西红柿");
    expect(matches).toHaveLength(1);
  });

  it("succeeds without a ledger cascade when no ledger exists for the target group", async () => {
    const res = await request(app).post("/api/prepared-items").send({ targetGroup: "KID", category: "VEGETABLE", name: "西红柿", unit: "斤" });
    expect(res.status).toBe(200);
    const loadRes = await request(app).get("/api/storage/load");
    expect(loadRes.body.ledgerItems ?? []).toHaveLength(0);
  });
});

describe("PUT /api/prepared-items/:id/cells/:day", () => {
  beforeEach(async () => {
    await saveOps([
      { entity: "report", op: "upsert", key: { targetGroup: "KID", year: 2026, month: 7 } },
      { entity: "preparedItem", op: "upsert", key: "prep_1", data: { id: "prep_1", reportTargetGroup: "KID", reportYear: 2026, reportMonth: 7, name: "土豆", category: "VEGETABLE", targetGroup: "KID", unit: "斤" } }
    ]);
  });

  it("recalculates amount and persists the daily entry", async () => {
    const res = await request(app).put("/api/prepared-items/prep_1/cells/3").send({ quantity: 3, price: 2.5 });
    expect(res.status).toBe(200);
    expect(res.body.item.dailyData["3"]).toEqual({ quantity: 3, price: 2.5, amount: 7.5 });
    expect(res.body.ledgerItem).toBeNull();

    const loadRes = await request(app).get("/api/storage/load");
    const item = loadRes.body.reports.find((r: any) => r.targetGroup === "KID").items.find((i: any) => i.id === "prep_1");
    expect(item.dailyData["3"]).toEqual({ quantity: 3, price: 2.5, amount: 7.5 });
  });

  it("clamps negative quantity/price to zero", async () => {
    const res = await request(app).put("/api/prepared-items/prep_1/cells/3").send({ quantity: -3, price: -2 });
    expect(res.body.item.dailyData["3"]).toEqual({ quantity: 0, price: 0, amount: 0 });
  });

  it("deletes the daily entry once every field is emptied out", async () => {
    await request(app).put("/api/prepared-items/prep_1/cells/3").send({ quantity: 3, price: 2 });
    await request(app).put("/api/prepared-items/prep_1/cells/3").send({ quantity: 0, price: 0 });

    const loadRes = await request(app).get("/api/storage/load");
    const item = loadRes.body.reports.find((r: any) => r.targetGroup === "KID").items.find((i: any) => i.id === "prep_1");
    expect(item.dailyData["3"]).toBeUndefined();
  });

  it("rejects when the item does not exist", async () => {
    const res = await request(app).put("/api/prepared-items/nope/cells/1").send({ quantity: 1, price: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/未找到ID为/);
  });

  it("CASCADE: also updates the matching ledger item's daily record and currentStock, returned in the response", async () => {
    await saveOps([
      { entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" } },
      { entity: "ledgerItem", op: "upsert", key: "li_1", data: { id: "li_1", ledgerId: "KID", name: "土豆", unit: "斤", spec: "", initialStock: 10, currentStock: 10 } }
    ]);

    const res = await request(app).put("/api/prepared-items/prep_1/cells/3").send({ quantity: 5, price: 2 });
    expect(res.body.ledgerItem).toMatchObject({ id: "li_1", currentStock: 15 });

    const loadRes = await request(app).get("/api/storage/load");
    const ledgerItem = loadRes.body.ledgerItems.find((i: any) => i.id === "li_1");
    expect(ledgerItem.currentStock).toBe(15);
    expect(ledgerItem.dailyRecords["2026-07-03"]).toMatchObject({ inQuantity: 5, inPrice: 2, inAmount: 10 });
  });
});

describe("DELETE /api/prepared-items/:id", () => {
  it("deletes the item and its daily data, leaving no orphan rows", async () => {
    await saveOps([
      { entity: "report", op: "upsert", key: { targetGroup: "KID", year: 2026, month: 7 } },
      { entity: "preparedItem", op: "upsert", key: "prep_1", data: { id: "prep_1", reportTargetGroup: "KID", reportYear: 2026, reportMonth: 7, name: "土豆", category: "VEGETABLE", targetGroup: "KID", unit: "斤" } },
      { entity: "preparedItemDailyData", op: "upsert", key: { itemId: "prep_1", date: "1" }, data: { quantity: 2, price: 1, amount: 2 } }
    ]);

    const res = await request(app).delete("/api/prepared-items/prep_1");
    expect(res.status).toBe(200);

    const loadRes = await request(app).get("/api/storage/load");
    const report = loadRes.body.reports.find((r: any) => r.targetGroup === "KID");
    expect(report.items.find((i: any) => i.id === "prep_1")).toBeUndefined();
  });

  it("rejects when the item does not exist", async () => {
    const res = await request(app).delete("/api/prepared-items/nope");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/无法定位删除项ID/);
  });
});

describe("PUT /api/reports/:targetGroup/prices", () => {
  beforeEach(async () => {
    await saveOps([
      { entity: "report", op: "upsert", key: { targetGroup: "KID", year: 2026, month: 7 } },
      { entity: "preparedItem", op: "upsert", key: "a", data: { id: "a", reportTargetGroup: "KID", reportYear: 2026, reportMonth: 7, name: "土豆", category: "VEGETABLE", targetGroup: "KID", unit: "斤" } },
      { entity: "preparedItem", op: "upsert", key: "b", data: { id: "b", reportTargetGroup: "KID", reportYear: 2026, reportMonth: 7, name: "猪肉", category: "MEAT", targetGroup: "KID", unit: "斤" } },
      { entity: "preparedItemDailyData", op: "upsert", key: { itemId: "a", date: "1" }, data: { quantity: 3, price: 0, amount: 0 } },
      { entity: "preparedItemDailyData", op: "upsert", key: { itemId: "b", date: "1" }, data: { quantity: 3, price: 0, amount: 0 } }
    ]);
  });

  it("sets the price for every item in the matching category on the given day and recalculates amount", async () => {
    const res = await request(app).put("/api/reports/KID/prices").send({ category: "VEGETABLE", day: "1", fixedPrice: 4 });
    expect(res.status).toBe(200);

    const loadRes = await request(app).get("/api/storage/load");
    const report = loadRes.body.reports.find((r: any) => r.targetGroup === "KID");
    expect(report.items.find((i: any) => i.id === "a").dailyData["1"]).toEqual({ quantity: 3, price: 4, amount: 12 });
    expect(report.items.find((i: any) => i.id === "b").dailyData["1"].price).toBe(0);
  });

  it("clamps a negative fixed price to zero", async () => {
    await request(app).put("/api/reports/KID/prices").send({ category: "VEGETABLE", day: "1", fixedPrice: -10 });
    const loadRes = await request(app).get("/api/storage/load");
    const report = loadRes.body.reports.find((r: any) => r.targetGroup === "KID");
    expect(report.items.find((i: any) => i.id === "a").dailyData["1"].price).toBe(0);
  });

  it("rejects when the target group's report does not exist", async () => {
    const res = await request(app).put("/api/reports/TEACHER/prices").send({ category: "VEGETABLE", day: "1", fixedPrice: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("该人群报表不存在");
  });
});

describe("PUT /api/groups/:key", () => {
  it("creates a new group, seeds a current-month report, and cascades to create a matching ledger", async () => {
    const res = await request(app).put("/api/groups/teacher").send({ label: "教师备餐", emoji: "👩‍🏫" });
    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ key: "TEACHER", label: "教师备餐", emoji: "👩‍🏫" });

    const loadRes = await request(app).get("/api/storage/load");
    expect(loadRes.body.activeGroups.find((g: any) => g.key === "TEACHER")).toBeDefined();
    const now = new Date();
    expect(loadRes.body.reports.some((r: any) => r.targetGroup === "TEACHER" && r.year === now.getFullYear() && r.month === now.getMonth() + 1)).toBe(true);
    expect(loadRes.body.ledgers.find((l: any) => l.id === "TEACHER")).toMatchObject({ name: "教师备餐" });
  });

  it("edits an existing group while preserving isDefault, and renames its existing ledger", async () => {
    await saveOps([
      { entity: "activeGroup", op: "upsert", key: "KID", data: { key: "KID", label: "旧名字", emoji: "👶", isDefault: true } },
      { entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "旧名字", createdAt: "2026-01-01T00:00:00.000Z" } }
    ]);

    const res = await request(app).put("/api/groups/kid").send({ label: "幼儿新名字", emoji: "👶" });
    expect(res.body.group).toMatchObject({ key: "KID", label: "幼儿新名字", isDefault: true });

    const loadRes = await request(app).get("/api/storage/load");
    expect(loadRes.body.ledgers.find((l: any) => l.id === "KID").name).toBe("幼儿新名字");
  });

  it("rejects an empty key or label", async () => {
    let res = await request(app).put("/api/groups/%20").send({ label: "名字", emoji: "🍽️" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("人群标识键不能为空");

    res = await request(app).put("/api/groups/teacher").send({ label: "  ", emoji: "🍽️" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("人群名称标签不能为空");
  });
});

describe("DELETE /api/groups/:key", () => {
  it("refuses to delete a default group", async () => {
    await saveOps([{ entity: "activeGroup", op: "upsert", key: "KID", data: { key: "KID", label: "幼儿", emoji: "👶", isDefault: true } }]);

    const res = await request(app).delete("/api/groups/KID");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/系统默认人群，不允许删除/);
  });

  it("deletes a non-default group, cascades to its reports, and to its matching ledger + ledger items", async () => {
    await saveOps([
      { entity: "activeGroup", op: "upsert", key: "CUSTOM", data: { key: "CUSTOM", label: "自定义群体", emoji: "🍽️", isDefault: false } },
      { entity: "activeGroup", op: "upsert", key: "ANCHOR", data: { key: "ANCHOR", label: "占位人群", emoji: "🍽️", isDefault: true } },
      { entity: "report", op: "upsert", key: { targetGroup: "CUSTOM", year: 2026, month: 7 } },
      { entity: "ledger", op: "upsert", key: "CUSTOM", data: { id: "CUSTOM", name: "自定义群体", createdAt: "2026-01-01T00:00:00.000Z" } },
      { entity: "ledgerItem", op: "upsert", key: "li_1", data: { id: "li_1", ledgerId: "CUSTOM", name: "土豆", unit: "斤", spec: "", initialStock: 0, currentStock: 0 } }
    ]);

    const res = await request(app).delete("/api/groups/CUSTOM");
    expect(res.status).toBe(200);

    const loadRes = await request(app).get("/api/storage/load");
    expect(loadRes.body.activeGroups.find((g: any) => g.key === "CUSTOM")).toBeUndefined();
    expect(loadRes.body.reports.find((r: any) => r.targetGroup === "CUSTOM")).toBeUndefined();
    expect(loadRes.body.ledgers.find((l: any) => l.id === "CUSTOM")).toBeUndefined();
    expect(loadRes.body.ledgerItems.find((i: any) => i.id === "li_1")).toBeUndefined();
  });
});

describe("PUT /api/categories/:key", () => {
  it("creates a new category", async () => {
    const res = await request(app).put("/api/categories/dessert").send({ label: "甜品" });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ key: "DESSERT", label: "甜品" });
  });

  it("edits an existing category while preserving isDefault", async () => {
    await saveOps([{ entity: "activeCategory", op: "upsert", key: "VEGETABLE", data: { key: "VEGETABLE", label: "旧名字", isDefault: true } }]);
    const res = await request(app).put("/api/categories/vegetable").send({ label: "新名字" });
    expect(res.body.category).toMatchObject({ key: "VEGETABLE", label: "新名字", isDefault: true });
  });

  it("rejects an empty key or label", async () => {
    let res = await request(app).put("/api/categories/%20").send({ label: "甜品" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("大类标识键不能为空");

    res = await request(app).put("/api/categories/dessert").send({ label: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("大类名称标签不能为空");
  });
});

describe("DELETE /api/categories/:key", () => {
  it("refuses to delete a default category", async () => {
    await saveOps([{ entity: "activeCategory", op: "upsert", key: "VEGETABLE", data: { key: "VEGETABLE", label: "蔬菜", isDefault: true } }]);
    const res = await request(app).delete("/api/categories/VEGETABLE");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/系统默认大类，不允许删除/);
  });

  it("deletes a non-default category and strips matching items from every report, leaving unrelated items intact", async () => {
    await saveOps([
      { entity: "activeCategory", op: "upsert", key: "CUSTOM", data: { key: "CUSTOM", label: "自定义大类", isDefault: false } },
      { entity: "report", op: "upsert", key: { targetGroup: "KID", year: 2026, month: 7 } },
      { entity: "preparedItem", op: "upsert", key: "a", data: { id: "a", reportTargetGroup: "KID", reportYear: 2026, reportMonth: 7, name: "自定义食材", category: "CUSTOM", targetGroup: "KID", unit: "斤" } },
      { entity: "preparedItem", op: "upsert", key: "b", data: { id: "b", reportTargetGroup: "KID", reportYear: 2026, reportMonth: 7, name: "土豆", category: "VEGETABLE", targetGroup: "KID", unit: "斤" } }
    ]);

    const res = await request(app).delete("/api/categories/CUSTOM");
    expect(res.status).toBe(200);

    const loadRes = await request(app).get("/api/storage/load");
    expect(loadRes.body.activeCategories.find((c: any) => c.key === "CUSTOM")).toBeUndefined();
    const report = loadRes.body.reports.find((r: any) => r.targetGroup === "KID");
    expect(report.items.map((i: any) => i.id)).toEqual(["b"]);
  });
});
