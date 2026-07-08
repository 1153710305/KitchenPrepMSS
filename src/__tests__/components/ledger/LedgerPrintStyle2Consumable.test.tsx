/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerPrintStyle2Consumable（单原料日流水·消耗品专用打印模板）组件测试：[V5.65.0] 改用与购销总表（图一）
 * 同款排版风格（物品名称/数量/规格/供货商/采购时间/采购员/检验员/出入库时间/保管员）后的渲染回归、标题/日期/受众副标题的
 * 布局结构、字典规格回退逻辑、线框与字号样式。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LedgerPrintStyle2Consumable } from "@/src/components/ledger/LedgerPrintStyle2Consumable.tsx";
import { RawMaterialsDictService } from "@/src/services/rawMaterialDict.ts";
import { LEDGER_PRINT_CONSUMABLE_CONFIG } from "@/src/constants/ledgerConstants.ts";
import { FoodCategory } from "@/src/types/types.ts";
import type { Ledger, LedgerItem } from "@/src/types/ledgerTypes.ts";

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
      { name: "大黑袋", category: "LOW_CONSUMP", unit: "捆", remark: "" }
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

    // 表头占 2 行（首行 + 出入库时间子表头行）+ 15 空行
    expect(screen.getAllByRole("row")).toHaveLength(2 + 15);
  });

  it("renders one row per day with in/out activity, showing purchase/out dates under 出入库时间", () => {
    const item = makeItem(
      {
        "2026-07-03": {
          inQuantity: 21, inPrice: 5, inAmount: 105, outQuantity: 1,
          supplier: "合作基地直供", buyer: "张采购", inspector: "王检验", keeper: "李保管"
        }
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
    expect(screen.getByText("张采购")).toBeInTheDocument();
    expect(screen.getByText("王检验")).toBeInTheDocument();
    expect(screen.getByText("李保管")).toBeInTheDocument();
    // 采购时间列 + 出入库时间下的入库列都取自同一个日期值，加上出库列，当天共出现 3 次
    expect(screen.getAllByText("2026-07-03")).toHaveLength(3);
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

    // 只有 07-02 有活动，应只渲染一条数据行（其余补齐为空行）：2 行表头 + 1 数据行 + 14 空行
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2 + 1 + 14);
  });

  it("falls back to the dictionary's remark when available, otherwise the item's own spec", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "大黑袋", category: "LOW_CONSUMP", unit: "个", remark: "加厚型" }
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
  });

  it("falls back to the item's own spec when the dictionary has no remark", () => {
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

    expect(screen.getByText("常规")).toBeInTheDocument();
  });

  describe("[V5.65.0] title / date / subtitle header structure (matches LedgerPrintStyle1's layout pattern)", () => {
    it("renders the title without a trailing dash and the ledger name as a separate element", () => {
      render(
        <LedgerPrintStyle2Consumable
          activeLedger={ledger}
          activeItem={makeItem({})}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={[]}
        />
      );

      expect(screen.getByText("宾县第二小学食堂消耗品出入库台账")).toBeInTheDocument();
      expect(screen.getByText("幼儿备餐")).toBeInTheDocument();
      expect(screen.queryByText(/消耗品出入库台账-/)).not.toBeInTheDocument();
    });

    it("shows the date range", () => {
      render(
        <LedgerPrintStyle2Consumable
          activeLedger={ledger}
          activeItem={makeItem({})}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={[]}
        />
      );

      expect(screen.getByText(/2026-07-01/)).toBeInTheDocument();
      expect(screen.getByText(/2026-07-05/)).toBeInTheDocument();
    });

    it("places the date and the ledger-name subtitle as siblings in the same row, right after the date text", () => {
      render(
        <LedgerPrintStyle2Consumable
          activeLedger={ledger}
          activeItem={makeItem({})}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={[]}
        />
      );

      const dateEl = screen.getByText(/日期：/);
      const subtitleEl = screen.getByText("幼儿备餐");
      expect(dateEl.parentElement).toBe(subtitleEl.parentElement);
      const siblings = Array.from(dateEl.parentElement!.children);
      expect(siblings.indexOf(dateEl)).toBeLessThan(siblings.indexOf(subtitleEl));
    });
  });

  it("applies the scoped black-border className to the main table for consistent Excel-style gridlines", () => {
    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={makeItem({})}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );

    const table = screen.getByText("物品名称").closest("table");
    expect(table?.className).toContain("ledger-print-consumable-table");
  });

  it("renders the title/header/data text at their configured font sizes", () => {
    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={makeItem({})}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );

    const titleDiv = screen.getByText("宾县第二小学食堂消耗品出入库台账");
    expect(titleDiv).toHaveStyle({ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.titleFontSize });

    const dateLine = screen.getByText(/日期：/);
    expect(dateLine).toHaveStyle({ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.subtitleFontSize });

    const headerRow = screen.getByText("物品名称", { selector: "th" }).closest("tr");
    expect(headerRow).toHaveStyle({ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.headerFontSize });
  });

  it("[V5.66.0] renders empty placeholder rows at 1.3x the original 28px height", () => {
    render(
      <LedgerPrintStyle2Consumable
        activeLedger={ledger}
        activeItem={makeItem({})}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );

    const emptyRow = screen.getAllByRole("row").at(-1);
    expect(emptyRow).toHaveStyle({ height: LEDGER_PRINT_CONSUMABLE_CONFIG.dataRowHeight });
  });
});
