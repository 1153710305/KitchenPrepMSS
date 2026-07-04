/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description MonthlySpendingChart（当月采购花销趋势折线图）组件测试：本月累计金额展示、无任何花销时的空态提示、
 * 按数据点数量渲染折线图坐标点、每个数据点的悬浮提示文案、[V5.71.0] 鼠标悬浮某一天数据点时弹出的自定义提示框。
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    // 空态下不应渲染折线图本体（图标本身的小 svg 除外）
    expect(document.querySelector("polyline")).not.toBeInTheDocument();
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
    expect(screen.getByText("横向日期：1号 至 3号 (月末)")).toBeInTheDocument();
  });

  it("[V5.70.0] uses titleOverride verbatim instead of the auto-generated group/category title when provided", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel=""
        activeTheme={THEME_MAP.emerald}
        titleOverride="全月备餐开支日耗曲线"
      />
    );

    expect(screen.getByText("全月备餐开支日耗曲线")).toBeInTheDocument();
    expect(screen.queryByText(/「幼儿备餐」/)).not.toBeInTheDocument();
  });

  it("renders a visible dot plus a larger hover hit-target per day, each carrying the day's native tooltip text", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    // 每个数据点渲染 2 个 <circle>：可见小圆点 + 悬浮命中用的透明大圆点
    const circles = document.querySelectorAll("circle");
    expect(circles).toHaveLength(days.length * 2);
    expect(screen.getByText("1号: ¥110.00")).toBeInTheDocument();
    expect(screen.getByText("3号: ¥228.00")).toBeInTheDocument();
  });

  it("[V5.71.0] shows no custom tooltip box until a data point is hovered", () => {
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    expect(document.querySelector("rect")).not.toBeInTheDocument();
  });

  it("[V5.71.0] shows a custom tooltip box with the exact day/amount when hovering a data point, and hides it on mouse-leave", async () => {
    const user = userEvent.setup();
    render(
      <MonthlySpendingChart
        days={days}
        dayTotals={{ "1": 110, "2": 0, "3": 228 }}
        groupLabel="幼儿备餐"
        categoryLabel="蔬菜"
        activeTheme={THEME_MAP.emerald}
      />
    );

    const hitTargets = document.querySelectorAll("circle[r='10']");
    expect(hitTargets).toHaveLength(days.length);

    await user.hover(hitTargets[2]);

    const tooltipRect = document.querySelector("rect");
    expect(tooltipRect).toBeInTheDocument();
    // "3号"同时出现在 X 轴刻度与提示框里，限定在提示框所在的 <g> 内断言避免多重匹配
    const tooltipGroup = tooltipRect!.parentElement!;
    expect(tooltipGroup.textContent).toBe("3号¥228.00");

    await user.unhover(hitTargets[2]);

    expect(document.querySelector("rect")).not.toBeInTheDocument();
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
