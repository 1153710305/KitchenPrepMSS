/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerService（原料购销台账业务数据服务层）单元测试：台账/原料 CRUD、每日出入库记录合并与库存重算、级联更新/删除、订阅通知契约。
 * [阶段B] updateLedger/deleteLedger/addLedgerItem/updateLedgerItem/deleteLedgerItem/updateDailyRecord(ByKey) 的
 * 校验/重算/级联规则已迁移到后端 REST API（/api/ledgers、/api/ledger-items），本文件改为对全局 fetch 打一个
 * 轻量的假后端路由（`fakeLedgerFetch`），镜像真实后端的持久化语义（校验/重算逻辑与迁移前的前端实现、
 * 以及 server/storageService.ts 的对应新方法保持一致），供本文件里大量"先增后改/先增后删/先增后记流水"的
 * 多步测试序列复用；真正的服务端校验/级联覆盖测试见 server/routes/ledgers.test.ts。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LedgerService } from "@/src/services/ledgerStore.ts";
import { SyncHelper } from "@/src/services/syncHelper.ts";
import { PrepReportService } from "@/src/services/store.ts";
import { RawMaterialsDictService } from "@/src/services/rawMaterialDict.ts";
import { FoodCategory } from "@/src/types/types.ts";
import type { Ledger, LedgerItem, DailyStockRecord } from "@/src/types/ledgerTypes.ts";

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

const okResponse = (body: any) => ({ ok: true, headers: new Headers(), json: async () => ({ success: true, ...body }) });
const errorResponse = (error: string) => ({ ok: false, headers: new Headers(), json: async () => ({ error }) });

/**
 * @description 假后端路由：镜像 server/storageService.ts 里 addLedgerItem/updateLedgerItem/deleteLedgerItem/
 * updateLedgerDailyRecord/updateLedger/deleteLedger 的校验、重算与持久化语义，读写直接落在 LedgerService
 * 自己的内存状态上（测试环境下就是"当前数据库状态"），使本文件既有的多步测试序列无需改造即可复用。
 */
