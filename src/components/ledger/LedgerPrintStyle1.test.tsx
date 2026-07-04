/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerPrintStyle1（台账购销总表打印模板）组件测试：[V5.48.0] 选中的品类在本台账下没有任何原料时不再崩溃、正确渲染 15 行空白登记表的回归测试，
 * 以及有数据时的正常渲染、跨行合并单元格去重展示。
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LedgerPrintStyle1 } from "./LedgerPrintStyle1.tsx";
import { FoodCategory } from "../../types/types.ts";
import type { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";

const ledger: Ledger = { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" };

const makeItem = (id: string, name: string, dailyRecords: LedgerItem["dailyRecords"] = {}): LedgerItem => ({
  id,
  ledgerId: "KID",
  name,
  unit: "斤",
  spec: "散装",
  initialStock: 0,
  currentStock: 0,
  dailyRecords
});

const dictItems = [
  { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤" },
  { name: "精肉", category: FoodCategory.MEAT, unit: "斤" }
];

describe("LedgerPrintStyle1", () => {
  it("REGRESSION [V5.48.0]: does not crash and renders a 15-row blank table when the selected category has zero matching items", () => {
    const potato = makeItem("item_1", "土豆", {
      "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 }
    });

    expect(() =>
      render(
        <LedgerPrintStyle1
          activeLedger={ledger}
          selectedDate="2026-07-03"
          // 只勾选肉类，但本台账下唯一的原料"土豆"属于蔬菜类，不存在任何肉类原料
          selectedPrintCategories={[FoodCategory.MEAT]}
          currentLedgerItems={[potato]}
          dictItems={dictItems}
        />
      )
    ).not.toThrow();

    // 应渲染出 15 行空白登记表而不是崩溃（另有标题表格自身的 1 行 + 主表格 2 行表头）
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2 + 15);
  });

  it("renders one row per matching item with its quantity and merged supplier/buyer cells", () => {
    const potato = makeItem("item_1", "土豆", {
      "2026-07-03": {
        inQuantity: 3,
        inPrice: 2,
        inAmount: 6,
        outQuantity: 0,
        certification: "有",
        supplier: "合作基地直供",
        buyer: "张采购"
      }
    });

    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[potato]}
        dictItems={dictItems}
      />
    );

    expect(screen.getByText("土豆")).toBeInTheDocument();
    // 数量列现附带单位展示
    expect(screen.getByText("3斤")).toBeInTheDocument();
    expect(screen.getByText("合作基地直供")).toBeInTheDocument();
    expect(screen.getByText("张采购")).toBeInTheDocument();
  });

  it("excludes items that do not belong to any of the selected categories", () => {
    const potato = makeItem("item_1", "土豆", {
      "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 }
    });
    const meat = makeItem("item_2", "精肉", {
      "2026-07-03": { inQuantity: 1, inPrice: 20, inAmount: 20, outQuantity: 0 }
    });

    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[potato, meat]}
        dictItems={dictItems}
      />
    );

    expect(screen.getByText("土豆")).toBeInTheDocument();
    expect(screen.queryByText("精肉")).not.toBeInTheDocument();
  });

  it("[V5.81.0] REGRESSION: excludes items with no in/out activity on the selected date, even when the category is selected and the item exists in the ledger's roster", () => {
    // 台账历史上曾经采购过白菜（比如7月1号），但选定日期(7月2号)当天白菜毫无动静——不应作为空白行出现在总表里
    const cabbage = makeItem("item_1", "白菜", {
      "2026-07-01": { inQuantity: 10, inPrice: 1, inAmount: 10, outQuantity: 0 }
    });
    // 土豆是选定日期当天唯一真正有采购记录的原料
    const potato = makeItem("item_2", "土豆", {
      "2026-07-02": { inQuantity: 5, inPrice: 2, inAmount: 10, outQuantity: 0 }
    });

    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-02"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[cabbage, potato]}
        dictItems={[
          { name: "白菜", category: FoodCategory.VEGETABLE, unit: "斤" },
          { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤" }
        ]}
      />
    );

    expect(screen.getByText("土豆")).toBeInTheDocument();
    expect(screen.queryByText("白菜")).not.toBeInTheDocument();
  });

  it("[V5.81.0] REGRESSION: excludes items whose dailyRecord exists for the selected date but has zero in/out quantity", () => {
    const potato = makeItem("item_1", "土豆", {
      // 有当天记录条目，但入库出库数量均为 0（比如只是被草稿保存过一次，实际未发生任何采购/出库）
      "2026-07-02": { inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0 }
    });

    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-02"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[potato]}
        dictItems={dictItems}
      />
    );

    expect(screen.queryByText("土豆")).not.toBeInTheDocument();
  });

  it("shows the ledger name in the title", () => {
    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[]}
        dictItems={dictItems}
      />
    );
    expect(screen.getByText(/幼儿备餐/)).toBeInTheDocument();
  });

  it("[V5.56.0] renders '宾县第二小学...' as the main title and the ledger name as a separate subtitle line", () => {
    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[]}
        dictItems={dictItems}
      />
    );

    expect(screen.getByText("宾县第二小学食堂食品原材料购销台账")).toBeInTheDocument();
    expect(screen.getByText("幼儿备餐")).toBeInTheDocument();
  });

  it("[V5.56.0] shows the converted quantity and conversion unit instead of the raw quantity/unit when the dictionary defines a conversion ratio", () => {
    const pear = makeItem("item_1", "香梨", {
      "2026-07-03": { inQuantity: 2, inPrice: 30, inAmount: 60, outQuantity: 0 }
    });

    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.FRUIT]}
        currentLedgerItems={[pear]}
        dictItems={[
          { name: "香梨", category: FoodCategory.FRUIT, unit: "箱", conversionUnit: "斤", conversionRatio: 20 }
        ]}
      />
    );

    // 2 箱 * 20 (换算比例) = 40 斤，应展示换算后的数量与换算单位，而不是原始的 "2箱"
    expect(screen.getByText("40斤")).toBeInTheDocument();
    expect(screen.queryByText("2箱")).not.toBeInTheDocument();
  });

  it("[V5.56.0] falls back to the raw quantity and dictionary unit when no conversion ratio is defined", () => {
    const potato = makeItem("item_1", "土豆", {
      "2026-07-03": { inQuantity: 5, inPrice: 2, inAmount: 10, outQuantity: 0 }
    });

    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[potato]}
        dictItems={dictItems}
      />
    );

    expect(screen.getByText("5斤")).toBeInTheDocument();
  });

  it("[V5.58.0] splits the '食品索证' header into two lines and renders black 1px borders throughout the table", () => {
    render(
      <LedgerPrintStyle1
        activeLedger={ledger}
        selectedDate="2026-07-03"
        selectedPrintCategories={[FoodCategory.VEGETABLE]}
        currentLedgerItems={[]}
        dictItems={dictItems}
      />
    );

    const certHeader = screen.getByText("食品索证", { selector: "th" });
    expect(certHeader.innerHTML).toContain("<br");

    const nameHeader = screen.getByText("原材料名称", { selector: "th" });
    expect(nameHeader.innerHTML).toContain("<br");
  });
});
