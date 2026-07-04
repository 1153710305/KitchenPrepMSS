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

describe("LedgerPrintDoc [V5.75.0] renders via a portal directly under document.body", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts the print overlay as a direct child of document.body, escaping the host component's own DOM ancestry", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
    const { container } = render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={[]}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    // Portal 挂载到 document.body 后，RTL 默认渲染容器内不应包含打印预览内容
    expect(container.querySelector(".ledger-print-doc-overlay")).not.toBeInTheDocument();
    // 而是作为 document.body 的直接子元素存在，不再受任何祖先容器（如 #root 的 overflow-hidden 布局树）的裁剪影响
    const overlay = document.body.querySelector(".ledger-print-doc-overlay");
    expect(overlay).toBeInTheDocument();
    expect(overlay!.parentElement).toBe(document.body);
  });

  it("[V5.78.0] clears the overlay's own padding during print so it doesn't double up with the @page margin and starve the row/supplier budget", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-03"
        dailyInwardItems={[]}
        dailyOutwardItems={[]}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    const printStyleTag = Array.from(document.body.querySelectorAll("style")).find((el) =>
      el.textContent?.includes(".ledger-print-doc-overlay")
    );
    expect(printStyleTag).toBeTruthy();
    // @media print 覆盖规则里必须清零内边距，否则会与 PrintOutDoc 自身声明的 @page margin 重复叠加，
    // 蚕食行数预算原本预留的物理页面余量，导致本应一页打完的内容被挤到下一页
    expect(printStyleTag!.textContent).toMatch(/\.ledger-print-doc-overlay\s*\{[^}]*padding:\s*0\s*!important/);
  });
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

  it("keeps the total row count at minPrintRows regardless of how many real items are present", () => {
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
    const suppliersCount = 1; // 测试中仅提供了1个供货商 "合作基地直供"
    const expectedLastPageRows = LEDGER_PRINT_OUT_CONFIG.minPrintRows + LEDGER_PRINT_OUT_CONFIG.maxSuppliersPerPage - suppliersCount;
    expect(bodyRows).toHaveLength(expectedLastPageRows);
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

  it("[V5.78.0] keeps a small number of rows plus more suppliers than maxSuppliersPerPage together on one page by shrinking the blank filler rows", () => {
    // 回归复现用户反馈的真实场景：5 行记录 + 4 个供货商，总量远小于 minPrintRows+maxSuppliersPerPage 的单页组合容量，
    // 不应该仅仅因为供货商数量超过 maxSuppliersPerPage 就把多余的供货商挤到续页
    const names = ["土豆", "柿子", "黄瓜", "胡萝卜", "青椒"];
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue(
      names.map((name) => ({ name, category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }))
    );
    const suppliers = ["合作基地直供", "宏发粮油批发", "绿野蔬菜配送", "科尔沁肉业"];
    const items = names.map((name, i) => makeOutwardItem(name, { supplier: suppliers[i % suppliers.length] }));

    render(
      <LedgerPrintDoc
        printDocType="out"
        activeLedger={ledger}
        selectedDate="2026-07-04"
        dailyInwardItems={[]}
        dailyOutwardItems={items}
        dailyInTotalAmount={0}
        onClose={vi.fn()}
      />
    );

    expect(document.querySelectorAll(".ledger-print-out-table")).toHaveLength(1);
    expect(screen.queryByText(/第 \d+ \/ \d+ 页/)).not.toBeInTheDocument();
    expect(screen.queryByText(/供货商续页/)).not.toBeInTheDocument();
    suppliers.forEach((name) => {
      expect(screen.getByText(new RegExp(`供货商：${name}`))).toBeInTheDocument();
    });
  });

  it("[V5.78.0] applies the same dynamic supplier capacity to the all-blank empty-day table, not just days with real data", () => {
    // 当日无任何出库数据时，整张表都是补白空行；这种情况下供货商容量也应按同一套弹性规则计算，
    // 而不是固定只给 maxSuppliersPerPage 条就分续页（此前遗留的边界 bug：空表场景的可用行数误按"已占满"计算）。
    // 临时扩充占位供货商列表，使其超过 maxSuppliersPerPage，验证依旧能在空表这唯一一页里完整展示，用完即还原。
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([]);
    const originalSuppliers = [...LEDGER_PRINT_OUT_CONFIG.suppliers];
    const extraCount = LEDGER_PRINT_OUT_CONFIG.maxSuppliersPerPage + 1;
    LEDGER_PRINT_OUT_CONFIG.suppliers.length = 0;
    LEDGER_PRINT_OUT_CONFIG.suppliers.push(
      ...Array.from({ length: extraCount }, (_, i) => `供货商：占位供应商${i + 1}`)
    );

    try {
      render(
        <LedgerPrintDoc
          printDocType="out"
          activeLedger={ledger}
          selectedDate="2026-07-04"
          dailyInwardItems={[]}
          dailyOutwardItems={[]}
          dailyInTotalAmount={0}
          onClose={vi.fn()}
        />
      );

      expect(document.querySelectorAll(".ledger-print-out-table")).toHaveLength(1);
      expect(screen.queryByText(/第 \d+ \/ \d+ 页/)).not.toBeInTheDocument();
      expect(screen.queryByText(/供货商续页/)).not.toBeInTheDocument();
      for (let i = 1; i <= extraCount; i++) {
        expect(screen.getByText(new RegExp(`占位供应商${i}(?!\\d)`))).toBeInTheDocument();
      }
    } finally {
      LEDGER_PRINT_OUT_CONFIG.suppliers.length = 0;
      LEDGER_PRINT_OUT_CONFIG.suppliers.push(...originalSuppliers);
    }
  });

  it("splits onto a second page when a category's items would exceed the page limit, without splitting the category itself", () => {
    // 蔬菜品类 20 种 + 肉类品类 10 种 = 30 行，超过单页上限：
    // 第1页放得下整组蔬菜(20行)，但肉类(10行)放不进剩余可用空格，因此肉类整组移到第2页，不允许被拆分
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
    expect(tables[0].querySelectorAll("tbody tr")).toHaveLength(LEDGER_PRINT_OUT_CONFIG.minPrintRows);
    
    const suppliersCount = 1; // 仅 1 个 "合作基地直供"
    const expectedLastPageRows = LEDGER_PRINT_OUT_CONFIG.minPrintRows + LEDGER_PRINT_OUT_CONFIG.maxSuppliersPerPage - suppliersCount;
    expect(tables[1].querySelectorAll("tbody tr")).toHaveLength(expectedLastPageRows);

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

    // 动态计算在新规则下的总页数
    const rowsUsed = items.length;
    const maxCapacity = LEDGER_PRINT_OUT_CONFIG.minPrintRows + LEDGER_PRINT_OUT_CONFIG.maxSuppliersPerPage;
    const firstChunkCapacity = Math.max(maxPerPage, maxCapacity - rowsUsed);
    
    let expectedTotalPages = 1;
    let remainingSuppliersCount = supplierCount;
    if (remainingSuppliersCount > firstChunkCapacity) {
      remainingSuppliersCount -= firstChunkCapacity;
      expectedTotalPages += Math.ceil(remainingSuppliersCount / maxCapacity);
    }

    expect(document.querySelectorAll(".ledger-print-out-table")).toHaveLength(1);
    
    if (expectedTotalPages > 1) {
      expect(screen.getByText(`第 1 / ${expectedTotalPages} 页`)).toBeInTheDocument();
      expect(screen.getByText(`第 ${expectedTotalPages} / ${expectedTotalPages} 页`)).toBeInTheDocument();
      expect(screen.getAllByText(/供货商续页/).length).toBeGreaterThan(0);
    } else {
      expect(screen.queryByText(/供货商续页/)).not.toBeInTheDocument();
    }

    expect(screen.getByText(new RegExp(`供货商：供货商1(?!\\d)`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`供货商：供货商${supplierCount}`))).toBeInTheDocument();
  });
});