function fakeLedgerFetch(url: string, options: any = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};

  let m = url.match(/^\/api\/ledgers\/([^/]+)\/items$/);
  if (m && method === "POST") {
    const ledgerId = decodeURIComponent(m[1]);
    const name = (body.name ?? "").trim();
    if (!name) return Promise.resolve(errorResponse("原料名称不能为空"));
    if (!LedgerService.getLedgers().some((l) => l.id === ledgerId)) return Promise.resolve(errorResponse("关联的台账不存在"));
    if (LedgerService.getLedgerItems().some((i) => i.ledgerId === ledgerId && i.name === name)) {
      return Promise.resolve(errorResponse(`该台账内已有名为 "${name}" 的采购项目原料`));
    }
    const initialStock = Math.max(0, body.initialStock ?? 0);
    const item: LedgerItem = {
      id: `ledger_item_${ledgerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ledgerId,
      name,
      unit: (body.unit ?? "").trim() || "斤",
      spec: (body.spec ?? "").trim() || "常规",
      initialStock,
      currentStock: initialStock,
      dailyRecords: {}
    };
    return Promise.resolve(okResponse({ item }));
  }

  m = url.match(/^\/api\/ledger-items\/([^/]+)\/daily\/([^/]+)$/);
  if (m && method === "PUT") {
    const itemId = decodeURIComponent(m[1]);
    const dateStr = decodeURIComponent(m[2]);
    const item = LedgerService.getLedgerItems().find((i) => i.id === itemId);
    if (!item) return Promise.resolve(errorResponse("找不到对应的采购原料项目"));

    const updatedDailyRecords: Record<string, DailyStockRecord> = { ...item.dailyRecords };
    const oldRecord: DailyStockRecord = updatedDailyRecords[dateStr] || { inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "" };
    const mergedRecord: DailyStockRecord = { ...oldRecord, ...body };
    mergedRecord.inQuantity = Number.isFinite(mergedRecord.inQuantity) ? Math.max(0, mergedRecord.inQuantity!) : 0;
    mergedRecord.inPrice = Number.isFinite(mergedRecord.inPrice) ? Math.max(0, mergedRecord.inPrice!) : 0;
    mergedRecord.inAmount = Math.round(mergedRecord.inQuantity * mergedRecord.inPrice * 100) / 100;
    mergedRecord.outQuantity = Number.isFinite(mergedRecord.outQuantity) ? Math.max(0, mergedRecord.outQuantity!) : 0;
    if (mergedRecord.note !== undefined) {
      mergedRecord.note = mergedRecord.note.trim();
    }
    const hasData =
      mergedRecord.inQuantity > 0 || mergedRecord.inPrice > 0 || mergedRecord.outQuantity > 0 ||
      (mergedRecord.note && mergedRecord.note.trim()) || (mergedRecord.certification && mergedRecord.certification.trim()) ||
      (mergedRecord.sensoryProperty && mergedRecord.sensoryProperty.trim()) || (mergedRecord.supplier && mergedRecord.supplier.trim()) ||
      (mergedRecord.buyer && mergedRecord.buyer.trim()) || (mergedRecord.inspector && mergedRecord.inspector.trim()) ||
      (mergedRecord.keeper && mergedRecord.keeper.trim()) || (mergedRecord.produceDate && mergedRecord.produceDate.trim()) ||
      (mergedRecord.shelfLife && mergedRecord.shelfLife.trim()) || (mergedRecord.outHandler && mergedRecord.outHandler.trim()) ||
      (mergedRecord.outRecipient && mergedRecord.outRecipient.trim());
    if (!hasData) {
      delete updatedDailyRecords[dateStr];
    } else {
      updatedDailyRecords[dateStr] = mergedRecord;
    }
    let sumIn = 0;
    let sumOut = 0;
    Object.values(updatedDailyRecords).forEach((record) => {
      sumIn += record.inQuantity || 0;
      sumOut += record.outQuantity || 0;
    });
    const updatedItem: LedgerItem = {
      ...item,
      dailyRecords: updatedDailyRecords,
      currentStock: Math.round((item.initialStock + sumIn - sumOut) * 100) / 100
    };
    return Promise.resolve(okResponse({ item: updatedItem, mergedRecord }));
  }

  m = url.match(/^\/api\/ledger-items\/([^/]+)$/);
  if (m && method === "PUT") {
    const id = decodeURIComponent(m[1]);
    const oldItem = LedgerService.getLedgerItems().find((i) => i.id === id);
    if (!oldItem) return Promise.resolve(errorResponse("找不到该采购原料项目"));
    const normalizedName = (body.name ?? "").trim();
    if (LedgerService.getLedgerItems().some((i) => i.ledgerId === oldItem.ledgerId && i.name === normalizedName && i.id !== id)) {
      return Promise.resolve(errorResponse(`台账内已有名为 "${normalizedName}" 的原料`));
    }
    const initialStock = Math.max(0, body.initialStock ?? 0);
    let sumIn = 0;
    let sumOut = 0;
    Object.values(oldItem.dailyRecords ?? {}).forEach((record) => {
      sumIn += record.inQuantity || 0;
      sumOut += record.outQuantity || 0;
    });
    const updatedItem: LedgerItem = {
      ...oldItem,
      name: normalizedName,
      unit: (body.unit ?? "").trim() || "斤",
      spec: (body.spec ?? "").trim() || "常规",
      initialStock,
      currentStock: initialStock + sumIn - sumOut
    };
    return Promise.resolve(okResponse({ item: updatedItem }));
  }
  if (m && method === "DELETE") {
    const id = decodeURIComponent(m[1]);
    if (!LedgerService.getLedgerItems().some((i) => i.id === id)) return Promise.resolve(errorResponse("找不到要删除的原料项目"));
    return Promise.resolve(okResponse({}));
  }

  m = url.match(/^\/api\/ledgers\/([^/]+)$/);
  if (m && method === "PUT") {
    const id = decodeURIComponent(m[1]);
    const normalizedName = (body.name ?? "").trim();
    if (!normalizedName) return Promise.resolve(errorResponse("台账名称不能为空"));
    const ledger = LedgerService.getLedgers().find((l) => l.id === id);
    if (!ledger) return Promise.resolve(errorResponse("找不到该台账"));
    if (LedgerService.getLedgers().some((l) => l.name === normalizedName && l.id !== id)) {
      return Promise.resolve(errorResponse(`名称为 "${normalizedName}" 的台账已存在`));
    }
    return Promise.resolve(okResponse({ ledger: { ...ledger, name: normalizedName } }));
  }
  if (m && method === "DELETE") {
    const id = decodeURIComponent(m[1]);
    if (!LedgerService.getLedgers().some((l) => l.id === id)) return Promise.resolve(errorResponse("找不到待删除的台账"));
    return Promise.resolve(okResponse({}));
  }

  // /api/log 等其它调用（如 LogBroker 上报）一律无害放行
  return Promise.resolve(okResponse({}));
}

describe("LedgerService", () => {
  beforeEach(() => {
    resetLedgerService();
    vi.spyOn(PrepReportService, "syncGroupFromLedger").mockImplementation(() => {});
    vi.spyOn(PrepReportService, "syncDeleteGroupFromLedger").mockImplementation(() => {});
    vi.spyOn(RawMaterialsDictService, "getCategoryForMaterial").mockReturnValue("VEGETABLE");
    vi.spyOn(SyncHelper, "refreshNow").mockResolvedValue(false);
    vi.stubGlobal("fetch", vi.fn(fakeLedgerFetch));
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

  describe("updateLedger [阶段B：校验/级联已迁移到后端]", () => {
    beforeEach(() => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐"), makeLedger("STU", "在校生备餐")]);
    });

    it("renames a ledger using the backend's response and immediately refreshes (级联现在完全由后端完成)", async () => {
      await LedgerService.updateLedger("KID", "幼儿新名字");
      expect(LedgerService.getLedgers().find((l) => l.id === "KID")?.name).toBe("幼儿新名字");
      // 级联同步餐位人群配置已由后端一次事务完成，前端不再调用 PrepReportService.syncGroupFromLedger，
      // 而是立即刷新一次全量状态
      expect(PrepReportService.syncGroupFromLedger).not.toHaveBeenCalled();
      expect(SyncHelper.refreshNow).toHaveBeenCalledTimes(1);
    });

    it("rejects with the backend's empty-name error", async () => {
      await expect(LedgerService.updateLedger("KID", "   ")).rejects.toThrow("台账名称不能为空");
    });

    it("rejects with the backend's not-found error", async () => {
      await expect(LedgerService.updateLedger("NOPE", "新名字")).rejects.toThrow("找不到该台账");
    });

    it("rejects with the backend's duplicate-name error", async () => {
      await expect(LedgerService.updateLedger("KID", "在校生备餐")).rejects.toThrow(/已存在/);
    });

    it("allows renaming to the exact same name (no collision with itself)", async () => {
      await expect(LedgerService.updateLedger("KID", "幼儿备餐")).resolves.toBeUndefined();
    });
  });

  describe("deleteLedger [阶段B：校验/级联已迁移到后端]", () => {
    beforeEach(async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
    });

    it("removes the ledger and its items, and immediately refreshes (级联现在完全由后端完成)", async () => {
      await LedgerService.deleteLedger("KID");
      expect(LedgerService.getLedgers()).toHaveLength(0);
      expect(LedgerService.getLedgerItems()).toHaveLength(0);
      // 级联移除餐位人群与月度报表已由后端一次事务完成，前端不再调用 PrepReportService.syncDeleteGroupFromLedger
      expect(PrepReportService.syncDeleteGroupFromLedger).not.toHaveBeenCalled();
      expect(SyncHelper.refreshNow).toHaveBeenCalledTimes(1);
    });

    it("does not remove items belonging to other ledgers", async () => {
      LedgerService.setLedgersInMemory([...LedgerService.getLedgers(), makeLedger("STU", "在校生备餐")]);
      await LedgerService.addLedgerItem("STU", "胡萝卜", "斤", "散装", 5);

      await LedgerService.deleteLedger("KID");

      expect(LedgerService.getLedgerItems().map((i) => i.name)).toEqual(["胡萝卜"]);
    });

    it("rejects with the backend's not-found error", async () => {
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
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      LedgerService.syncLedgerFromGroup("TEACHER", "教师备餐");
      expect(queueChangeSpy).not.toHaveBeenCalled();
    });

    it("deletes a ledger case-insensitively by id and cascades its items", async () => {
      LedgerService.setLedgersInMemory([makeLedger("kid", "幼儿备餐")]);
      await LedgerService.addLedgerItem("kid", "土豆", "斤", "散装", 10);

      LedgerService.syncDeleteLedgerFromGroup("KID");

      expect(LedgerService.getLedgers()).toHaveLength(0);
      expect(LedgerService.getLedgerItems()).toHaveLength(0);
    });
  });

  describe("addLedgerItem [阶段B：校验已迁移到后端]", () => {
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

    it("rejects with the backend's empty-name error", async () => {
      await expect(LedgerService.addLedgerItem("KID", "  ", "斤", "散装", 0)).rejects.toThrow("原料名称不能为空");
    });

    it("rejects with the backend's ledger-not-found error", async () => {
      await expect(LedgerService.addLedgerItem("NOPE", "土豆", "斤", "散装", 0)).rejects.toThrow("关联的台账不存在");
    });

    it("rejects with the backend's duplicate-name error within the same ledger", async () => {
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
      await expect(LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 5)).rejects.toThrow(/已有名为/);
    });

    it("allows the same material name across two different ledgers", async () => {
      LedgerService.setLedgersInMemory([...LedgerService.getLedgers(), makeLedger("STU", "在校生备餐")]);
      await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);
      await expect(LedgerService.addLedgerItem("STU", "土豆", "斤", "散装", 5)).resolves.toBeDefined();
    });
  });

  describe("updateLedgerItem [阶段B：校验/重算已迁移到后端]", () => {
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

    it("rejects with the backend's not-found error", async () => {
      await expect(LedgerService.updateLedgerItem("nope", "x", "斤", "y", 0)).rejects.toThrow("找不到该采购原料项目");
    });

    it("rejects with the backend's duplicate-name error within the same ledger", async () => {
      await LedgerService.addLedgerItem("KID", "柿子", "斤", "散装", 5);
      await expect(LedgerService.updateLedgerItem(itemId, "柿子", "斤", "散装", 10)).rejects.toThrow(/已有名为/);
    });
  });

  describe("deleteLedgerItem [阶段B：校验已迁移到后端]", () => {
    it("removes the item", async () => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      const item = await LedgerService.addLedgerItem("KID", "土豆", "斤", "散装", 10);

      await LedgerService.deleteLedgerItem(item.id);

      expect(LedgerService.getLedgerItems()).toHaveLength(0);
    });

    it("rejects with the backend's not-found error", async () => {
      await expect(LedgerService.deleteLedgerItem("nope")).rejects.toThrow("找不到要删除的原料项目");
    });
  });

  describe("updateDailyRecord [阶段B：合并/校验/重算已迁移到后端]", () => {
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

    it("calls PUT /api/ledger-items/:id/daily/:date and applies the backend's recalculated currentStock", async () => {
      const fetchSpy = vi.fn(fakeLedgerFetch);
      vi.stubGlobal("fetch", fetchSpy);

      await LedgerService.updateDailyRecord(itemId, "2026-07-03", { inQuantity: 3, inPrice: 2 });

      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/ledger-items/${itemId}/daily/2026-07-03`,
        expect.objectContaining({ method: "PUT" })
      );
      const item = LedgerService.getLedgerItems().find((i) => i.id === itemId)!;
      expect(item.currentStock).toBe(103);
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

    it("rejects with the backend's not-found error", async () => {
      await expect(LedgerService.updateDailyRecord("nope", "2026-07-03", { inQuantity: 1 })).rejects.toThrow(
        "找不到对应的采购原料项目"
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
    // 这两个方法保留在 LedgerService 里（阶段A起生产代码已不再调用，原料字典的跨表级联现在完全由后端
    // 一次事务完成），本描述块直接测试方法本身的纯内存行为，与迁移前完全一致
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
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      LedgerService.cascadeUpdateMaterial("土豆", "马铃薯", "公斤", "精品装");
      const item = LedgerService.getLedgerItems().find((i) => i.name === "马铃薯");
      expect(item?.spec).toBe("精品装");
      expect(queueChangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "ledgerItem", op: "upsert", key: item!.id, data: expect.objectContaining({ name: "马铃薯", unit: "公斤", spec: "精品装" }) })
      );
    });

    it("leaves spec untouched when newSpec is omitted", () => {
      LedgerService.cascadeUpdateMaterial("土豆", "马铃薯", "公斤");
      const item = LedgerService.getLedgerItems().find((i) => i.name === "马铃薯");
      expect(item?.spec).toBe("散装");
    });

    it("is a no-op (does not notify) when no item matches the old name", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      LedgerService.cascadeUpdateMaterial("不存在", "新名字", "斤");
      expect(queueChangeSpy).not.toHaveBeenCalled();
    });

    it("removes every ledger item matching the deleted material name", () => {
      const item = LedgerService.getLedgerItems().find((i) => i.name === "土豆")!;
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      LedgerService.cascadeDeleteMaterial("土豆");
      expect(LedgerService.getLedgerItems()).toHaveLength(0);
      expect(queueChangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "ledgerItem", op: "delete", key: item.id })
      );
    });

    it("is a no-op (does not notify) when no item matches the deleted name", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      LedgerService.cascadeDeleteMaterial("不存在");
      expect(queueChangeSpy).not.toHaveBeenCalled();
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

  describe("setLedgersInMemory / setLedgerItemsInMemory / forceNotify (refreshNow silent update)", () => {
    it("overwrites memory without triggering a server sync", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      LedgerService.setLedgersInMemory([makeLedger("A", "台账A")]);
      LedgerService.setLedgerItemsInMemory([]);
      expect(queueChangeSpy).not.toHaveBeenCalled();
      expect(LedgerService.getLedgers()).toEqual([makeLedger("A", "台账A")]);
    });

    it("forceNotify broadcasts to subscribers without touching the server", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      const received: any[] = [];
      LedgerService.subscribe(() => received.push(1));
      const countAfterSubscribe = received.length;

      LedgerService.forceNotify();

      expect(received.length).toBe(countAfterSubscribe + 1);
      expect(queueChangeSpy).not.toHaveBeenCalled();
    });
  });

});
