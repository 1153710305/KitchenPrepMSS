/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description TableGrid（备餐采购细表编排层）组件测试：合计汇总视图渲染、按品类/搜索过滤台账原料并对齐为备餐明细行、
 * 视图模式(EXCEL矩阵/单日聚焦)切换、CSV 导出触发、新增原料表单（只读模式下隐藏）、空数据态提示。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableGrid } from "./TableGrid.tsx";
import { LedgerService } from "../../services/ledgerStore.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { PrepReportService } from "../../services/store.ts";
import { FoodCategory, TargetGroup } from "../../types/types.ts";
import type { GroupMonthlyReport, DynamicGroup, DynamicCategory } from "../../types/types.ts";
import type { LedgerItem } from "../../types/ledgerTypes.ts";

const report: GroupMonthlyReport = {
  targetGroup: TargetGroup.KID,
  year: 2026,
  month: 7,
  items: []
};

const activeGroupsList: DynamicGroup[] = [{ key: "KID", label: "幼儿", emoji: "👶", isDefault: true }];
const activeCategoriesList: DynamicCategory[] = [{ key: "VEGETABLE", label: "蔬菜", isDefault: true }];

const makeLedgerItem = (dailyRecords: LedgerItem["dailyRecords"] = {}): LedgerItem => ({
  id: "item_1",
  ledgerId: "KID",
  name: "土豆",
  unit: "斤",
  spec: "散装",
  initialStock: 0,
  currentStock: 0,
  dailyRecords
});

const baseProps = {
  report,
  onCellUpdate: vi.fn(),
  onAddItem: vi.fn(),
  onDeleteItem: vi.fn(),
  isAdminMode: true,
  activeGroupsList,
  activeCategoriesList
};

describe("TableGrid", () => {
  beforeEach(() => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }
    ]);
    vi.spyOn(PrepReportService, "getActiveCategories").mockReturnValue([
      { key: "VEGETABLE", label: "蔬菜", isDefault: true },
      { key: "MEAT", label: "肉类", isDefault: true }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("合计汇总 (selectedCategory === null)", () => {
    it("renders the aggregated category summary instead of the detail table", () => {
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([]);
      render(<TableGrid {...baseProps} selectedCategory={null} />);

      expect(screen.getByText("全品类预算合计汇总")).toBeInTheDocument();
    });

    it("[V5.70.0] shows the restored '全月备餐开支日耗曲线' chart with a total matching the 总预算耗资 badge", () => {
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([]);
      const reportWithData: GroupMonthlyReport = {
        targetGroup: TargetGroup.KID,
        year: 2026,
        month: 7,
        items: [
          {
            id: "item_1",
            name: "土豆",
            category: FoodCategory.VEGETABLE,
            targetGroup: TargetGroup.KID,
            unit: "斤",
            dailyData: {
              "1": { quantity: 5, price: 2, amount: 10 },
              "2": { quantity: 0, price: 0, amount: 0 }
            }
          },
          {
            id: "item_2",
            name: "精肉",
            category: FoodCategory.MEAT,
            targetGroup: TargetGroup.KID,
            unit: "斤",
            dailyData: {
              "1": { quantity: 0, price: 0, amount: 0 },
              "2": { quantity: 2, price: 20, amount: 40 }
            }
          }
        ]
      };

      render(<TableGrid {...baseProps} report={reportWithData} selectedCategory={null} />);

      // 总预算耗资徽章与图表"本月累计"都应是两个品类金额之和 10+40=50，二者数据来源一致
      expect(screen.getByText("总预算耗资: ¥50")).toBeInTheDocument();
      expect(screen.getByText("全月备餐开支日耗曲线")).toBeInTheDocument();
      expect(screen.getByText("本月累计: ¥50")).toBeInTheDocument();
    });
  });

  describe("detail table (selectedCategory set)", () => {
    it("shows the empty-data message when no ledger item matches the selected category", () => {
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([]);
      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      expect(screen.getByText(/该品类暂无细分材料/)).toBeInTheDocument();
    });

    it("aligns the matching ledger item's daily in-quantity/price into the detail row (EXCEL matrix by default)", () => {
      const item = makeLedgerItem({
        "2026-07-01": { inQuantity: 5, inPrice: 3, inAmount: 15, outQuantity: 0 }
      });
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([item]);

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      expect(screen.getByText("土豆")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("excludes ledger items belonging to a different target group", () => {
      const item = { ...makeLedgerItem(), ledgerId: "TEACHER" };
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([item]);

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      expect(screen.getByText(/该品类暂无细分材料/)).toBeInTheDocument();
    });

    it("excludes ledger items whose name is not registered in the raw material dictionary", () => {
      const item = makeLedgerItem();
      vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([item]);

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      expect(screen.getByText(/该品类暂无细分材料/)).toBeInTheDocument();
    });

    it("filters by search query using pinyin matching", async () => {
      const user = userEvent.setup();
      const item = makeLedgerItem();
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([item]);

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);
      expect(screen.getByText("土豆")).toBeInTheDocument();

      await user.type(screen.getByPlaceholderText("快速检索当前页食材..."), "西红柿");

      expect(screen.getByText(/该品类暂无细分材料/)).toBeInTheDocument();
    });

    it("switches to the single-day focus view when its tab is clicked", async () => {
      const user = userEvent.setup();
      const item = makeLedgerItem({
        "2026-07-01": { inQuantity: 5, inPrice: 3, inAmount: 15, outQuantity: 0 }
      });
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([item]);

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      await user.click(screen.getByText("单日聚焦卡片 (推荐)"));

      expect(screen.getByText(/耗粮记账明细/)).toBeInTheDocument();
    });

    it("hides the add-material form when readOnly is true", () => {
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([]);
      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} readOnly />);

      expect(screen.queryByText("添加原料:")).not.toBeInTheDocument();
    });

    it("shows the add-material form when not read-only", () => {
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([]);
      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} readOnly={false} />);

      expect(screen.getByText("添加原料:")).toBeInTheDocument();
    });

    it("triggers a CSV download when the export button is clicked", async () => {
      const user = userEvent.setup();
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([]);
      // 阻断锚点真实跳转（jsdom 不支持 blob: 导航）与 LogBroker 的后台上报请求，只关注下载触发本身
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      // jsdom 未内置实现 createObjectURL/revokeObjectURL，需直接赋值而非 spyOn 一个不存在的属性
      const createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");
      URL.createObjectURL = createObjectURLSpy;
      URL.revokeObjectURL = vi.fn();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      await user.click(screen.getByText("导出本月细表 (CSV)"));

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    it("[V5.69.0] hides the monthly spending chart by default and shows it after clicking the toggle button", async () => {
      const user = userEvent.setup();
      const item = makeLedgerItem({
        "2026-07-01": { inQuantity: 5, inPrice: 3, inAmount: 15, outQuantity: 0 }
      });
      vi.spyOn(LedgerService, "getLedgerItems").mockReturnValue([item]);

      render(<TableGrid {...baseProps} selectedCategory={FoodCategory.VEGETABLE} />);

      expect(screen.queryByText(/本月每日采购花销趋势/)).not.toBeInTheDocument();

      await user.click(screen.getByText("本月花销趋势图"));

      expect(screen.getByText(/本月每日采购花销趋势/)).toBeInTheDocument();
      expect(screen.getByText("隐藏花销趋势图")).toBeInTheDocument();

      await user.click(screen.getByText("隐藏花销趋势图"));

      expect(screen.queryByText(/本月每日采购花销趋势/)).not.toBeInTheDocument();
    });
  });
});
