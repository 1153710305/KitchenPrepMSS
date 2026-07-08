/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description RawMaterialsDictService（原料大字典业务数据服务层）单元测试：增删改、isDefault 默认数据保护、历史数据去重与迁移。
 * [阶段A] addMaterial/updateMaterial/deleteMaterial 的校验/isDefault保护/级联规则已迁移到后端 REST API
 * （/api/raw-materials），这里改为 mock 全局 fetch 的 200/400 两类响应，不再断言 LedgerService/PrepReportService
 * 的 cascade 方法被调用——那两个方法虽仍保留在 ledgerStore.ts/store.ts 里（供其独立单元测试使用），
 * 但生产代码里已不再被 rawMaterialDict.ts 调用，级联现在完全由后端一次事务完成。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RawMaterialsDictService, RawMaterialDictItem } from "@/src/services/rawMaterialDict.ts";
import { SyncHelper } from "@/src/services/syncHelper.ts";
import { FoodCategory } from "@/src/types/types.ts";

function resetDict() {
  RawMaterialsDictService.setRawMaterialsDictInMemory([]);
}

/** 构造一次 fetch 成功响应：{ ok: true, json: async () => { success: true, item } } */
const okResponse = (item: any) => ({ ok: true, json: async () => ({ success: true, item }) });
/** 构造一次 fetch 失败响应：{ ok: false, json: async () => { error } } */
const errorResponse = (error: string) => ({ ok: false, json: async () => ({ error }) });

