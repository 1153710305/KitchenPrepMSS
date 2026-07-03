/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerPrintStyle2（台账单原料日流水打印模板）组件测试：未选中原料时的提示文案、低耗品大类自动委托给专属消耗品模板、
 * 信息行对齐规则（经销商右对齐、其余居中）、采购数量列的换算单位展示、标题/日期/受众副标题三者的左对齐结构。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LedgerPrintStyle2 } from "./LedgerPrintStyle2.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FoodCategory } from "../../types/types.ts";
import type { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";

const ledger: Ledger = { id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" };

const makeItem = (dailyRecords: LedgerItem["dailyRecords"] = {}, initialStock = 0): LedgerItem => ({
  id: "item_1",
  ledgerId: "KID",
  name: "土豆",
  unit: "斤",
  spec: "散装",
  initialStock,
  currentStock: initialStock,
  dailyRecords
});

describe("LedgerPrintStyle2", () => {
  beforeEach(() => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a placeholder message when activeItemId does not match any item", () => {
    render(
      <LedgerPrintStyle2
        activeLedger={ledger}
        activeItemId="missing"
        selectedDate="2026-07-03"
        ledgerItems={[makeItem()]}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );
    expect(screen.getByText(/请先在系统里选择需要打印的单原料明细/)).toBeInTheDocument();
  });

  it("delegates to the consumable-specific template when the item's dictionary category is LOW_CONSUMP", () => {
    vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
      { name: "大黑袋", category: FoodCategory.LOW_CONSUMP, unit: "捆", remark: "" }
    ]);
    const bag = { ...makeItem(), name: "大黑袋" };

    render(
      <LedgerPrintStyle2
        activeLedger={ledger}
        activeItemId="item_1"
        selectedDate="2026-07-03"
        ledgerItems={[bag]}
        style2StartDate="2026-07-01"
        style2EndDate="2026-07-05"
        style2DatesArray={["2026-07-01"]}
      />
    );

    // 消耗品专属模板标题前缀与本样式不同，用它来断言确实委托成功
    expect(screen.getByText(/宾县第二小学食堂消耗品出入库台账/)).toBeInTheDocument();
  });

  describe("header info row alignment", () => {
    it("right-aligns the 经销商 (supplier) value while centering the other info cells", () => {
      const item = makeItem({
        "2026-07-03": { inQuantity: 5, inPrice: 2, inAmount: 10, outQuantity: 0, supplier: "合作基地直供", certification: "有" }
      });

      render(
        <LedgerPrintStyle2
          activeLedger={ledger}
          activeItemId="item_1"
          selectedDate="2026-07-03"
          ledgerItems={[item]}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={["2026-07-03"]}
        />
      );

      const supplierCell = screen.getByText("合作基地直供", { selector: "th" });
      expect(supplierCell.className).toContain("text-right");

      const nameCell = screen.getByText("土豆", { selector: "th" });
      expect(nameCell.className).toContain("text-center");

      const certCell = screen.getByText("有", { selector: "th" });
      expect(certCell.className).toContain("text-center");
    });
  });

  describe("title / date / subtitle header structure", () => {
    it("renders the title without a trailing dash and the ledger name as a separate right-side element", () => {
      render(
        <LedgerPrintStyle2
          activeLedger={ledger}
          activeItemId="item_1"
          selectedDate="2026-07-03"
          ledgerItems={[makeItem()]}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={["2026-07-01"]}
        />
      );

      expect(screen.getByText("宾县第二小学食堂食品原材料购销台账")).toBeInTheDocument();
      expect(screen.getByText("幼儿备餐")).toBeInTheDocument();
      expect(screen.queryByText(/宾县第二小学食堂食品原材料购销台账-/)).not.toBeInTheDocument();
    });

    it("shows the date range below the title", () => {
      render(
        <LedgerPrintStyle2
          activeLedger={ledger}
          activeItemId="item_1"
          selectedDate="2026-07-03"
          ledgerItems={[makeItem()]}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={["2026-07-01"]}
        />
      );

      expect(screen.getByText(/2026-07-01/)).toBeInTheDocument();
      expect(screen.getByText(/2026-07-05/)).toBeInTheDocument();
    });
  });

  describe("采购数量 (purchase quantity) column", () => {
    it("shows the converted quantity and conversion unit when the dictionary defines a conversion ratio", () => {
      vi.spyOn(RawMaterialsDictService, "getItems").mockReturnValue([
        { name: "香梨", category: FoodCategory.FRUIT, unit: "箱", conversionUnit: "斤", conversionRatio: 20 }
      ]);
      const pear = { ...makeItem({
        "2026-07-03": { inQuantity: 2, inPrice: 30, inAmount: 60, outQuantity: 0 }
      }), name: "香梨" };

      render(
        <LedgerPrintStyle2
          activeLedger={ledger}
          activeItemId="item_1"
          selectedDate="2026-07-03"
          ledgerItems={[pear]}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={["2026-07-03"]}
        />
      );

      // 2 箱 * 20 (换算比例) = 40 斤
      expect(screen.getByText("40斤")).toBeInTheDocument();
      expect(screen.queryByText("2箱")).not.toBeInTheDocument();
    });

    it("falls back to the raw quantity and dictionary unit when no conversion ratio is defined", () => {
      const item = makeItem({
        "2026-07-03": { inQuantity: 5, inPrice: 2, inAmount: 10, outQuantity: 0 }
      });

      render(
        <LedgerPrintStyle2
          activeLedger={ledger}
          activeItemId="item_1"
          selectedDate="2026-07-03"
          ledgerItems={[item]}
          style2StartDate="2026-07-01"
          style2EndDate="2026-07-05"
          style2DatesArray={["2026-07-03"]}
        />
      );

      expect(screen.getByText("5斤")).toBeInTheDocument();
    });
  });
});
