/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description MonthlySpendingChart（当月采购花销趋势折线图）组件测试：本月累计金额展示、无任何花销时的空态提示、
 * 按数据点数量渲染折线图坐标点、每个数据点的悬浮提示文案。
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlySpendingChart } from "./MonthlySpendingChart.tsx";
import { THEME_MAP } from "../../hooks/useTableTheme.ts";

const days = ["1", "2", "3"];

describe("MonthlySpendingChart", () => {
  it("shows the empty-state message when every day's total is zero", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 0, "2": 0, "3": 0 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    expect(screen.getByText("本月该品类暂无任何采购花销记录")).toBeInTheDocument();
    expect(document.querySelector("svg")).not.toBeInTheDocument();
  });

  it("renders the group/category label and the summed monthly total", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    expect(screen.getByText("「幼儿备餐」蔬菜类 - 本月每日采购花销趋势")).toBeInTheDocument();
    expect(screen.getByText("本月累计: ¥338")).toBeInTheDocument();
  });

  it("renders one data point circle per day with a per-day tooltip", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    const circles = document.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
    expect(screen.getByText("1号: ¥110.00")).toBeInTheDocument();
    expect(screen.getByText("3号: ¥228.00")).toBeInTheDocument();
  });

  it("labels the first and last day on the x-axis", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    expect(screen.getByText("1号")).toBeInTheDocument();
    expect(screen.getByText("3号")).toBeInTheDocument();
  });
});
