/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description TableGridFocusView（单日聚焦卡片视图）组件测试：渲染聚焦日的数量/单价/金额卡片、日期刻度盘切换回调、
 * 有数据日期的高亮标记。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableGridFocusView } from "./TableGridFocusView.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FoodCategory, TargetGroup } from "../../types/types.ts";
import { THEME_MAP } from "../../hooks/useTableTheme.ts";
import type { PreparedItem } from "../../types/types.ts";

const days = ["1", "2"];

const makeItem = (): PreparedItem => ({
  id: "item_1",
  name: "土豆",
  category: "VEGETABLE",
  targetGroup: "KID",
  unit: "斤",
  dailyData: {
    "1": { quantity: 3, price: 2, amount: 6 },
    "2": { quantity: 0, price: 0, amount: 0 }
  }
});

describe("TableGridFocusView", () => {
  beforeEach(() => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: "VEGETABLE", unit: "斤", remark: "" }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the focused day's quantity/price/amount for each item", () => {
    render(
      <TableGridFocusView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        focusDay="1"
        setFocusDay={vi.fn()}
      />
    );

    expect(screen.getByText("土豆")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("¥2")).toBeInTheDocument();
    expect(screen.getByText("¥6.00")).toBeInTheDocument();
  });

  it("renders the day-total footer for the focused day", () => {
    render(
      <TableGridFocusView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        focusDay="1"
        setFocusDay={vi.fn()}
      />
    );

    expect(screen.getByText("¥6.00 元")).toBeInTheDocument();
  });

  it("calls setFocusDay with the clicked day when a date-scale button is clicked", async () => {
    const user = userEvent.setup();
    const setFocusDay = vi.fn();
    render(
      <TableGridFocusView
        days={days}
        filteredItems={[makeItem()]}
        dayTotals={{ "1": 6, "2": 0 }}
        activeTheme={THEME_MAP.emerald}
        focusDay="1"
        setFocusDay={setFocusDay}
      />
    );

    await user.click(screen.getByText("2号"));

    expect(setFocusDay).toHaveBeenCalledWith("2");
  });
});
