/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerStyle1Table（台账总表样式一）组件测试：空态提示文案切换（暂无原料 vs 筛选无结果 vs 当日无记录）、
 * 非录入模式下禁用态输入框正确显示已保存值、录入模式下草稿单元格变更回调、筛选交互、删除原料按钮。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerStyle1Table } from "./LedgerStyle1Table.tsx";
import { LedgerService } from "../../services/ledgerStore.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FoodCategory } from "../../types/types.ts";
import type { LedgerItem } from "../../types/ledgerTypes.ts";

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

const noop = () => {};

const baseProps = {
  selectedDate: "2026-07-03",
  isRecordingMode: false,
  draftRecords: {},
  editingMaterialId: null,
  editMaterialName: "",
  editMaterialSpec: "",
  editMaterialUnit: "斤",
  editMaterialStock: 0,
  dictOptions: [],
  availableCategories: [],
  availableBuyers: [],
  availableInspectors: [],
  availableKeepers: [],
  filterName: "",
  filterCategory: "",
  filterBuyer: "",
  filterInspector: "",
  filterKeeper: "",
  hasActiveFilters: false,
  setFilterName: noop,
  setFilterCategory: noop,
  setFilterBuyer: noop,
  setFilterInspector: noop,
  setFilterKeeper: noop,
  handleSaveEditMaterial: noop,
  handleDeleteMaterial: noop,
  handleDraftCellChange: noop,
  setEditingMaterialId: noop,
  setEditMaterialName: noop,
  setEditMaterialSpec: noop,
  setEditMaterialUnit: noop,
  setEditMaterialStock: noop
};

