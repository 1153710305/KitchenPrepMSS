/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description RawMaterialsDictService（原料大字典业务数据服务层）单元测试：增删改、isDefault 默认数据保护、历史数据去重与迁移、级联联动台账与备餐报表。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RawMaterialsDictService, RawMaterialDictItem } from "./rawMaterialDict.ts";
import { SyncHelper } from "./syncHelper.ts";
import { LedgerService } from "./ledgerStore.ts";
import { PrepReportService } from "./store.ts";
import { FoodCategory } from "../types/types.ts";

function resetDict() {
  RawMaterialsDictService.setRawMaterialsDictInMemory([]);
}

describe("RawMaterialsDictService", () => {
  beforeEach(() => {
    resetDict();
    vi.spyOn(SyncHelper, "queueChange").mockImplementation(() => {});
    vi.spyOn(SyncHelper, "runWhenInitialized").mockImplementation((fn) => fn());
    vi.spyOn(LedgerService, "cascadeUpdateMaterial").mockImplementation(() => {});
    vi.spyOn(LedgerService, "cascadeDeleteMaterial").mockImplementation(() => {});
    vi.spyOn(PrepReportService, "cascadeUpdateMaterial").mockImplementation(() => {});
    vi.spyOn(PrepReportService, "cascadeDeleteMaterial").mockImplementation(() => {});
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
        { name: "自定义原料", category: FoodCategory.VEGETABLE, unit: "斤" }
      ]);
      const items = RawMaterialsDictService.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe("自定义原料");
    });
  });

  describe("initDictFromServer", () => {
    it("adopts the server's dictionary when it has entries", () => {
      const serverItems: RawMaterialDictItem[] = [{ name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", isDefault: true }];
      const result = RawMaterialsDictService.initDictFromServer(serverItems);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("土豆");
    });

    it("deduplicates same-name entries, keeping the last occurrence", () => {
      const serverItems: RawMaterialDictItem[] = [
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "旧" },
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "公斤", remark: "新" }
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
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤" }
      ]);
    });

    it("returns the category for a known material", () => {
      expect(RawMaterialsDictService.getCategoryForMaterial("土豆")).toBe(FoodCategory.VEGETABLE);
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
    it("adds a new item with trimmed/defaulted fields", async () => {
      await RawMaterialsDictService.addMaterial("新原料", FoodCategory.VEGETABLE, "  ", "  ");
      const item = RawMaterialsDictService.getItems().find((i) => i.name === "新原料")!;
      expect(item.unit).toBe("斤");
      expect(item.remark).toBe("");
      expect(item.isDefault).toBeUndefined();
      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "rawMaterial", op: "upsert", key: "新原料" })
      );
    });

    it("stores optional conversion unit/ratio when provided", async () => {
      await RawMaterialsDictService.addMaterial("香梨", FoodCategory.FRUIT, "箱", "10kg/箱", "斤", 20);
      const item = RawMaterialsDictService.getItems().find((i) => i.name === "香梨")!;
      expect(item.conversionUnit).toBe("斤");
      expect(item.conversionRatio).toBe(20);
    });

    it("rejects an empty name", async () => {
      await expect(RawMaterialsDictService.addMaterial("  ", FoodCategory.VEGETABLE, "斤")).rejects.toThrow("原料名称不能为空");
    });

    it("rejects a duplicate name", async () => {
      await RawMaterialsDictService.addMaterial("土豆", FoodCategory.VEGETABLE, "斤");
      await expect(RawMaterialsDictService.addMaterial("土豆", FoodCategory.VEGETABLE, "斤")).rejects.toThrow(/已存在/);
    });
  });

  describe("updateMaterial (default-data protection + cascade)", () => {
    beforeEach(() => {
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装", isDefault: true },
        { name: "柿子", category: FoodCategory.VEGETABLE, unit: "斤" }
      ]);
    });

    it("renames the item and cascades name/unit/spec updates to the ledger and prep report", async () => {
      await RawMaterialsDictService.updateMaterial("土豆", "马铃薯", FoodCategory.VEGETABLE, "公斤", "精品装");

      const item = RawMaterialsDictService.getItems().find((i) => i.name === "马铃薯")!;
      expect(item).toBeDefined();
      expect(item.unit).toBe("公斤");
      expect(item.remark).toBe("精品装");

      expect(LedgerService.cascadeUpdateMaterial).toHaveBeenCalledWith("土豆", "马铃薯", "公斤", "精品装");
      expect(PrepReportService.cascadeUpdateMaterial).toHaveBeenCalledWith("土豆", "马铃薯", FoodCategory.VEGETABLE, "公斤");
      // name 是后端表主键，改名时需要携带 previousKey 供后端清理旧行
      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "rawMaterial", op: "upsert", key: "马铃薯", previousKey: "土豆" })
      );
    });

    it("preserves the isDefault flag across an edit", async () => {
      await RawMaterialsDictService.updateMaterial("土豆", "马铃薯", FoodCategory.VEGETABLE, "斤");
      const item = RawMaterialsDictService.getItems().find((i) => i.name === "马铃薯")!;
      expect(item.isDefault).toBe(true);
    });

    it("rejects an empty new name", async () => {
      await expect(RawMaterialsDictService.updateMaterial("土豆", "  ", FoodCategory.VEGETABLE, "斤")).rejects.toThrow(
        "原料名称不能为空"
      );
    });

    it("rejects when the original material cannot be found", async () => {
      await expect(RawMaterialsDictService.updateMaterial("不存在", "新名字", FoodCategory.VEGETABLE, "斤")).rejects.toThrow(
        "未找到原原料记录"
      );
    });

    it("rejects renaming to a name already used by a different item", async () => {
      await expect(RawMaterialsDictService.updateMaterial("土豆", "柿子", FoodCategory.VEGETABLE, "斤")).rejects.toThrow(/已存在/);
    });

    it("allows keeping the exact same name (no self-collision)", async () => {
      await expect(RawMaterialsDictService.updateMaterial("土豆", "土豆", FoodCategory.VEGETABLE, "斤")).resolves.toBeUndefined();
    });
  });

  describe("deleteMaterial (default-data protection + cascade)", () => {
    it("refuses to delete a default material", async () => {
      RawMaterialsDictService.setRawMaterialsDictInMemory([{ name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", isDefault: true }]);
      await expect(RawMaterialsDictService.deleteMaterial("土豆")).rejects.toThrow(/系统默认原料，不允许删除/);
      expect(RawMaterialsDictService.getItems()).toHaveLength(1);
    });

    it("deletes a non-default material and cascades the deletion to ledger and prep report", async () => {
      // 额外保留一项默认原料，避免删除后字典变为完全空数组——getItems() 在数组长度为 0 时会自动
      // 触发种子数据重新生成，那样就没法验证"删除后真的不在了"，而不是被种子生成掩盖
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "自定义原料", category: FoodCategory.VEGETABLE, unit: "斤" },
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", isDefault: true }
      ]);

      await RawMaterialsDictService.deleteMaterial("自定义原料");

      expect(RawMaterialsDictService.getItems().map((i) => i.name)).toEqual(["土豆"]);
      expect(LedgerService.cascadeDeleteMaterial).toHaveBeenCalledWith("自定义原料");
      expect(PrepReportService.cascadeDeleteMaterial).toHaveBeenCalledWith("自定义原料");
      expect(SyncHelper.queueChange).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "rawMaterial", op: "delete", key: "自定义原料" })
      );
    });
  });

  describe("setRawMaterialsDictInMemory (heartbeat silent update)", () => {
    it("dedupes on silent overwrite without touching the server", () => {
      vi.spyOn(SyncHelper, "queueChange").mockClear();
      RawMaterialsDictService.setRawMaterialsDictInMemory([
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "旧" },
        { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "新" }
      ]);

      expect(RawMaterialsDictService.getItems()).toHaveLength(1);
      expect(RawMaterialsDictService.getItems()[0].remark).toBe("新");
      expect(SyncHelper.queueChange).not.toHaveBeenCalled();
    });
  });
});
