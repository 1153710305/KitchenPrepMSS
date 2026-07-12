/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description PrepReportService（备餐采购/月度报表业务数据服务层）单元测试：台账双向同步、一二级配置增删改与默认数据保护、级联更新/删除。
 * [阶段C] saveGroup/deleteGroup/saveCategory/deleteCategory 的校验/重算/级联规则已迁移到后端
 * REST API，本文件改为对全局 fetch 打一个轻量的假后端路由（`fakePrepReportFetch`），镜像真实后端语义，支撑本文件里
 * 大量多步测试序列；真正的服务端校验/级联覆盖测试见 server/routes/reports.test.ts。getOrCreateReport/syncFromLedger/
 * syncGroupFromLedger/syncDeleteLedgerFromGroup 四个方法因架构约束（getOrCreateReport 在 App.tsx 里被同步 useMemo
 * 直接调用，无法改造成异步 REST 调用）或尚未到迁移阶段（阶段C范围内 PrepReportService 只完成"自己被调用"的一侧，
 * syncFromLedger 是"调用 LedgerService"的一侧，留给以后需要时再统一处理）仍是纯前端实现，测试保持不变。
 * addPreparedItem/updateCell/deletePreparedItem/batchUpdatePriceCol 及其后端路由/StorageService方法已确认为
 * 死代码一并删除（餐位分组页面下的采购细表自 V5.2.0 起即为只读展示，数据录入统一通过原料购销台账完成；
 * batchUpdatePriceCol 的一键调价功能自身也从未被任何按钮实际触发过）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrepReportService } from "@/src/services/store.ts";
import { SyncHelper } from "@/src/services/syncHelper.ts";
import { LedgerService } from "@/src/services/ledgerStore.ts";
import { RawMaterialsDictService } from "@/src/services/rawMaterialDict.ts";
import { FoodCategory, TargetGroup, GroupMonthlyReport, PreparedItem } from "@/src/types/types.ts";

function resetPrepReportService() {
  PrepReportService.setReportsInMemory([]);
  PrepReportService.setActiveGroupsInMemory([]);
  PrepReportService.setActiveCategoriesInMemory([]);
  (PrepReportService as any).changeListeners = [];
}

const makeItem = (overrides: Partial<PreparedItem> = {}): PreparedItem => ({
  id: overrides.id || "item_1",
  name: overrides.name || "土豆",
  category: overrides.category || "VEGETABLE",
  targetGroup: overrides.targetGroup || "KID",
  unit: overrides.unit || "斤",
  dailyData: overrides.dailyData || {}
});

const makeReport = (overrides: Partial<GroupMonthlyReport> = {}): GroupMonthlyReport => ({
  targetGroup: overrides.targetGroup || "KID",
  year: overrides.year ?? 2026,
  month: overrides.month ?? 7,
  items: overrides.items || []
});

const okResponse = (body: any) => ({ ok: true, headers: new Headers(), json: async () => ({ success: true, ...body }) });
const errorResponse = (error: string) => ({ ok: false, json: async () => ({ error }) });

/**
 * @description 假后端路由：镜像 server/storageService.ts 里 saveGroup/deleteGroup/saveCategory/deleteCategory
 * 的校验与重算语义，读写直接落在 PrepReportService/LedgerService 自己的内存状态上（测试环境下就是"当前数据库状态"）。
 */
function fakePrepReportFetch(url: string, options: any = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};

  let m = url.match(/^\/api\/groups\/([^/]*)$/);
  if (m && method === "PUT") {
    const upperKey = decodeURIComponent(m[1]).toUpperCase();
    if (!upperKey.trim()) return Promise.resolve(errorResponse("人群标识键不能为空"));
    const trimmedLabel = (body.label ?? "").trim();
    if (!trimmedLabel) return Promise.resolve(errorResponse("人群名称标签不能为空"));
    const existing = PrepReportService.getActiveGroups().find((g) => g.key === upperKey);
    const group = { key: upperKey, label: trimmedLabel, emoji: (body.emoji ?? "").trim() || "🍽️", isDefault: existing?.isDefault };
    return Promise.resolve(okResponse({ group }));
  }
  if (m && method === "DELETE") {
    const upperKey = decodeURIComponent(m[1]).toUpperCase();
    const target = PrepReportService.getActiveGroups().find((g) => g.key.toUpperCase() === upperKey);
    if (target?.isDefault) return Promise.resolve(errorResponse(`「${target.label}」是系统默认人群，不允许删除，如需调整可编辑其名称或图标`));
    return Promise.resolve(okResponse({}));
  }

  m = url.match(/^\/api\/categories\/([^/]*)$/);
  if (m && method === "PUT") {
    const upperKey = decodeURIComponent(m[1]).toUpperCase();
    if (!upperKey.trim()) return Promise.resolve(errorResponse("大类标识键不能为空"));
    const trimmedLabel = (body.label ?? "").trim();
    if (!trimmedLabel) return Promise.resolve(errorResponse("大类名称标签不能为空"));
    const existing = PrepReportService.getActiveCategories().find((c) => c.key === upperKey);
    const category = { key: upperKey, label: trimmedLabel, isDefault: existing?.isDefault };
    return Promise.resolve(okResponse({ category }));
  }
  if (m && method === "DELETE") {
    const upperKey = decodeURIComponent(m[1]).toUpperCase();
    const target = PrepReportService.getActiveCategories().find((c) => c.key === upperKey);
    if (target?.isDefault) return Promise.resolve(errorResponse(`「${target.label}」是系统默认大类，不允许删除，如需调整可编辑其名称`));
    return Promise.resolve(okResponse({}));
  }

  return Promise.resolve(okResponse({}));
}