describe("LedgerStyle1Table", () => {
  beforeEach(() => {
    vi.spyOn(LedgerService, "getHelperDict").mockReturnValue({
      suppliers: ["合作基地直供"],
      buyers: ["张采购"],
      inspectors: ["王检验"],
      keepers: ["李保管"],
      outHandlers: ["吴发料"],
      outRecipients: ["孙领料"]
    });
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("empty states", () => {
    it("shows the '暂无采购原料' message when the ledger has zero items at all", () => {
      render(<LedgerStyle1Table {...baseProps} currentLedgerItems={[]} filteredLedgerItems={[]} />);
      expect(screen.getByText(/该台账暂无采购原料/)).toBeInTheDocument();
      expect(screen.getByText(/开启今日录入/)).toBeInTheDocument();
    });

    it("shows the filter-mismatch message when items exist but the filter matches none", () => {
      const items = [makeItem("item_1", "土豆")];
      render(
        <LedgerStyle1Table {...baseProps} currentLedgerItems={items} filteredLedgerItems={[]} hasActiveFilters />
      );
      expect(screen.getByText(/未找到符合筛选条件的原料/)).toBeInTheDocument();
    });

    it("shows the no-record-on-this-date message when items exist but none match the selected date (no active filters)", () => {
      const items = [makeItem("item_1", "土豆")];
      render(<LedgerStyle1Table {...baseProps} currentLedgerItems={items} filteredLedgerItems={[]} />);
      expect(screen.getByText(/当前所选同步日期暂无任何原料的出入库记录/)).toBeInTheDocument();
    });
  });

  describe("non-recording (disabled) mode", () => {
    it("shows the saved supplier/buyer values in disabled inputs", () => {
      const item = makeItem("item_1", "土豆", {
        "2026-07-03": {
          inQuantity: 3,
          inPrice: 2,
          inAmount: 6,
          outQuantity: 0,
          supplier: "合作基地直供",
          buyer: "张采购"
        }
      });

      render(<LedgerStyle1Table {...baseProps} currentLedgerItems={[item]} filteredLedgerItems={[item]} />);

      expect(screen.getByDisplayValue("合作基地直供")).toBeDisabled();
      expect(screen.getByDisplayValue("张采购")).toBeDisabled();
      expect(screen.getByDisplayValue("3")).toBeDisabled();
    });

    it("shows the delete button on hover-capable rows outside recording mode", () => {
      const item = makeItem("item_1", "土豆");
      render(<LedgerStyle1Table {...baseProps} currentLedgerItems={[item]} filteredLedgerItems={[item]} />);
      expect(screen.getByTitle("删除此台账原料采购项")).toBeInTheDocument();
    });

    it("calls handleDeleteMaterial with the item id when the delete button is clicked", async () => {
      const user = userEvent.setup();
      const handleDeleteMaterial = vi.fn();
      const item = makeItem("item_1", "土豆");
      render(
        <LedgerStyle1Table
          {...baseProps}
          currentLedgerItems={[item]}
          filteredLedgerItems={[item]}
          handleDeleteMaterial={handleDeleteMaterial}
        />
      );

      await user.click(screen.getByTitle("删除此台账原料采购项"));

      expect(handleDeleteMaterial).toHaveBeenCalledWith("item_1");
    });
  });

  describe("recording mode", () => {
    it("renders editable (non-disabled) fields sourced from draftRecords rather than the saved record", () => {
      const item = makeItem("item_1", "土豆", {
        "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 }
      });
      const draftRecords = { item_1: { inQuantity: 9, inPrice: 1, inAmount: 9, outQuantity: 0 } };

      render(
        <LedgerStyle1Table
          {...baseProps}
          currentLedgerItems={[item]}
          filteredLedgerItems={[item]}
          isRecordingMode
          draftRecords={draftRecords}
        />
      );

      // 录入模式下应展示草稿值(9)而不是已保存值(3)
      expect(screen.getByDisplayValue("9")).not.toBeDisabled();
      expect(screen.queryByDisplayValue("3")).not.toBeInTheDocument();
    });

    it("does not show the per-row delete button while recording", () => {
      const item = makeItem("item_1", "土豆");
      render(
        <LedgerStyle1Table {...baseProps} currentLedgerItems={[item]} filteredLedgerItems={[item]} isRecordingMode />
      );
      expect(screen.queryByTitle("删除此台账原料采购项")).not.toBeInTheDocument();
    });

    it("calls handleDraftCellChange with the new quantity when the in-quantity input changes", async () => {
      const user = userEvent.setup();
      const handleDraftCellChange = vi.fn();
      const item = makeItem("item_1", "土豆");

      render(
        <LedgerStyle1Table
          {...baseProps}
          currentLedgerItems={[item]}
          filteredLedgerItems={[item]}
          isRecordingMode
          handleDraftCellChange={handleDraftCellChange}
        />
      );

      // 采购数量与出库数量两个输入框共用占位符"0"，采购数量在前
      const qtyInput = screen.getAllByPlaceholderText("0")[0];
      await user.type(qtyInput, "5");

      expect(handleDraftCellChange).toHaveBeenLastCalledWith("item_1", { inQuantity: 5 });
    });
  });

  describe("filters", () => {
    it("shows the matched/total count", () => {
      const items = [makeItem("item_1", "土豆", { "2026-07-03": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } })];
      render(<LedgerStyle1Table {...baseProps} currentLedgerItems={items} filteredLedgerItems={items} />);
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("calls setFilterName as the user types into the search box", async () => {
      const user = userEvent.setup();
      const setFilterName = vi.fn();
      render(
        <LedgerStyle1Table {...baseProps} currentLedgerItems={[]} filteredLedgerItems={[]} setFilterName={setFilterName} />
      );

      await user.type(screen.getByPlaceholderText("搜索原料名称..."), "土");

      expect(setFilterName).toHaveBeenCalled();
    });

    it("shows a '清空筛选' button only when a filter is active", () => {
      const { rerender } = render(
        <LedgerStyle1Table {...baseProps} currentLedgerItems={[]} filteredLedgerItems={[]} hasActiveFilters={false} />
      );
      expect(screen.queryByText("清空筛选")).not.toBeInTheDocument();

      rerender(<LedgerStyle1Table {...baseProps} currentLedgerItems={[]} filteredLedgerItems={[]} hasActiveFilters />);
      expect(screen.getByText("清空筛选")).toBeInTheDocument();
    });
  });

  describe("inline material edit form", () => {
    it("renders the edit form for the item matching editingMaterialId instead of its normal row", () => {
      const item = makeItem("item_1", "土豆");
      render(
        <LedgerStyle1Table
          {...baseProps}
          currentLedgerItems={[item]}
          filteredLedgerItems={[item]}
          editingMaterialId="item_1"
          editMaterialSpec="精品装"
        />
      );

      expect(screen.getByText("保存原料参数")).toBeInTheDocument();
      expect(screen.getByDisplayValue("精品装")).toBeInTheDocument();
    });
  });
});
