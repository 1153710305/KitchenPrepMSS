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
import { LEDGER_PRINT_OUT_CONFIG } from "../../constants/ledgerConstants.ts";
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

describe("LedgerPrintDoc > PrintOutDoc (出库单) [V5.73.0] 超出单页容量时的分页打印", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not show a page indicator when everything fits on a single page (existing single-page behavior unaffected)", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }
    ]);
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

    expect(document.querySelectorAll(".ledger-print-out-table")).toHaveLength(1);
    expect(screen.queryByText(/第 \d+ \/ \d+ 页/)).not.toBeInTheDocument();
  });

  it("splits onto a second page when a category's items would exceed the 25-row page limit, without splitting the category itself", () => {
    // 蔬菜品类 20 种 + 肉类品类 10 种 = 30 行，超过单页 25 行上限：
    // 第1页放得下整组蔬菜(20行)，但肉类(10行)放不进剩余5格，因此肉类整组移到第2页，不允许被拆分
    const vegNames = Array.from({ length: 20 }, (_, i) => `蔬菜${i + 1}`);
    const meatNames = Array.from({ length: 10 }, (_, i) => `肉类${i + 1}`);
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      ...vegNames.map((name) => ({ name, category: FoodCategory.VEGETABLE, unit: "斤", remark: "" })),
      ...meatNames.map((name) => ({ name, category: FoodCategory.MEAT, unit: "斤", remark: "" }))
    ]);
    const items = [...vegNames, ...meatNames].map((name) => makeOutwardItem(name, { supplier: "合作基地直供" }));

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={items}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    const tables = document.querySelectorAll(".ledger-print-out-table");
    expect(tables).toHaveLength(2);
    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(25);
    expect(tables[1].querySelectorAll("tbody tr")).toHaveLength(25);

    // 肉类品类整组只应出现在第2页，第1页不应出现被拆散的肉类行
    expect(tables[0].textContent).not.toContain("肉类1");
    expect(tables[1].textContent).toContain("肉类1");
    expect(tables[1].textContent).toContain("肉类10");

    expect(screen.getByText("第 1 / 2 页")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
  });

  it("adds dedicated supplier continuation page(s) when distinct suppliers exceed maxSuppliersPerPage", () => {
    // 供货商数量刻意比 maxSuppliersPerPage 多 3 条，确保无论该配置项当前取值多少，都必然触发至少一次续页
    const maxPerPage = LEDGER_PRINT_OUT_CONFIG.maxSuppliersPerPage;
    const supplierCount = maxPerPage + 3;
    const names = Array.from({ length: supplierCount }, (_, i) => `原料${i + 1}`);
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue(
      names.map((name) => ({ name, category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }))
    );
    const items = names.map((name, i) => makeOutwardItem(name, { supplier: `供货商${i + 1}` }));

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={items}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    // 行数据远小于25，只应产生 1 张行数据表；供货商信息按 maxSuppliersPerPage 分页后应产生的续页数
    const expectedTotalPages = Math.ceil(supplierCount / maxPerPage);
    expect(document.querySelectorAll(".ledger-print-out-table")).toHaveLength(1);
    expect(screen.getByText(`第 1 / ${expectedTotalPages} 页`)).toBeInTheDocument();
    expect(screen.getByText(`第 ${expectedTotalPages} / ${expectedTotalPages} 页`)).toBeInTheDocument();
    // 供货商续页可能不止一页（取决于 maxSuppliersPerPage 与供货商总数的差值），只需确认至少出现一次续页标注
    expect(screen.getAllByText(/供货商续页/).length).toBeGreaterThan(0);

    expect(screen.getByText(new RegExp(`供货商：供货商1(?!\\d)`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`供货商：供货商${supplierCount}`))).toBeInTheDocument();
  });
});
