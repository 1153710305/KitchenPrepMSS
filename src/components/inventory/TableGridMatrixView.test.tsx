/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description TableGridMatrixView（EXCEL 日历总矩阵视图）组件测试：渲染每日数量/单价/金额单元格、全月累加列、
 * 表底每日合计行、只读模式下隐藏删除按钮、点击删除按钮触发回调。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableGridMatrixView } from "./TableGridMatrixView.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { PrepReportService } from "../../services/store.ts";
import { FoodCategory, TargetGroup } from "../../types/types.ts";
import { THEME_MAP } from "../../hooks/useTableTheme.ts";
import type { PreparedItem } from "../../types/types.ts";

const days = ["1", "2"];

const makeItem = (): PreparedItem => ({
  id: "item_1",
  name: "土豆",
  category: FoodCategory.VEGETABLE,
  targetGroup: TargetGroup.KID,
  unit: "斤",
  dailyData: {
    "1": { quantity: 3, price: 2, amount: 6 },
    "2": { quantity: 0, price: 0, amount: 0 }
  }
});

describe("TableGridMatrixView", () => {
  beforeEach(() => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }
    ]);
    vi.spyOn(PrepReportService, "getActiveCategories").mockReturnValue([
      { key: "VEGETABLE", label: "蔬菜", isDefault: true }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the day-1 quantity/price/amount cells and the monthly-accumulated columns", () => {
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={vi.fn()}
      />
    );

    expect(screen.getByText("土豆")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("¥2")).toBeInTheDocument();
    // ¥6 同时出现在当日金额格、全月累计格与表底合计行，只需确认它有渲染
    expect(screen.getAllByText("¥6").length).toBeGreaterThan(0);
    // 全月累加：3斤
    expect(screen.getByText("3 斤")).toBeInTheDocument();
  });

  it("renders the bottom daily-total row using dayTotals", () => {
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={vi.fn()}
      />
    );

    expect(screen.getByText("【蔬菜】每日开支合计")).toBeInTheDocument();
  });

  it("hides the per-row delete button when readOnly is true", () => {
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly
        onDeleteItem={vi.fn()}
      />
    );

    expect(screen.queryByTitle("删除此原料行")).not.toBeInTheDocument();
  });

  it("calls onDeleteItem with the item id when the delete button is clicked", async () => {
    const user = userEvent.setup();
    const onDeleteItem = vi.fn();
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={onDeleteItem}
      />
    );

    await user.click(screen.getByTitle("删除此原料行"));

    expect(onDeleteItem).toHaveBeenCalledWith("item_1");
  });

  it("[V5.67.0] allows the user to manually widen the table via a horizontal resize handle", () => {
    const { container } = render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={vi.fn()}
      />
    );

    const resizableWrapper = container.querySelector(".resize-x");
    expect(resizableWrapper).toBeInTheDocument();
    expect(resizableWrapper).toHaveStyle({ minWidth: "100%" });
  });

  it("[V5.67.0] uses a single consistent border color throughout the table (no undefined slate-350 utility class)", () => {
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={vi.fn()}
      />
    );

    const anyBorderedCell = screen.getAllByRole("cell")[0];
    expect(anyBorderedCell.className).not.toContain("slate-350");
    expect(anyBorderedCell.className).not.toContain("border-gray-100");
  });

  it("[V5.72.0] uses pure-black, 2px-thick Excel-style borders instead of the pale 1px slate-400 grid", () => {
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={vi.fn()}
      />
    );

    const anyBorderedCell = screen.getAllByRole("cell")[0];
    expect(anyBorderedCell.className).not.toContain("slate-400");
    expect(anyBorderedCell.className).toContain("border-black");
    expect(anyBorderedCell.className).toMatch(/border-[btrl]-2/);
  });

  it("[V5.72.0] displays the 数量/单价/金额 sub-header labels on a single line instead of wrapping vertically", () => {
    render(
      <TableGridMatrixView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        selectedCategory={FoodCategory.VEGETABLE}
        readOnly={false}
        onDeleteItem={vi.fn()}
      />
    );

    expect(screen.getAllByText("数量")[0].className).toContain("whitespace-nowrap");
    expect(screen.getAllByText("单价")[0].className).toContain("whitespace-nowrap");
    expect(screen.getAllByText("金额")[0].className).toContain("whitespace-nowrap");
  });
});
