/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerPrintStyle2Consumable（单原料日流水·消耗品专用打印模板）组件测试：所选原料在时间段内完全没有出入库活动时不崩溃、正确渲染 15 行空白表的回归测试，
 * 以及有真实流水数据时的逐日渲染、库存结算、字典规格/单位回退逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LedgerPrintStyle2Consumable } from "./LedgerPrintStyle2Consumable.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FoodCategory } from "../../types/types.ts";
import type { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";

const ledger: Ledger = { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" };

const makeItem = (dailyRecords: LedgerItem["dailyRecords"] = {}, initialStock = 0): LedgerItem => ({
  id: "item_1",
  ledgerId: "KID",
  name: "大黑袋",
  unit: "捆",
  spec: "常规",
  initialStock,
  currentStock: initialStock,
  dailyRecords
});

describe("LedgerPrintStyle2Consumable", () => {
  beforeEach(() => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "大黑袋", category: FoodCategory.LOW_CONSUMP, unit: "捆", remark: "" }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REGRESSION: does not crash and renders a 15-row blank table when the item has no activity in the date range", () => {
    expect(() =>
      render(
        <LedgerPrintStyle2Consumable
          activeLedger={ledger}
          activeItem={makeItem({})}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]}
        />
      )
    ).not.toThrow();

    // 主表格应渲染 15 空行 + 1 表头行
    expect(screen.getAllByRole("row")).toHaveLength(1 + 1 + 15);
  });

  it("renders one row per day with in/out activity and computes the running stock balance", () => {
    const item = makeItem(
      {
        "2026-07-03": { inQuantity: 21, inPrice: 5, inAmount: 105, outQuantity: 1, supplier: "合作基地直供" }
      },
      0
    );

    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={item}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]}
      />
    );

    expect(screen.getByText("大黑袋")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("合作基地直供")).toBeInTheDocument();
    // 0 (初始库存) + 21 - 1 = 20
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("skips days with all-zero quantities even if a record object exists", () => {
    const item = makeItem({
      "2026-07-01": { inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0 },
      "2026-07-02": { inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 }
    });

    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={item}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-02"
        style2DatesArray={["2026-07-01", "2026-07-02"]}
      />
    );

    // 只有 07-02 有活动，应只渲染一条数据行（其余补齐为空行）
    const rows = screen.getAllByRole("row");
    // 标题表格自身 1 行 + 主表格表头 1 行 + 1 数据行 + 14 空行 = 17
    expect(rows).toHaveLength(1 + 1 + 1 + 14);
  });

  it("includes prior-period in/out totals (before style2StartDate) when computing the starting balance", () => {
    const item = makeItem(
      {
        "2026-06-15": { inQuantity: 10, inPrice: 1, inAmount: 10, outQuantity: 0 },
        "2026-07-01": { inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 }
      },
      0
    );

    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={item}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-01"
        style2DatesArray={["2026-07-01"]}
      />
    );

    // 期初结余应包含 06-15 那笔早于起始日期的入库（10），加上当天入库 5，共 15
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("falls back to the dictionary's remark/unit when available, otherwise the item's own spec/unit", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "大黑袋", category: FoodCategory.LOW_CONSUMP, unit: "个", remark: "加厚型" }
    ]);
    const item = makeItem({ "2026-07-01": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } });

    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={item}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-01"
        style2DatesArray={["2026-07-01"]}
      />
    );

    expect(screen.getByText("加厚型")).toBeInTheDocument();
    expect(screen.getByText("个")).toBeInTheDocument();
  });

  it("shows the ledger name and the date range in the title/subtitle", () => {
    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={makeItem({})}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={[]}
      />
    );

    expect(screen.getByText(/幼儿备餐/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-05/)).toBeInTheDocument();
  });

  it("[V5.64.0] applies the scoped black-border className to the main table for consistent Excel-style gridlines", () => {
    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={makeItem({})}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );

    const table = screen.getByText("序号").closest("table");
    expect(table?.className).toContain("ledger-print-consumable-table");
  });

  it("[V5.64.0] renders the title/header/data text at their configured font sizes", () => {
    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={makeItem({})}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );

    const titleSpan = screen.getByText(/消耗品出入库台账/);
    expect(titleSpan).toHaveStyle({ fontSize: "20px" });

    const dateLine = screen.getByText(/日期：/).closest("div");
    expect(dateLine).toHaveStyle({ fontSize: "14px" });

    const headerCell = screen.getByText("序号", { selector: "th" }).closest("tr");
    expect(headerCell).toHaveStyle({ fontSize: "16px" });
  });
});
