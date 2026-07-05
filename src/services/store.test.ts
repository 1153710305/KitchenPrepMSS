/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description PrepReportService（备餐采购/月度报表业务数据服务层）单元测试：单元格更新与不可变性、台账双向同步、批量调价、一二级配置增删改与默认数据保护、级联更新/删除。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrepReportService } from "./store.ts";
import { SyncHelper } from "./syncHelper.ts";
import { LedgerService } from "./ledgerStore.ts";
import { RawMaterialsDictService } from "./rawMaterialDict.ts";
import { FoodCategory, TargetGroup, GroupMonthlyReport, PreparedItem } from "../types/types.ts";

function resetPrepReportService() {
  PrepReportService.setReportsInMemory([]);
  PrepReportService.setActiveGroupsInMemory([]);
  PrepReportService.setActiveCategoriesInMemory([]);
  (PrepReportService as any).changeListeners = [];
}

const makeItem = (overrides: Partial<PreparedItem> = {}): PreparedItem => ({
  id: overrides.id || "item_1",
  name: overrides.name || "土豆",
  category: overrides.category || FoodCategory.VEGETABLE,
  targetGroup: overrides.targetGroup || TargetGroup.KID,
  unit: overrides.unit || "斤",
  dailyData: overrides.dailyData || {}
});

const makeReport = (overrides: Partial<GroupMonthlyReport> = {}): GroupMonthlyReport => ({
  targetGroup: overrides.targetGroup || TargetGroup.KID,
  year: overrides.year ?? 2026,
  month: overrides.month ?? 7,
  items: overrides.items || []
});