describe("RawMaterialsDictService", () => {
  beforeEach(() => {
    resetDict();
    vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
    vi.spyOn(SyncHelper, "runWhenInitialized").mockImplementation((fn) => fn());
    vi.spyOn(SyncHelper, "refreshNow").mockResolvedValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  });

  afterEach(() => {
    resetDict();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("initDict / getItems (seed generation)", () => {
    it("returns an empty array when memory is empty", () => {
      const items = RawMaterialsDictService.getItems();
      expect(items.length).toBe(0);
    });

    it("does not regenerate seeds once items already exist", () => {
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "自定义原料", category: "VEGETABLE", unit: "斤" }
      ]);
      const items = RawMaterialsDictService.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe("自定义原料");
    });
  });

  describe("initDictFromServer", () => {
    it("adopts the server's dictionary when it has entries", () => {
      const serverItems: RawMaterialDictItem[] = [{ name: "土豆", category: "VEGETABLE", unit: "斤", isDefault: true }];
      const result = RawMaterialsDictService.initDictFromServer(serverItems);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("土豆");
    });

    it("deduplicates same-name entries, keeping the last occurrence", () => {
      const serverItems: RawMaterialDictItem[] = [
        { name: "土豆", category: "VEGETABLE", unit: "斤", remark: "旧" },
        { name: "土豆", category: "VEGETABLE", unit: "公斤", remark: "新" }
      ];
      const result = RawMaterialsDictService.initDictFromServer(serverItems);
      expect(result).toHaveLength(1);
      expect(result[0].remark).toBe("新");
      expect(result[0].unit).toBe("公斤");
    });


    it("leaves the list empty and does not queue any replaceAll when the server has no data", () => {
      const result = RawMaterialsDictService.initDictFromServer([]);
      expect(result.length).toBe(0);
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });

    it("leaves the list empty when the server data is undefined", () => {
      const result = RawMaterialsDictService.initDictFromServer(undefined);
      expect(result.length).toBe(0);
    });
  });

  describe("getCategoryForMaterial / getUnitForMaterial", () => {
    beforeEach(() => {
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "土豆", category: "VEGETABLE", unit: "斤" }
      ]);
    });

    it("returns the category for a known material", () => {
      expect(RawMaterialsDictService.getCategoryForMaterial("土豆")).toBe("VEGETABLE");
    });

    it("returns null for an unknown material", () => {
      expect(RawMaterialsDictService.getCategoryForMaterial("不存在")).toBeNull();
    });

    it("returns the unit for a known material", () => {
      expect(RawMaterialsDictService.getUnitForMaterial("土豆")).toBe("斤");
    });

    it("defaults to 斤 for an unknown material", () => {
      expect(RawMaterialsDictService.getUnitForMaterial("不存在")).toBe("斤");
    });
  });

  describe("addMaterial", () => {
    it("posts to /api/raw-materials and adds the item returned by the backend", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(okResponse({ name: "新原料", category: "VEGETABLE", unit: "斤", remark: "" }));
      vi.stubGlobal("fetch", fetchSpy);

      await RawMaterialsDictService.addMaterial("新原料", "VEGETABLE", "  ", "  ");

      expect(fetchSpy).toHaveBeenCalledWith("/api/raw-materials", expect.objectContaining({ method: "POST" }));
      const item = RawMaterialsDictService.getItems().find((i) => i.name === "新原料")!;
      expect(item).toBeDefined();
      expect(item.unit).toBe("斤");
    });

    it("stores the conversion unit/ratio returned by the backend", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
        okResponse({ name: "香梨", category: "FRUIT", unit: "箱", remark: "10kg/箱", conversionUnit: "斤", conversionRatio: 20 })
      ));

      await RawMaterialsDictService.addMaterial("香梨", "FRUIT", "箱", "10kg/箱", "斤", 20);
      const item = RawMaterialsDictService.getItems().find((i) => i.name === "香梨")!;
      expect(item.conversionUnit).toBe("斤");
      expect(item.conversionRatio).toBe(20);
    });

    it("rejects with the backend's validation error and does not add anything", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("原料名称不能为空")));
      await expect(RawMaterialsDictService.addMaterial("  ", "VEGETABLE", "斤")).rejects.toThrow("原料名称不能为空");
      expect(RawMaterialsDictService.getItems()).toHaveLength(0);
    });

    it("rejects with the backend's duplicate-name error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse('名为 "土豆" 的原料在字典中已存在')));
      await expect(RawMaterialsDictService.addMaterial("土豆", "VEGETABLE", "斤")).rejects.toThrow(/已存在/);
    });

    it("does not trigger an immediate refresh (addMaterial has no cross-service cascade)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ name: "新原料", category: "VEGETABLE", unit: "斤" })));
      await RawMaterialsDictService.addMaterial("新原料", "VEGETABLE", "斤");
      expect(SyncHelper.refreshNow).not.toHaveBeenCalled();
    });
  });

  describe("updateMaterial [阶段A：校验/isDefault保留/级联已迁移到后端]", () => {
    beforeEach(() => {
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "土豆", category: "VEGETABLE", unit: "斤", remark: "散装", isDefault: true },
        { name: "柿子", category: "VEGETABLE", unit: "斤" }
      ]);
    });

    it("renames the item using the backend's response and immediately refreshes (级联现在完全由后端完成)", async () => {
      const updated = { name: "马铃薯", category: "VEGETABLE", unit: "公斤", remark: "精品装", isDefault: true };
      const fetchSpy = vi.fn().mockResolvedValue(okResponse(updated));
      vi.stubGlobal("fetch", fetchSpy);

      await RawMaterialsDictService.updateMaterial("土豆", "马铃薯", "VEGETABLE", "公斤", "精品装");

      expect(fetchSpy).toHaveBeenCalledWith(`/api/raw-materials/${encodeURIComponent("土豆")}`, expect.objectContaining({ method: "PUT" }));
      const item = RawMaterialsDictService.getItems().find((i) => i.name === "马铃薯")!;
      expect(item).toEqual(updated);
      // 级联更新台账/备餐报表已由后端一次事务完成，前端不再自行调用 cascade 方法，
      // 而是立即刷新一次全量状态，避免等最多 10 秒的心跳才看到台账/备餐里的原料名同步变化
      expect(SyncHelper.refreshNow).toHaveBeenCalledTimes(1);
    });

    it("rejects with the backend's empty-name error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("原料名称不能为空")));
      await expect(RawMaterialsDictService.updateMaterial("土豆", "  ", "VEGETABLE", "斤")).rejects.toThrow(
        "原料名称不能为空"
      );
      expect(SyncHelper.refreshNow).not.toHaveBeenCalled();
    });

    it("rejects with the backend's not-found error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("未找到原原料记录")));
      await expect(RawMaterialsDictService.updateMaterial("不存在", "新名字", "VEGETABLE", "斤")).rejects.toThrow(
        "未找到原原料记录"
      );
    });

    it("rejects with the backend's duplicate-name error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse('名为 "柿子" 的原料已存在')));
      await expect(RawMaterialsDictService.updateMaterial("土豆", "柿子", "VEGETABLE", "斤")).rejects.toThrow(/已存在/);
    });

    it("propagates a network/backend failure as a rejection", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      await expect(RawMaterialsDictService.updateMaterial("土豆", "马铃薯", "VEGETABLE", "斤")).rejects.toThrow("network down");
    });
  });

  describe("deleteMaterial [阶段A：isDefault保护/级联已迁移到后端]", () => {
    it("refuses to delete a default material using the backend's error message", async () => {
      RawMaterialsDictService.setRawMaterialsDictInMemory([{ name: "土豆", category: "VEGETABLE", unit: "斤", isDefault: true }]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("「土豆」是系统默认原料，不允许删除，如需调整可编辑其属性")));

      await expect(RawMaterialsDictService.deleteMaterial("土豆")).rejects.toThrow(/系统默认原料，不允许删除/);
      expect(RawMaterialsDictService.getItems()).toHaveLength(1);
      expect(SyncHelper.refreshNow).not.toHaveBeenCalled();
    });

    it("deletes a non-default material and immediately refreshes (级联现在完全由后端完成)", async () => {
      // 额外保留一项默认原料，避免删除后字典变为完全空数组——getItems() 在数组长度为 0 时会自动
      // 触发种子数据重新生成，那样就没法验证"删除后真的不在了"，而不是被种子生成掩盖
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "自定义原料", category: "VEGETABLE", unit: "斤" },
        { name: "土豆", category: "VEGETABLE", unit: "斤", isDefault: true }
      ]);
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchSpy);

      await RawMaterialsDictService.deleteMaterial("自定义原料");

      expect(fetchSpy).toHaveBeenCalledWith(`/api/raw-materials/${encodeURIComponent("自定义原料")}`, expect.objectContaining({ method: "DELETE" }));
      expect(RawMaterialsDictService.getItems().map((i) => i.name)).toEqual(["土豆"]);
      // 级联删除台账/备餐报表里的同名条目已由后端一次事务完成，前端不再自行调用 cascade 方法，
      // 而是立即刷新一次全量状态，避免等最多 10 秒的心跳才看到台账/备餐里的原料同步消失
      expect(SyncHelper.refreshNow).toHaveBeenCalledTimes(1);
    });
  });

  describe("setRawMaterialsDictInMemory (heartbeat silent update)", () => {
    it("dedupes on silent overwrite without touching the server", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "土豆", category: "VEGETABLE", unit: "斤", remark: "旧" },
        { name: "土豆", category: "VEGETABLE", unit: "斤", remark: "新" }
      ]);

      expect(RawMaterialsDictService.getItems()).toHaveLength(1);
      expect(RawMaterialsDictService.getItems()[0].remark).toBe("新");
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });
  });
});
