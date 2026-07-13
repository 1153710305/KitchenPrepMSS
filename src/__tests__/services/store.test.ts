/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description PrepReportService（一二级人群/食材大类配置服务层）单元测试：台账→人群配置同步、配置增删改与默认数据保护。
 * [V2 架构演进] 备餐报表双状态（reports/getOrCreateReport/syncFromLedger/cascadeUpdateMaterial/
 * cascadeDeleteMaterial 等）已随本次重构整体删除——TableGrid 等展示视图现在直接以台账 LedgerItem
 * 数据实时派生渲染，不再需要一份独立同步维护的备餐报表。PrepReportService 现在只负责维护
 * activeGroups/activeCategories 两份一二级配置，本文件同步只保留仍然存在的 API 的测试。
 * saveGroup/deleteGroup/saveCategory/deleteCategory 的校验/重算/级联规则已迁移到后端 REST API，
 * 本文件对全局 fetch 打一个轻量的假后端路由（`fakePrepReportFetch`），镜像真实后端语义；
 * 真正的服务端校验/级联覆盖测试见 server/routes/reports.test.ts。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrepReportService } from "@/src/services/store.ts";
import { SyncHelper } from "@/src/services/syncHelper.ts";
import { LedgerService } from "@/src/services/ledgerStore.ts";
import { RawMaterialsDictService } from "@/src/services/rawMaterialDict.ts";

function resetPrepReportService() {
  PrepReportService.setActiveGroupsInMemory([]);
  PrepReportService.setActiveCategoriesInMemory([]);
  (PrepReportService as any).changeListeners = [];
}

const okResponse = (body: any) => ({ ok: true, headers: new Headers(), json: async () => ({ success: true, ...body }) });
const errorResponse = (error: string) => ({ ok: false, status: 400, headers: new Headers(), json: async () => ({ error }) });

/**
 * @description 假后端路由：镜像 server/storageService.ts 里 saveGroup/deleteGroup/saveCategory/deleteCategory
 * 的校验与重算语义，读写直接落在 PrepReportService 自己的内存状态上（测试环境下就是"当前数据库状态"）。
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
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
    vi.stubGlobal("fetch", vi.fn(fakePrepReportFetch));
  });

  afterEach(() => {
    resetPrepReportService();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("syncGroupFromLedger / syncDeleteGroupFromLedger", () => {
    it("adds a new active group when the id is unseen", () => {
      PrepReportService.syncGroupFromLedger("TEACHER", "教师备餐");

      expect(PrepReportService.getActiveGroups().find((g) => g.key === "TEACHER")?.label).toBe("教师备餐");
    });

    it("renames an existing active group instead of duplicating it", () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "TEACHER", label: "旧名字" } as any]);
      PrepReportService.syncGroupFromLedger("TEACHER", "新名字");

      expect(PrepReportService.getActiveGroups()).toHaveLength(1);
      expect(PrepReportService.getActiveGroups()[0].label).toBe("新名字");
    });

    it("is a no-op when the label has not actually changed", () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "TEACHER", label: "教师备餐" } as any]);
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});

      PrepReportService.syncGroupFromLedger("TEACHER", "教师备餐");

      expect(queueChangeSpy).not.toHaveBeenCalled();
    });

    it("removes the group on delete-sync", () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "TEACHER", label: "教师备餐" } as any]);

      PrepReportService.syncDeleteGroupFromLedger("teacher");

      expect(PrepReportService.getActiveGroups()).toHaveLength(0);
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

    it("deletes a non-default group and immediately refreshes", async () => {
      PrepReportService.setActiveGroupsInMemory([{ key: "CUSTOM", label: "自定义群体", isDefault: false } as any]);

      await PrepReportService.deleteGroup("CUSTOM");

      expect(PrepReportService.getActiveGroups()).toHaveLength(0);
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

    it("deletes a non-default category", async () => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "CUSTOM", label: "自定义大类", isDefault: false } as any]);

      await PrepReportService.deleteCategory("CUSTOM");

      expect(PrepReportService.getActiveCategories()).toHaveLength(0);
    });
  });

  describe("subscribe / notify contract", () => {
    it("delivers a notification to subscribers on every mutating action", async () => {
      let callCount = 0;
      const unsubscribe = PrepReportService.subscribe(() => { callCount += 1; });

      await PrepReportService.saveCategory("dessert", "甜品");

      expect(callCount).toBeGreaterThan(0);
      unsubscribe();
    });

    it("does not let a throwing listener during broadcast block other listeners", async () => {
      let firstCallCount = 0;
      PrepReportService.subscribe(() => {
        firstCallCount += 1;
        throw new Error("boom");
      });
      let secondCallCount = 0;
      PrepReportService.subscribe(() => { secondCallCount += 1; });

      await expect(PrepReportService.saveCategory("dessert", "甜品")).resolves.toBeUndefined();
      expect(firstCallCount).toBe(1);
      expect(secondCallCount).toBe(1);
    });
  });

  describe("setActiveGroupsInMemory / setActiveCategoriesInMemory / forceNotify (heartbeat silent update)", () => {
    it("overwrites memory without triggering a server sync", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿" } as any]);
      PrepReportService.setActiveCategoriesInMemory([{ key: "VEGETABLE", label: "蔬菜" } as any]);

      expect(queueChangeSpy).not.toHaveBeenCalled();
      expect(PrepReportService.getActiveGroups()).toHaveLength(1);
      expect(PrepReportService.getActiveCategories()).toHaveLength(1);
    });

    it("forceNotify broadcasts to subscribers without touching the server", () => {
      const queueChangeSpy = vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
      let callCount = 0;
      const unsubscribe = PrepReportService.subscribe(() => { callCount += 1; });

      PrepReportService.forceNotify();

      expect(callCount).toBeGreaterThan(0);
      expect(queueChangeSpy).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
});
