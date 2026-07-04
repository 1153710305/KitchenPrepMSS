/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description useLedgerRecording（台账"今日录入模式"状态机 Hook）单元测试：开始录入的草稿构建（缓存优先/字典兜底）、草稿单元格变更的金额与换算重算、确认提交时 temp_ 临时原料转正与批量落盘、取消录入保留本地缓存。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLedgerRecording } from "./useLedgerRecording.ts";
import { LedgerService } from "../services/ledgerStore.ts";
import { RawMaterialsDictService } from "../services/rawMaterialDict.ts";
import type { LedgerItem } from "../types/ledgerTypes.ts";

const makeItem = (id: string, name: string, dailyRecords: LedgerItem["dailyRecords"] = {}): LedgerItem => ({
  id,
  ledgerId: "KID",
  name,
  unit: "斤",
  spec: "散装",
  initialStock: 0,
  currentStock: 0,
  dailyRecords
});

describe("useLedgerRecording", () => {
  const onSaveToast = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    onSaveToast.mockClear();
    onError.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: "VEGETABLE" as any, unit: "斤", remark: "散装" },
      { name: "柿子", category: "VEGETABLE" as any, unit: "斤", remark: "散装" }
    ]);
    vi.spyOn(LedgerService, "updateDailyRecord").mockResolvedValue(undefined);
    vi.spyOn(LedgerService, "addLedgerItem").mockResolvedValue(makeItem("new_id", "柿子"));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const setup = (ledgerItems: LedgerItem[] = []) =>
    renderHook(() => useLedgerRecording({
      activeLedgerId: "KID",
      selectedDate: "2026-07-03",
      ledgerItems,
      onSaveToast,
      onError
    }));

  describe("handleStartRecording", () => {
    it("builds an initial draft flattening every dictionary material, using existing daily records where present", () => {
      const existingItem = makeItem("item_1", "土豆", {
        "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0, note: "" }
      });
      const { result } = setup([existingItem]);

      act(() => {
        result.current.handleStartRecording();
      });

      expect(result.current.isRecordingMode).toBe(true);
      expect(result.current.draftRecords["item_1"].inQuantity).toBe(3);
      // 柿子字典里有，但该台账目前没有正式原料项目，应回退为 temp_ 前缀的空白草稿
      expect(result.current.draftRecords["temp_柿子"]).toBeDefined();
      expect(result.current.draftRecords["temp_柿子"].inQuantity).toBe(0);
    });

    it("restores from an unsaved localStorage draft cache instead of rebuilding from ledgerItems", () => {
      const cachedDraft = { item_1: { inQuantity: 99, inPrice: 1, inAmount: 99, outQuantity: 0, note: "缓存的草稿" } };
      localStorage.setItem("ledger_draft_KID_2026-07-03", JSON.stringify(cachedDraft));

      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });

      expect(result.current.draftRecords).toEqual(cachedDraft);
      expect(onSaveToast).toHaveBeenCalledWith("已恢复未提交的本地缓存数据", 2500);
    });
  });

  describe("handleDraftCellChange", () => {
    it("merges the given fields and recalculates inAmount from quantity * price", () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });

      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: 4, inPrice: 2.5 });
      });

      expect(result.current.draftRecords["item_1"].inAmount).toBe(10);
    });

    it("applies the dictionary conversion ratio to compute conversionUnitQuantity", () => {
      vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
        { name: "土豆", category: "VEGETABLE" as any, unit: "斤", conversionUnit: "袋", conversionRatio: 0.5 }
      ]);
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });

      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: 10 });
      });

      expect(result.current.draftRecords["item_1"].conversionUnitQuantity).toBe(5);
    });

    it("resolves the material name for a temp_-prefixed item id directly from the id itself", () => {
      vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
        { name: "柿子", category: "VEGETABLE" as any, unit: "斤", conversionUnit: "箱", conversionRatio: 10 }
      ]);
      const { result } = setup([]);
      act(() => {
        result.current.handleStartRecording();
      });

      act(() => {
        result.current.handleDraftCellChange("temp_柿子", { inQuantity: 2 });
      });

      expect(result.current.draftRecords["temp_柿子"].conversionUnitQuantity).toBe(20);
    });

    it("[V5.67.0] clamps a negative inQuantity/inPrice/outQuantity to zero instead of letting it into the draft", () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });

      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: -5, inPrice: -2, outQuantity: -1 });
      });

      expect(result.current.draftRecords["item_1"].inQuantity).toBe(0);
      expect(result.current.draftRecords["item_1"].inPrice).toBe(0);
      expect(result.current.draftRecords["item_1"].outQuantity).toBe(0);
    });

    it("[V5.67.0] treats a NaN quantity/price (e.g. from a transient '-' or empty input) as zero rather than propagating NaN", () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });

      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: Number("-"), inPrice: Number("abc") });
      });

      expect(result.current.draftRecords["item_1"].inQuantity).toBe(0);
      expect(result.current.draftRecords["item_1"].inPrice).toBe(0);
      // 金额重算也不应残留 NaN
      expect(result.current.draftRecords["item_1"].inAmount).toBe(0);
    });

    it("persists the updated draft to localStorage under the ledger+date scoped key", () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });
      act(() => {
        result.current.handleDraftCellChange("item_1", { supplier: "合作基地直供" });
      });

      const cached = JSON.parse(localStorage.getItem("ledger_draft_KID_2026-07-03")!);
      expect(cached.item_1.supplier).toBe("合作基地直供");
    });
  });

  describe("handleConfirmRecording", () => {
    it("directly persists a formal (non-temp_) item via updateDailyRecord", async () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });
      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: 3, inPrice: 2 });
      });

      await act(async () => {
        await result.current.handleConfirmRecording();
      });

      expect(LedgerService.updateDailyRecord).toHaveBeenCalledWith(
        "item_1",
        "2026-07-03",
        expect.objectContaining({ inQuantity: 3, inPrice: 2 })
      );
      expect(result.current.isRecordingMode).toBe(false);
      expect(result.current.draftRecords).toEqual({});
    });

    it("promotes a temp_ item to a real ledger item only when it has at least one filled field", async () => {
      const { result } = setup([]);
      act(() => {
        result.current.handleStartRecording();
      });
      act(() => {
        result.current.handleDraftCellChange("temp_柿子", { inQuantity: 5 });
      });

      await act(async () => {
        await result.current.handleConfirmRecording();
      });

      expect(LedgerService.addLedgerItem).toHaveBeenCalledWith("KID", "柿子", "斤", "散装", 0);
      expect(LedgerService.updateDailyRecord).toHaveBeenCalledWith(
        "new_id",
        "2026-07-03",
        expect.objectContaining({ inQuantity: 5 })
      );
    });

    it("skips an untouched temp_ item entirely (no addLedgerItem call)", async () => {
      const { result } = setup([]);
      act(() => {
        result.current.handleStartRecording();
      });
      // 不对 temp_ 项目做任何编辑，直接确认

      await act(async () => {
        await result.current.handleConfirmRecording();
      });

      expect(LedgerService.addLedgerItem).not.toHaveBeenCalled();
    });

    it("clears the localStorage draft cache after a successful confirm", async () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });
      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: 1 });
      });

      await act(async () => {
        await result.current.handleConfirmRecording();
      });

      expect(localStorage.getItem("ledger_draft_KID_2026-07-03")).toBeNull();
    });

    it("calls onError and keeps recording mode active when persisting fails", async () => {
      vi.spyOn(LedgerService, "updateDailyRecord").mockRejectedValue(new Error("save failed"));
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });
      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: 1 });
      });

      await act(async () => {
        await result.current.handleConfirmRecording();
      });

      expect(onError).toHaveBeenCalledWith("save failed", 3000);
      expect(result.current.isRecordingMode).toBe(true);
    });
  });

  describe("handleCancelRecording", () => {
    it("exits recording mode and clears the in-memory draft but keeps the localStorage cache", () => {
      const { result } = setup([makeItem("item_1", "土豆")]);
      act(() => {
        result.current.handleStartRecording();
      });
      act(() => {
        result.current.handleDraftCellChange("item_1", { inQuantity: 1 });
      });

      act(() => {
        result.current.handleCancelRecording();
      });

      expect(result.current.isRecordingMode).toBe(false);
      expect(result.current.draftRecords).toEqual({});
      expect(localStorage.getItem("ledger_draft_KID_2026-07-03")).not.toBeNull();
      expect(onSaveToast).toHaveBeenCalledWith("录入草稿已暂存本地", 2000);
    });
  });

  describe("switching ledger or date", () => {
    it("resets recording mode and the in-memory draft when activeLedgerId changes", async () => {
      const { result, rerender } = renderHook(
        (props: { activeLedgerId: string; selectedDate: string }) =>
          useLedgerRecording({ ...props, ledgerItems: [makeItem("item_1", "土豆")], onSaveToast, onError }),
        { initialProps: { activeLedgerId: "KID", selectedDate: "2026-07-03" } }
      );

      act(() => {
        result.current.handleStartRecording();
      });
      expect(result.current.isRecordingMode).toBe(true);

      rerender({ activeLedgerId: "STU", selectedDate: "2026-07-03" });

      await waitFor(() => {
        expect(result.current.isRecordingMode).toBe(false);
      });
      expect(result.current.draftRecords).toEqual({});
    });
  });
});