describe("PrepReportService", () => {
  beforeEach(() => {
    resetPrepReportService();
    vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
    vi.spyOn(SyncHelper, "runWhenInitialized").mockImplementation((fn) => fn());
    vi.spyOn(LedgerService, "addLedgerItem").mockResolvedValue({} as any);
    vi.spyOn(LedgerService, "updateDailyRecordByKey").mockResolvedValue(undefined);
    vi.spyOn(LedgerService, "syncLedgerFromGroup").mockImplementation(() => {});
    vi.spyOn(LedgerService, "syncDeleteLedgerFromGroup").mockImplementation(() => {});
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  });

  afterEach(() => {
    resetPrepReportService();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("getOrCreateReport", () => {
    it("returns the existing report when one already matches", () => {
      const existing = makeReport();
      PrepReportService.setReportsInMemory([existing]);

      const result = PrepReportService.getOrCreateReport("KID", 2026, 7);

      expect(result).toBe(existing);
      expect(PrepReportService.getReports()).toHaveLength(1);
    });

    it("clones the most recent same-group report's items with daily data reset to zero", () => {
      const prior = makeReport({
        month: 6,
        items: [makeItem({ id: "old_1", name: "土豆", dailyData: { "1": { quantity: 5, price: 2, amount: 10 } } })]
      });
      PrepReportService.setReportsInMemory([prior]);

      const result = PrepReportService.getOrCreateReport("KID", 2026, 7);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("土豆");
      expect(result.items[0].id).not.toBe("old_1");
      expect(result.items[0].dailyData["1"]).toEqual({ quantity: 0, price: 0, amount: 0 });
    });

    it("seeds default items from the active category list when there is no prior report for the group", () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜", isDefault: true } as any]);

      const result = PrepReportService.getOrCreateReport("KID", 2026, 7);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((i) => i.category === "VEGETABLE")).toBe(true);
    });

    it("persists the newly created report into the in-memory reports list", () => {
      PrepReportService.getOrCreateReport("KID", 2026, 7);
      expect(PrepReportService.getReports()).toHaveLength(1);
    });
  });

  describe("updateCell", () => {
    it("recalculates the amount and immutably clones report/item/dailyData references", async () => {
      const originalItem = makeItem({ dailyData: { "1": { quantity: 0, price: 0, amount: 0 } } });
      const originalReport = makeReport({ items: [originalItem] });
      PrepReportService.setReportsInMemory([originalReport]);

      await PrepReportService.updateCell("item_1", "1", 3, 2.5);

      const updatedReport = PrepReportService.getReports()[0];
      expect(updatedReport).not.toBe(originalReport);
      expect(updatedReport.items[0]).not.toBe(originalItem);
      expect(updatedReport.items[0].dailyData["1"]).toEqual({ quantity: 3, price: 2.5, amount: 7.5 });
    });

    it("clamps negative quantity and price to zero", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem()] })]);

      await PrepReportService.updateCell("item_1", "1", -3, -2);

      const entry = PrepReportService.getReports()[0].items[0].dailyData["1"];
      expect(entry.quantity).toBe(0);
      expect(entry.price).toBe(0);
      expect(entry.amount).toBe(0);
    });

    it("queues a precise preparedItemDailyData upsert op for just this one day (not the whole item/report)", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ id: "item_1" })] })]);

      await PrepReportService.updateCell("item_1", "1", 3, 2.5);

      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: "preparedItemDailyData",
          op: "upsert",
          key: { itemId: "item_1", date: "1" },
          data: expect.objectContaining({ quantity: 3, price: 2.5, amount: 7.5 })
        })
      );
    });

    it("queues a preparedItemDailyData delete op once quantity/price/amount are all clamped back to zero", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ id: "item_1", dailyData: { "1": { quantity: 3, price: 2, amount: 6 } } })] })]);

      await PrepReportService.updateCell("item_1", "1", -3, -2);

      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "preparedItemDailyData", op: "delete", key: { itemId: "item_1", date: "1" } })
      );
    });

    it("rejects when no item matches the given id", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem()] })]);
      await expect(PrepReportService.updateCell("does_not_exist", "1", 1, 1)).rejects.toThrow(/未找到ID为/);
    });

    it("[V5.67.0] treats a NaN quantity/price as zero rather than letting NaN slip through Math.max", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem()] })]);

      await PrepReportService.updateCell("item_1", "1", NaN, NaN);

      const entry = PrepReportService.getReports()[0].items[0].dailyData["1"];
      expect(entry.quantity).toBe(0);
      expect(entry.price).toBe(0);
      expect(entry.amount).toBe(0);
    });

    it("reverse-syncs the edit into the ledger via updateDailyRecordByKey with a zero-padded date key", async () => {
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: TargetGroup.KID, year: 2026, month: 7, items: [makeItem()] })]);

      await PrepReportService.updateCell("item_1", "3", 2, 5);

      expect(LedgerService.updateDailyRecordByKey).toHaveBeenCalledWith(
        "KID",
        "土豆",
        "2026-07-03",
        expect.objectContaining({ inQuantity: 2, inPrice: 5, inAmount: 10 })
      );
    });

    it("applies the material dictionary's conversion ratio when present", async () => {
      vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", conversionUnit: "袋", conversionRatio: 0.5 } as any
      ]);
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem()] })]);

      await PrepReportService.updateCell("item_1", "3", 10, 2);

      expect(LedgerService.updateDailyRecordByKey).toHaveBeenCalledWith(
        "KID",
        "土豆",
        "2026-07-03",
        expect.objectContaining({ conversionUnitQuantity: 5 })
      );
    });

    it("still resolves successfully even when the reverse ledger sync fails", async () => {
      vi.spyOn(LedgerService, "updateDailyRecordByKey").mockRejectedValue(new Error("ledger sync failed"));
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem()] })]);

      await expect(PrepReportService.updateCell("item_1", "1", 1, 1)).resolves.toBeUndefined();
    });
  });

  describe("deletePreparedItem", () => {
    it("removes the matching item from whichever report contains it", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ id: "item_1" }), makeItem({ id: "item_2" })] })]);

      await PrepReportService.deletePreparedItem("item_1");

      const items = PrepReportService.getReports()[0].items;
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("item_2");
    });

    it("rejects when the item id cannot be located in any report", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [] })]);
      await expect(PrepReportService.deletePreparedItem("nope")).rejects.toThrow(/无法定位删除项/);
    });
  });

  describe("addPreparedItem", () => {
    beforeEach(() => {
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: TargetGroup.KID, items: [] })]);
    });

    it("adds the item to the matching report and mirrors it into the ledger", async () => {
      const item = await PrepReportService.addPreparedItem(TargetGroup.KID, FoodCategory.VEGETABLE, "西红柿", "斤");

      expect(item.name).toBe("西红柿");
      expect(PrepReportService.getReports()[0].items.map((i) => i.name)).toContain("西红柿");
      expect(LedgerService.addLedgerItem).toHaveBeenCalledWith("KID", "西红柿", "斤", "", 0);
    });

    it("still adds the prep item even if the ledger already has a same-named item (graceful degrade)", async () => {
      vi.spyOn(LedgerService, "addLedgerItem").mockRejectedValue(new Error("该台账内已有名为 x 的采购项目原料"));

      const item = await PrepReportService.addPreparedItem(TargetGroup.KID, FoodCategory.VEGETABLE, "西红柿", "斤");

      expect(item.name).toBe("西红柿");
      expect(PrepReportService.getReports()[0].items.map((i) => i.name)).toContain("西红柿");
    });

    it("rejects an empty name", async () => {
      await expect(PrepReportService.addPreparedItem(TargetGroup.KID, FoodCategory.VEGETABLE, "  ", "斤")).rejects.toThrow(
        "原料名称不能为空"
      );
    });

    it("rejects when no report exists yet for the target group", async () => {
      resetPrepReportService();
      await expect(PrepReportService.addPreparedItem(TargetGroup.TEACHER, FoodCategory.VEGETABLE, "西红柿", "斤")).rejects.toThrow(
        /无法找到目标人群分类/
      );
    });
  });

  describe("batchUpdatePriceCol", () => {
    it("sets the price for every item in the matching category on the given day and recalculates amount", async () => {
      PrepReportService.setReportsInMemory([
        makeReport({
          items: [
            makeItem({ id: "a", category: FoodCategory.VEGETABLE, dailyData: { "1": { quantity: 3, price: 0, amount: 0 } } }),
            makeItem({ id: "b", category: FoodCategory.MEAT, dailyData: { "1": { quantity: 3, price: 0, amount: 0 } } })
          ]
        })
      ]);

      await PrepReportService.batchUpdatePriceCol(TargetGroup.KID, FoodCategory.VEGETABLE, "1", 4);

      const items = PrepReportService.getReports()[0].items;
      expect(items.find((i) => i.id === "a")!.dailyData["1"]).toEqual({ quantity: 3, price: 4, amount: 12 });
      expect(items.find((i) => i.id === "b")!.dailyData["1"].price).toBe(0);
    });

    it("clamps a negative fixed price to zero", async () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ dailyData: {} })] })]);
      await PrepReportService.batchUpdatePriceCol(TargetGroup.KID, FoodCategory.VEGETABLE, "1", -10);
      expect(PrepReportService.getReports()[0].items[0].dailyData["1"].price).toBe(0);
    });

    it("rejects when the target group has no report", async () => {
      await expect(PrepReportService.batchUpdatePriceCol(TargetGroup.TEACHER, FoodCategory.VEGETABLE, "1", 5)).rejects.toThrow(
        "该人群报表不存在"
      );
    });
  });

  describe("syncFromLedger", () => {
    beforeEach(() => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜", isDefault: true } as any]);
    });

    it("creates a new item row on first sync for a not-yet-tracked material", async () => {
      await PrepReportService.syncFromLedger("KID", 2026, 7, "3", "土豆", FoodCategory.VEGETABLE, "斤", 5, 2);

      const report = PrepReportService.getReports().find((r) => r.targetGroup === "KID")!;
      const item = report.items.find((i) => i.name === "土豆")!;
      expect(item).toBeDefined();
      expect(item.dailyData["3"]).toEqual({ quantity: 5, price: 2, amount: 10 });
    });

    it("is idempotent: syncing the same material/day twice updates in place rather than duplicating rows", async () => {
      await PrepReportService.syncFromLedger("KID", 2026, 7, "3", "土豆", FoodCategory.VEGETABLE, "斤", 5, 2);
      await PrepReportService.syncFromLedger("KID", 2026, 7, "3", "土豆", FoodCategory.VEGETABLE, "斤", 8, 3);

      const report = PrepReportService.getReports().find((r) => r.targetGroup === "KID")!;
      const matches = report.items.filter((i) => i.name === "土豆");
      expect(matches).toHaveLength(1);
      expect(matches[0].dailyData["3"]).toEqual({ quantity: 8, price: 3, amount: 24 });
    });

    it("lazily creates the monthly report if it does not exist yet", async () => {
      expect(PrepReportService.getReports()).toHaveLength(0);
      await PrepReportService.syncFromLedger("KID", 2026, 7, "1", "土豆", FoodCategory.VEGETABLE, "斤", 1, 1);
      expect(PrepReportService.getReports().some((r) => r.targetGroup === "KID" && r.year === 2026 && r.month === 7)).toBe(true);
    });
  });

  describe("syncGroupFromLedger / syncDeleteGroupFromLedger", () => {
    it("adds a new active group and an empty current-month report when the id is unseen", () => {
      const now = new Date();
      PrepReportService.syncGroupFromLedger("TEACHER", "教师备餐");

      expect(PrepReportService.getActiveGroups().find((g) => g.key === "TEACHER")?.label).toBe("教师备餐");
      expect(
        PrepReportService.getReports().some(
          (r) => r.targetGroup === "TEACHER" && r.year === now.getFullYear() && r.month === now.getMonth() + 1
        )
      ).toBe(true);
    });

    it("renames an existing active group instead of duplicating it", () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "TEACHER", label: "旧名字" } as any]);
      PrepReportService.syncGroupFromLedger("TEACHER", "新名字");

      expect(PrepReportService.getActiveGroups()).toHaveLength(1);
      expect(PrepReportService.getActiveGroups()[0].label).toBe("新名字");
    });

    it("removes the group and all of its reports on delete-sync", () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "TEACHER", label: "教师备餐" } as any]);
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: TargetGroup.TEACHER })]);

      PrepReportService.syncDeleteGroupFromLedger("teacher");

      expect(PrepReportService.getActiveGroups()).toHaveLength(0);
      expect(PrepReportService.getReports()).toHaveLength(0);
    });
  });

  describe("saveGroup / deleteGroup (default-data protection)", () => {
    it("creates a new group plus an empty current-month report, and mirrors it into the ledger", async () => {
      await PrepReportService.saveGroup("teacher", "教师备餐", "👩‍🏫");

      expect(PrepReportService.getActiveGroups().find((g) => g.key === "TEACHER")).toBeDefined();
      expect(LedgerService.syncLedgerFromGroup).toHaveBeenCalledWith("TEACHER", "教师备餐");
    });

    it("edits an existing group in place while preserving its isDefault flag", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "旧名字", emoji: "👶", isDefault: true } as any]);

      await PrepReportService.saveGroup("kid", "幼儿新名字", "👶");

      const group = PrepReportService.getActiveGroups().find((g) => g.key === "KID")!;
      expect(group.label).toBe("幼儿新名字");
      expect(group.isDefault).toBe(true);
    });

    it("rejects an empty key or empty label", async () => {
      await expect(PrepReportService.saveGroup("", "名字", "🍽️")).rejects.toThrow("人群标识键不能为空");
      await expect(PrepReportService.saveGroup("key", "  ", "🍽️")).rejects.toThrow("人群名称标签不能为空");
    });

    it("refuses to delete a default group", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿", isDefault: true } as any]);
      await expect(PrepReportService.deleteGroup("KID")).rejects.toThrow(/系统默认人群，不允许删除/);
      expect(PrepReportService.getActiveGroups()).toHaveLength(1);
    });

    it("deletes a non-default group and cascades to its reports and the ledger", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "CUSTOM", label: "自定义群体", isDefault: false } as any]);
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: "CUSTOM" as TargetGroup })]);

      await PrepReportService.deleteGroup("CUSTOM");

      expect(PrepReportService.getActiveGroups()).toHaveLength(0);
      expect(PrepReportService.getReports()).toHaveLength(0);
      expect(LedgerService.syncDeleteLedgerFromGroup).toHaveBeenCalledWith("CUSTOM");
    });
  });

  describe("saveCategory / deleteCategory (default-data protection)", () => {
    it("creates a new category", async () => {
      await PrepReportService.saveCategory("dessert", "甜品");
      expect(PrepReportService.getActiveCategories().find((c) => c.key === "DESSERT")?.label).toBe("甜品");
    });

    it("edits an existing category in place while preserving its isDefault flag", async () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "旧名字", isDefault: true } as any]);
      await PrepReportService.saveCategory("vegetable", "新名字");
      const cat = PrepReportService.getActiveCategories().find((c) => c.key === "VEGETABLE")!;
      expect(cat.label).toBe("新名字");
      expect(cat.isDefault).toBe(true);
    });

    it("refuses to delete a default category", async () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜", isDefault: true } as any]);
      await expect(PrepReportService.deleteCategory("VEGETABLE")).rejects.toThrow(/系统默认大类，不允许删除/);
    });

    it("deletes a non-default category and strips matching items from every report", async () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "CUSTOM", label: "自定义大类", isDefault: false } as any]);
      PrepReportService.setReportsInMemory([
        makeReport({ items: [makeItem({ id: "a", category: "CUSTOM" as FoodCategory }), makeItem({ id: "b", category: FoodCategory.VEGETABLE })] })
      ]);

      await PrepReportService.deleteCategory("CUSTOM");

      expect(PrepReportService.getActiveCategories()).toHaveLength(0);
      const remainingIds = PrepReportService.getReports()[0].items.map((i) => i.id);
      expect(remainingIds).toEqual(["b"]);
    });
  });

  describe("cascadeUpdateMaterial / cascadeDeleteMaterial", () => {
    it("renames matching items across every report and updates their category/unit", () => {
      PrepReportService.setReportsInMemory([
        makeReport({ targetGroup: TargetGroup.KID, items: [makeItem({ name: "土豆" })] }),
        makeReport({ targetGroup: TargetGroup.TEACHER, items: [makeItem({ id: "item_2", name: "土豆" })] })
      ]);

      PrepReportService.cascadeUpdateMaterial("土豆", "马铃薯", FoodCategory.VEGETABLE, "公斤");

      const allItems = PrepReportService.getReports().flatMap((r) => r.items);
      expect(allItems.every((i) => i.name === "马铃薯" && i.unit === "公斤")).toBe(true);
    });

    it("is a no-op notify when no item matches the old name", () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ name: "土豆" })] })]);
      vi.spyOn(SyncHelper, "queueChange").mockClear();

      PrepReportService.cascadeUpdateMaterial("不存在", "新名字", FoodCategory.VEGETABLE, "斤");

      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });

    it("removes matching items across every report on cascade delete", () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ id: "a", name: "土豆" }), makeItem({ id: "b", name: "柿子" })] })]);

      PrepReportService.cascadeDeleteMaterial("土豆");

      expect(PrepReportService.getReports()[0].items.map((i) => i.id)).toEqual(["b"]);
    });

    it("is a no-op notify when no item matches the deleted name", () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ name: "土豆" })] })]);
      vi.spyOn(SyncHelper, "queueChange").mockClear();

      PrepReportService.cascadeDeleteMaterial("不存在");

      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });
  });

  describe("subscribe / notify contract", () => {
    it("delivers a snapshot to subscribers on every mutating action", async () => {
      const received: number[] = [];
      const unsubscribe = PrepReportService.subscribe((reports) => received.push(reports.length));

      await PrepReportService.saveCategory("dessert", "甜品");

      expect(received).toContain(0);
      unsubscribe();
    });

    it("does not let a throwing listener during broadcast block other listeners", async () => {
      let firstCallCount = 0;
      PrepReportService.subscribe(() => {
        firstCallCount += 1;
        throw new Error("boom");
      });
      const received: number[] = [];
      PrepReportService.subscribe((reports) => received.push(reports.length));

      await expect(PrepReportService.saveCategory("dessert", "甜品")).resolves.toBeUndefined();
      expect(firstCallCount).toBe(1);
      expect(received.length).toBe(1);
    });
  });

  describe("setReportsInMemory / setActiveGroupsInMemory / setActiveCategoriesInMemory / forceNotify (heartbeat silent update)", () => {
    it("overwrites memory without triggering a server sync", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      PrepReportService.setReportsInMemory([makeReport()]);
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿" } as any]);
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜" } as any]);

      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
      expect(PrepReportService.getReports()).toHaveLength(1);
    });

    it("forceNotify broadcasts to subscribers without touching the server", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      const received: any[] = [];
      const unsubscribe = PrepReportService.subscribe((reports) => received.push(reports));

      PrepReportService.forceNotify();

      expect(received.length).toBeGreaterThan(0);
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
});
