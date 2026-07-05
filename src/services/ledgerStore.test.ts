/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerService（原料购销台账业务数据服务层）单元测试：台账/原料 CRUD、每日出入库记录合并与库存重算、级联更新/删除、订阅通知契约。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LedgerService } from "./ledgerStore.ts";
import { SyncHelper } from "./syncHelper.ts";
import { PrepReportService } from "./store.ts";
import { RawMaterialsDictService } from "./rawMaterialDict.ts";
import { FoodCategory } from "../types/types.ts";
import type { Ledger, LedgerItem } from "../types/ledgerTypes.ts";

const flushLatency = () => new Promise((resolve) => setTimeout(resolve, 110));

function resetLedgerService() {
  LedgerService.setLedgersInMemory([]);
  LedgerService.setLedgerItemsInMemory([]);
  // changeListeners 是私有静态字段，没有公开的重置方法，测试环境下直接绕过 TS 的 private 检查清空
  (LedgerService as any).changeListeners = [];
}

const makeLedger = (id: string, name: string): Ledger => ({
  id,
  name,
  createdAt: new Date("2026-01-01").toISOString()
});

describe("LedgerService", () => {
  beforeEach(() => {
    resetLedgerService();
    vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
    vi.spyOn(PrepReportService, "syncFromLedger").mockResolvedValue(undefined);
    vi.spyOn(PrepReportService, "syncGroupFromLedger").mockImplementation(() => {});
    vi.spyOn(PrepReportService, "syncDeleteGroupFromLedger").mockImplementation(() => {});
    vi.spyOn(RawMaterialsDictService, "getCategoryForMaterial").mockReturnValue(FoodCategory.VEGETABLE);
    // LogBroker.publish 内部会调用 fetch("/api/log", ...) 上报日志，测试环境无相对 URL 基址且无真实后端，
    // 这里挡掉真实网络请求，避免每条业务日志都在控制台打印一遍无害但干扰阅读的网络错误
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  });

  afterEach(() => {
    resetLedgerService();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("subscribe / notify contract", () => {
    it("immediately delivers a snapshot of current state upon subscribing", () => {
      LedgerService.setLedgersInMemory([makeLedger("A", "台账A")]);
      const received: any[] = [];
      const unsubscribe = LedgerService.subscribe((ledgers, items) => received.push({ ledgers, items }));

      expect(received).toHaveLength(1);
      expect(received[0].ledgers).toEqual([makeLedger("A", "台账A")]);
      unsubscribe();
    });

    it("notifies subscribers again after a mutating action", async () => {
      const received: any[] = [];
      const unsubscribe = LedgerService.subscribe((ledgers) => received.push(ledgers.length));

      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10).catch(() => {});
      // 需要先有台账才能新增原料，这里先补一个台账再重试
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);

      expect(received.length).toBeGreaterThan(1);
      unsubscribe();
    });

    it("stops delivering notifications after unsubscribe", async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      const received: any[] = [];
      const unsubscribe = LedgerService.subscribe((ledgers) => received.push(ledgers.length));
      unsubscribe();
      const countAfterUnsub = received.length;

      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);

      expect(received.length).toBe(countAfterUnsub);
    });

    it("does not let a throwing listener block other listeners during a broadcast", () => {
      // subscribe() 本身会同步立即回调一次交付当前快照，这次立即回调不在 try/catch 保护范围内；
      // 因此这里只在"订阅完成之后的后续广播"（即 notifyListeners 内部的 forEach）阶段才抛错，
      // 以验证 notifyListeners 的 try/catch 确实能隔离单个监听器异常，不阻塞其余监听器
      let callCount = 0;
      LedgerService.subscribe(() => {
        callCount += 1;
        if (callCount > 1) {
          throw new Error("boom");
        }
      });
      const received: any[] = [];
      LedgerService.subscribe((ledgers) => received.push(ledgers));

      expect(() => LedgerService.updateHelperDict(LedgerService.getHelperDict())).not.toThrow();
      expect(received.length).toBeGreaterThan(1);
    });
  });

  describe("updateLedger", () => {
    beforeEach(() => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐"), makeLedger("STU", "在校生备餐")]);
    });

    it("renames a ledger and notifies PrepReportService", async () => {
      await LedgerService.updateLedger("KID", "幼儿新名字");
      expect(LedgerService.getLedgers().find((l) => l.id === "KID")?.name).toBe("幼儿新名字");
      expect(PrepReportService.syncGroupFromLedger).toHaveBeenCalledWith("KID", "幼儿新名字");
    });

    it("rejects an empty name", async () => {
      await expect(LedgerService.updateLedger("KID", "   ")).rejects.toThrow("台账名称不能为空");
    });

    it("rejects when the ledger id does not exist", async () => {
      await expect(LedgerService.updateLedger("NOPE", "新名字")).rejects.toThrow("找不到该台账");
    });

    it("rejects renaming to a name already used by another ledger", async () => {
      await expect(LedgerService.updateLedger("KID", "在校生备餐")).rejects.toThrow(/已存在/);
    });

    it("allows renaming to the exact same name (no collision with itself)", async () => {
      await expect(LedgerService.updateLedger("KID", "幼儿备餐")).resolves.toBeUndefined();
    });
  });

  describe("deleteLedger", () => {
    beforeEach(async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
    });

    it("removes the ledger and cascades to its items", async () => {
      await LedgerService.deleteLedger("KID");
      expect(LedgerService.getLedgers()).toHaveLength(0);
      expect(LedgerService.getLedgerItems()).toHaveLength(0);
      expect(PrepReportService.syncDeleteGroupFromLedger).toHaveBeenCalledWith("KID");
    });

    it("does not remove items belonging to other ledgers", async () => {
      LedgerService.setLedgersInMemory([...LedgerService.getLedgers(), makeLedger("STU", "在校生备餐")]);
      await LedgerService.addLedgerItem("STU", "胡萝卜", "斤", "散装", 5);

      await LedgerService.deleteLedger("KID");

      expect(LedgerService.getLedgerItems().map((i) => i.name)).toEqual(["胡萝卜"]);
    });

    it("rejects when the ledger does not exist", async () => {
      await expect(LedgerService.deleteLedger("NOPE")).rejects.toThrow("找不到待删除的台账");
    });
  });

  describe("syncLedgerFromGroup / syncDeleteLedgerFromGroup", () => {
    it("creates a brand new empty ledger when the id does not exist yet", () => {
      LedgerService.syncLedgerFromGroup("TEACHER", "教师备餐");
      const ledger = LedgerService.getLedgers().find((l) => l.id === "TEACHER");
      expect(ledger?.name).toBe("教师备餐");
      expect(LedgerService.getLedgerItems().filter((i) => i.ledgerId === "TEACHER")).toHaveLength(0);
    });

    it("renames an existing ledger in place instead of duplicating it", () => {
      LedgerService.setLedgersInMemory([makeLedger("TEACHER", "旧名字")]);
      LedgerService.syncLedgerFromGroup("TEACHER", "新名字");

      expect(LedgerService.getLedgers()).toHaveLength(1);
      expect(LedgerService.getLedgers()[0].name).toBe("新名字");
    });

    it("is a no-op when the name is unchanged", () => {
      LedgerService.setLedgersInMemory([makeLedger("TEACHER", "教师备餐")]);
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      LedgerService.syncLedgerFromGroup("TEACHER", "教师备餐");
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });

    it("deletes a ledger case-insensitively by id and cascades its items", async () => {
      LedgerService.setLedgersInMemory([makeLedger("kid", "幼儿备餐")]);
      await LedgerService.addLedgerItem("kid", "土豆", "斤", "散装", 10);

      LedgerService.syncDeleteLedgerFromGroup("KID");

      expect(LedgerService.getLedgers()).toHaveLength(0);
      expect(LedgerService.getLedgerItems()).toHaveLength(0);
    });
  });

  describe("addLedgerItem", () => {
    beforeEach(() => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
    });

    it("creates a new item with initial stock mirrored into current stock", async () => {
      const item = await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
      expect(item.name).toBe("土豆");
      expect(item.initialStock).toBe(10);
      expect(item.currentStock).toBe(10);
      expect(item.dailyRecords).toEqual({});
    });

    it("defaults unit and spec when blank", async () => {
      const item = await LedgerService.addLedgerItem("KID", "土豆", "  ", "  ", 0);
      expect(item.unit).toBe("斤");
      expect(item.spec).toBe("常规");
    });

    it("clamps a negative initial stock to zero", async () => {
      const item = await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", -5);
      expect(item.initialStock).toBe(0);
      expect(item.currentStock).toBe(0);
    });

    it("rejects an empty name", async () => {
      await expect(LedgerService.addLedgerItem("KID", "  ", "斤", "散装", 0)).rejects.toThrow("原料名称不能为空");
    });

    it("rejects when the ledger does not exist", async () => {
      await expect(LedgerService.addLedgerItem("NOPE", "土豆", "斤", "散装", 0)).rejects.toThrow("关联的台账不存在");
    });

    it("rejects a duplicate name within the same ledger", async () => {
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
      await expect(LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 5)).rejects.toThrow(/已有名为/);
    });

    it("allows the same material name across two different ledgers", async () => {
      LedgerService.setLedgersInMemory([...LedgerService.getLedgers(), makeLedger("STU", "在校生备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
      await expect(LedgerService.addLedgerItem("STU", "土豆", "斤", "散装", 5)).resolves.toBeDefined();
    });
  });

  describe("updateLedgerItem", () => {
    let itemId: string;

    beforeEach(async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      const item = await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
      itemId = item.id;
    });

    it("updates fields and recalculates current stock from initial stock alone when there are no daily records", async () => {
      await LedgerService.updateLedgerItem(itemId, "新土豆", "斤", "精品", 20);
      const item = LedgerService.getLedgerItems().find((i) => i.id === itemId)!;
      expect(item.name).toBe("新土豆");
      expect(item.initialStock).toBe(20);
      expect(item.currentStock).toBe(20);
    });

    it("recalculates current stock including existing daily in/out quantities", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-01", { inQuantity: 5, outQuantity: 2 });
      await LedgerService.updateLedgerItem(itemId, "土豆", "斤", "散装", 100);

      const item = LedgerService.getLedgerItems().find((i) => i.id === itemId)!;
      // 100 (新初始库存) + 5 (入库) - 2 (出库) = 103
      expect(item.currentStock).toBe(103);
    });

    it("rejects when the item id does not exist", async () => {
      await expect(LedgerService.updateLedgerItem("nope", "x", "斤", "y", 0)).rejects.toThrow("找不到该采购原料项目");
    });

    it("rejects a rename that collides with another item in the same ledger", async () => {
      await LedgerService.addLedgerItem("KID", "柿子", "斤", "散装", 5);
      await expect(LedgerService.updateLedgerItem(itemId, "柿子", "斤", "散装", 10)).rejects.toThrow(/已有名为/);
    });
  });

  describe("deleteLedgerItem", () => {
    it("removes the item", async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      const item = await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);

      await LedgerService.deleteLedgerItem(item.id);

      expect(LedgerService.getLedgerItems()).toHaveLength(0);
    });

    it("rejects when the item does not exist", async () => {
      await expect(LedgerService.deleteLedgerItem("nope")).rejects.toThrow("找不到要删除的原料项目");
    });
  });

  describe("updateDailyRecord", () => {
    let itemId: string;

    beforeEach(async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      const item = await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 100);
      itemId = item.id;
    });

    it("merges partial fields into a new daily record and recalculates inAmount", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 3, inPrice: 2 });
      const record = LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"];
      expect(record.inQuantity).toBe(3);
      expect(record.inPrice).toBe(2);
      expect(record.inAmount).toBe(6);
    });

    it("queues a precise ledgerItemDailyRecord upsert op for just this one date, plus a ledgerItem skeleton op for the recalculated currentStock", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 3, inPrice: 2 });

      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: "ledgerItemDailyRecord",
          op: "upsert",
          key: { itemId, date: "2026-07-03" },
          data: expect.objectContaining({ inQuantity: 3, inPrice: 2, inAmount: 6 })
        })
      );
      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "ledgerItem", op: "upsert", key: itemId, data: expect.objectContaining({ id: itemId, currentStock: 103 }) })
      );
    });

    it("queues a ledgerItemDailyRecord delete op once the day's fields are all emptied out (hasData guard)", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 3, inPrice: 2 });
      (SyncHelper.queueChange as any).mockClear();

      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 0, inPrice: 0 });

      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "ledgerItemDailyRecord", op: "delete", key: { itemId, date: "2026-07-03" } })
      );
    });

    it("shallow-merges onto an existing record without clobbering untouched fields", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 3, inPrice: 2, supplier: "合作基地直供" });
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { outQuantity: 1 });

      const record = LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"];
      expect(record.inQuantity).toBe(3);
      expect(record.supplier).toBe("合作基地直供");
      expect(record.outQuantity).toBe(1);
    });

    it("clamps negative inQuantity/outQuantity/inPrice to zero", async () => {
      // 附带一个非数量类字段(certification)以确保 hasData 守卫判定该记录仍应保留，
      // 否则数量全部被钳制为 0 后记录会被判定为"空记录"整体裁剪掉，无法验证钳制结果
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", {
        inQuantity: -5,
        inPrice: -2,
        outQuantity: -1,
        certification: "有"
      });
      const record = LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"];
      expect(record.inQuantity).toBe(0);
      expect(record.inPrice).toBe(0);
      expect(record.outQuantity).toBe(0);
    });

    it("[V5.67.0] treats a NaN inQuantity/inPrice/outQuantity as zero rather than letting NaN slip through Math.max", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", {
        inQuantity: NaN,
        inPrice: NaN,
        outQuantity: NaN,
        certification: "有"
      });
      const record = LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"];
      expect(record.inQuantity).toBe(0);
      expect(record.inPrice).toBe(0);
      expect(record.outQuantity).toBe(0);
      expect(record.inAmount).toBe(0);
    });

    it("trims the note field", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { note: "  备注内容  " });
      const record = LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"];
      expect(record.note).toBe("备注内容");
    });

    it("prunes the day entirely once every field is emptied (hasData guard)", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { supplier: "合作基地直供" });
      expect(LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"]).toBeDefined();

      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { supplier: "" });
      expect(LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"]).toBeUndefined();
    });

    it("keeps the day when only a non-quantity field like certification has content", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { certification: "有" });
      expect(LedgerService.getLedgerItems().find((i) => i.id === itemId)!.dailyRecords["2026-07-03"]).toBeDefined();
    });

    it("recalculates currentStock from initialStock plus all historical in/out across every day", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-01", { inQuantity: 10 });
      await LedgerService.updateDailyRecord(itemId, "2026-07-02", { outQuantity: 4 });
      const item = LedgerService.getLedgerItems().find((i) => i.id === itemId)!;
      // 100 (initial) + 10 - 4 = 106
      expect(item.currentStock).toBe(106);
    });

    it("rejects when the item id does not exist", async () => {
      await expect(LedgerService.updateDailyRecord("nope", "2026-07-03", { inQuantity: 1 })).rejects.toThrow(
        "找不到对应的采购原料项目"
      );
    });

    it("syncs to PrepReportService only when inQuantity or inPrice was part of the update", async () => {
      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { supplier: "合作基地直供" });
      expect(PrepReportService.syncFromLedger).not.toHaveBeenCalled();

      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 3 });
      expect(PrepReportService.syncFromLedger).toHaveBeenCalledWith(
        "KID",
        2026,
        7,
        "3",
        "土豆",
        FoodCategory.VEGETABLE,
        "斤",
        3,
        0
      );
    });
  });

  describe("updateDailyRecordByKey", () => {
    beforeEach(async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
    });

    it("resolves the item by ledgerId + name and delegates to updateDailyRecord", async () => {
      await LedgerService.updateDailyRecordByKey("KID", "土豆", "2026-07-03", { inQuantity: 2 });
      const item = LedgerService.getLedgerItems().find((i) => i.name === "土豆")!;
      expect(item.dailyRecords["2026-07-03"].inQuantity).toBe(2);
    });

    it("rejects when no item matches the given ledger + name", async () => {
      await expect(
        LedgerService.updateDailyRecordByKey("KID", "不存在的原料", "2026-07-03", { inQuantity: 1 })
      ).rejects.toThrow(/未在台账/);
    });
  });

  describe("cascadeUpdateMaterial / cascadeDeleteMaterial", () => {
    beforeEach(async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
    });

    it("renames every ledger item matching the old material name", () => {
      LedgerService.cascadeUpdateMaterial("土豆", "马铃薯", "公斤");
      const item = LedgerService.getLedgerItems().find((i) => i.name === "马铃薯");
      expect(item).toBeDefined();
      expect(item?.unit).toBe("公斤");
    });

    it("also updates spec when a newSpec is provided (regression: 4th arg used to be silently dropped)", () => {
      LedgerService.cascadeUpdateMaterial("土豆", "马铃薯", "公斤", "精品装");
      const item = LedgerService.getLedgerItems().find((i) => i.name === "马铃薯");
      expect(item?.spec).toBe("精品装");
      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "ledgerItem", op: "upsert", key: item!.id, data: expect.objectContaining({ name: "马铃薯", unit: "公斤", spec: "精品装" }) })
      );
    });

    it("leaves spec untouched when newSpec is omitted", () => {
      LedgerService.cascadeUpdateMaterial("土豆", "马铃薯", "公斤");
      const item = LedgerService.getLedgerItems().find((i) => i.name === "马铃薯");
      expect(item?.spec).toBe("散装");
    });

    it("is a no-op (does not notify) when no item matches the old name", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      LedgerService.cascadeUpdateMaterial("不存在", "新名字", "斤");
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });

    it("removes every ledger item matching the deleted material name", () => {
      const item = LedgerService.getLedgerItems().find((i) => i.name === "土豆")!;
      LedgerService.cascadeDeleteMaterial("土豆");
      expect(LedgerService.getLedgerItems()).toHaveLength(0);
      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "ledgerItem", op: "delete", key: item.id })
      );
    });

    it("is a no-op (does not notify) when no item matches the deleted name", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      LedgerService.cascadeDeleteMaterial("不存在");
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });
  });

  describe("helperDict", () => {
    it("returns the current helper dictionary", () => {
      const dict = LedgerService.getHelperDict();
      expect(dict.suppliers.length).toBeGreaterThan(0);
    });

    it("replaces the dictionary and notifies subscribers", () => {
      const received: any[] = [];
      LedgerService.subscribe(() => received.push(1));
      const newDict = { ...LedgerService.getHelperDict(), suppliers: ["新供货商"] };

      LedgerService.updateHelperDict(newDict);

      expect(LedgerService.getHelperDict().suppliers).toEqual(["新供货商"]);
      expect(received.length).toBeGreaterThan(1);
    });
  });

  describe("setLedgersInMemory / setLedgerItemsInMemory / forceNotify (heartbeat silent update)", () => {
    it("overwrites memory without triggering a server sync", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      LedgerService.setLedgersInMemory([makeLedger("A", "台账A")]);
      LedgerService.setLedgerItemsInMemory([]);
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
      expect(LedgerService.getLedgers()).toEqual([makeLedger("A", "台账A")]);
    });

    it("forceNotify broadcasts to subscribers without touching the server", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      const received: any[] = [];
      LedgerService.subscribe(() => received.push(1));
      const countAfterSubscribe = received.length;

      LedgerService.forceNotify();

      expect(received.length).toBe(countAfterSubscribe + 1);
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });
  });
});
