/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerPrintDoc（台账出入库凭证单打印模板）组件测试：出库单（PrintOutDoc）品名居中显示、
 * 底部供货商说明只展示二级品类而非具体原料名称、行数保持不变、以及采购数量换算单位展示的既有行为不受影响。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LedgerPrintDoc } from "./LedgerPrintDoc.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FoodCategory } from "../../types/types.ts";
import type { Ledger } from "../../types/ledgerTypes.ts";

const ledger: Ledger = { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" };

const makeOutwardItem = (name: string, record: Record<string, any> = {}) => ({
  id: `item_${name}`,
  name,
  spec: "散装",
  unit: "斤",
  record: { outQuantity: 1, outHandler: "", outRecipient: "", supplier: "", ...record }
});

describe("LedgerPrintDoc > PrintOutDoc (出库单)", () => {
  beforeEach(() => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" },
      { name: "大黑袋", category: FoodCategory.LOW_CONSUMP, unit: "捆", remark: "" }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("centers the 品名 (item name) column content", () => {
    const item = makeOutwardItem("土豆", { supplier: "合作基地直供" });

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={[item]}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    const nameCell = screen.getByText("土豆（斤）");
    expect(nameCell.className).toContain("text-center");
  });

  it("[V5.62.0] shows the supplier's food category label at the bottom instead of the specific material name", () => {
    const potato = makeOutwardItem("土豆", { supplier: "合作基地直供" });
    const bag = makeOutwardItem("大黑袋", { supplier: "合作基地直供" });

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={[potato, bag]}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    // 括号内应展示二级品类"蔬菜、低耗品"，而不是具体原料名"土豆、大黑袋"
    expect(screen.getByText("供货商：合作基地直供（蔬菜、低耗品）")).toBeInTheDocument();
    expect(screen.queryByText(/土豆、大黑袋/)).not.toBeInTheDocument();
  });

  it("keeps the total row count at minPrintRows (25) regardless of how many real items are present", () => {
    const item = makeOutwardItem("土豆", { supplier: "合作基地直供" });

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={[item]}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    const table = screen.getByText("类别").closest("table")!;
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(25);
  });

  it("shows the converted quantity and conversion unit when the dictionary defines a conversion ratio", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "香梨", category: FoodCategory.FRUIT, unit: "箱", conversionUnit: "斤", conversionRatio: 20 }
    ]);
    const pear = makeOutwardItem("香梨", { outQuantity: 2, supplier: "合作基地直供" });

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={[pear]}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("香梨（斤）")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });
});