describe("PrepReportService", () => {
  beforeEach(() => {
    resetPrepReportService();
    LedgerService.setLedgersInMemory([]);
    LedgerService.setLedgerItemsInMemory([]);
    vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
    vi.spyOn(SyncHelper, "runWhenInitialized").mockImplementation((fn) => fn());
    vi.spyOn(SyncHelper, "refreshNow").mockResolvedValue(false);
    vi.spyOn(LedgerService, "updateDailyRecordByKey").mockResolvedValue(undefined);
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
    vi.stubGlobal("fetch", vi.fn(fakePrepReportFetch));
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
      expect(result.items[0].dailyData["1"]).toBeUndefined();
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

  describe("syncFromLedger", () => {
    beforeEach(() => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜", isDefault: true } as any]);
    });

    it("creates a new item row on first sync for a not-yet-tracked material", async () => {
      await 

      const report = PrepReportService.getReports().find((r) => r.targetGroup === "KID")!;
      const item = report.items.find((i) => i.name === "土豆")!;
      expect(item).toBeDefined();
      expect(item.dailyData["3"]).toEqual({ quantity: 5, price: 2, amount: 10 });
    });

    it("is idempotent: syncing the same material/day twice updates in place rather than duplicating rows", async () => {
      await 
      await 

      const report = PrepReportService.getReports().find((r) => r.targetGroup === "KID")!;
      const matches = report.items.filter((i) => i.name === "土豆");
      expect(matches).toHaveLength(1);
      expect(matches[0].dailyData["3"]).toEqual({ quantity: 8, price: 3, amount: 24 });
    });

    it("lazily creates the monthly report if it does not exist yet", async () => {
      expect(PrepReportService.getReports()).toHaveLength(0);
      await 
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
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: "TEACHER" })]);

      PrepReportService.syncDeleteGroupFromLedger("teacher");

      expect(PrepReportService.getActiveGroups()).toHaveLength(0);
      expect(PrepReportService.getReports()).toHaveLength(0);
    });
  });

  describe("saveGroup / deleteGroup [阶段C：校验/isDefault保留/级联同步台账已迁移到后端]", () => {
    it("creates a new group using the backend's response", async () => {
      await PrepReportService.saveGroup("teacher", "教师备餐", "👩‍🏫");

      expect(PrepReportService.getActiveGroups().find((g) => g.key === "TEACHER")?.label).toBe("教师备餐");
      // 级联同步创建对应台账已由后端一次事务完成，前端不再自行调用 LedgerService，而是立即刷新
      expect(SyncHelper.refreshNow).toHaveBeenCalledTimes(1);
    });

    it("edits an existing group in place while preserving its isDefault flag", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "旧名字", emoji: "👶", isDefault: true } as any]);

      await PrepReportService.saveGroup("kid", "幼儿新名字", "👶");

      const group = PrepReportService.getActiveGroups().find((g) => g.key === "KID")!;
      expect(group.label).toBe("幼儿新名字");
      expect(group.isDefault).toBe(true);
    });

    it("rejects with the backend's empty key/label error", async () => {
      await expect(PrepReportService.saveGroup("", "名字", "🍽️")).rejects.toThrow("人群标识键不能为空");
      await expect(PrepReportService.saveGroup("key", "  ", "🍽️")).rejects.toThrow("人群名称标签不能为空");
    });

    it("refuses to delete a default group using the backend's error message", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿", isDefault: true } as any]);
      await expect(PrepReportService.deleteGroup("KID")).rejects.toThrow(/系统默认人群，不允许删除/);
      expect(PrepReportService.getActiveGroups()).toHaveLength(1);
    });

    it("deletes a non-default group and cascades to its then immediately refreshes", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "CUSTOM", label: "自定义群体", isDefault: false } as any]);
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: "CUSTOM" as TargetGroup })]);

      await PrepReportService.deleteGroup("CUSTOM");

      expect(PrepReportService.getActiveGroups()).toHaveLength(0);
      expect(PrepReportService.getReports()).toHaveLength(0);
      expect(SyncHelper.refreshNow).toHaveBeenCalledTimes(1);
    });
  });

  describe("saveCategory / deleteCategory [阶段C：校验/isDefault保留已迁移到后端]", () => {
    it("creates a new category using the backend's response", async () => {
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

    it("refuses to delete a default category using the backend's error message", async () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜", isDefault: true } as any]);
      await expect(PrepReportService.deleteCategory("VEGETABLE")).rejects.toThrow(/系统默认大类，不允许删除/);
    });

    it("deletes a non-default category and strips matching items from every report", async () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "CUSTOM", label: "自定义大类", isDefault: false } as any]);
      PrepReportService.setReportsInMemory([
        makeReport({ items: [makeItem({ id: "a", category: "CUSTOM" as FoodCategory }), makeItem({ id: "b", category: "VEGETABLE" })] })
      ]);

      await PrepReportService.deleteCategory("CUSTOM");

      expect(PrepReportService.getActiveCategories()).toHaveLength(0);
      const remainingIds = PrepReportService.getReports()[0].items.map((i) => i.id);
      expect(remainingIds).toEqual(["b"]);
    });
  });

  describe("cascadeUpdateMaterial / cascadeDeleteMaterial", () => {
    // 这两个方法保留在 PrepReportService 里（阶段A起生产代码已不再调用，原料字典的跨表级联现在完全由后端
    // 一次事务完成），本描述块直接测试方法本身的纯内存行为，与迁移前完全一致
    it("renames matching items across every report and updates their category/unit", () => {
      PrepReportService.setReportsInMemory([
        makeReport({ targetGroup: "KID", items: [makeItem({ name: "土豆" })] }),
        makeReport({ targetGroup: "TEACHER", items: [makeItem({ id: "item_2", name: "土豆" })] })
      ]);

      PrepReportService.cascadeUpdateMaterial("土豆", "马铃薯", "VEGETABLE", "公斤");

      const allItems = PrepReportService.getReports().flatMap((r) => r.items);
      expect(allItems.every((i) => i.name === "马铃薯" && i.unit === "公斤")).toBe(true);
    });

    it("is a no-op notify when no item matches the old name", () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ name: "土豆" })] })]);
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});

      PrepReportService.cascadeUpdateMaterial("不存在", "新名字", "VEGETABLE", "斤");

      expect(queueChangeSpy).not.toHaveBeenCalled();
    });

    it("removes matching items across every report on cascade delete", () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ id: "a", name: "土豆" }), makeItem({ id: "b", name: "柿子" })] })]);

      PrepReportService.cascadeDeleteMaterial("土豆");

      expect(PrepReportService.getReports()[0].items.map((i) => i.id)).toEqual(["b"]);
    });

    it("is a no-op notify when no item matches the deleted name", () => {
      PrepReportService.setReportsInMemory([makeReport({ items: [makeItem({ name: "土豆" })] })]);
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});

      PrepReportService.cascadeDeleteMaterial("不存在");

      expect(queueChangeSpy).not.toHaveBeenCalled();
    });
  });

  describe("cascadeDeleteLedgerItem [回归：删除台账原料项后左下角支出/趋势图未更新]", () => {
    // 台账原料项目被物理删除后，需要级联清除对应受众人群名下由 syncFromLedger 反向同步生成的同名备餐细项
    // （含其全部逐日数量/单价/金额），否则左下角"当月采购支出"与花销趋势图会继续包含已删除原料的历史入库金额
    it("removes the matching item only from reports belonging to the same target group", () => {
      PrepReportService.setReportsInMemory([
        makeReport({ targetGroup: "KID", items: [makeItem({ id: "a", name: "土豆", targetGroup: "KID" })] }),
        makeReport({ targetGroup: "TEACHER", items: [makeItem({ id: "b", name: "土豆", targetGroup: "TEACHER" })] })
      ]);

      

      const kidReport = PrepReportService.getReports().find((r) => r.targetGroup === "KID")!;
      const teacherReport = PrepReportService.getReports().find((r) => r.targetGroup === "TEACHER")!;
      expect(kidReport.items).toHaveLength(0);
      expect(teacherReport.items.map((i) => i.id)).toEqual(["b"]);
    });

    it("removes the matching item across every month's report for that target group", () => {
      PrepReportService.setReportsInMemory([
        makeReport({ targetGroup: "KID", month: 6, items: [makeItem({ id: "a", name: "土豆" })] }),
        makeReport({ targetGroup: "KID", month: 7, items: [makeItem({ id: "b", name: "土豆" })] })
      ]);

      

      expect(PrepReportService.getReports().every((r) => r.items.length === 0)).toBe(true);
    });

    it("is a no-op notify when no item matches", () => {
      PrepReportService.setReportsInMemory([makeReport({ targetGroup: "KID", items: [makeItem({ name: "土豆" })] })]);
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});

      

      expect(queueChangeSpy).not.toHaveBeenCalled();
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
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      PrepReportService.setReportsInMemory([makeReport()]);
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿" } as any]);
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜" } as any]);

      expect(queueChangeSpy).not.toHaveBeenCalled();
      expect(PrepReportService.getReports()).toHaveLength(1);
    });

    it("forceNotify broadcasts to subscribers without touching the server", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      const received: any[] = [];
      const unsubscribe = PrepReportService.subscribe((reports) => received.push(reports));

      PrepReportService.forceNotify();

      expect(received.length).toBeGreaterThan(0);
      expect(queueChangeSpy).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

});
