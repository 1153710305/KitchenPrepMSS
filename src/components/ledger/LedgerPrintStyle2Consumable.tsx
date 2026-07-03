/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账"单原料日流水"（样式二）在所选采购项目属于"低耗品"大类时使用的消耗品出入库台账专属打印模板：按纸质消耗品台账格式（序号/物品名称/规格/单位/经销商/入库数量/入库日期/入库经手人/出库数量/出库经手人/当期库存/备注）逐日列出该原料在选定时间段内的出入库流水，与其余大类共用的单原料日流水样式区分开。
 */

import { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { LEDGER_PRINT_CONSUMABLE_CONFIG } from "../../constants/ledgerConstants.ts";

/**
 * @description 消耗品单原料日流水打印模板组件入参接口
 */
interface LedgerPrintStyle2ConsumableProps {
  /** 当前选中的台账 */
  activeLedger: Ledger | null;
  /** 当前打印的原料项目 */
  activeItem: LedgerItem;
  /** 采购时间段 - 开始日期 */
  style2StartDate: string;
  /** 采购时间段 - 结束日期 */
  style2EndDate: string;
  /** 样式二时间段内的全量日期列表 */
  style2DatesArray: string[];
}

/** 表头列定义：文案与对应的百分比列宽 */
const COLUMNS = [
  { label: "序号", width: "5%" },
  { label: "物品名称", width: "11%" },
  { label: "规格", width: "9%" },
  { label: "单位", width: "6%" },
  { label: "经销商", width: "13%" },
  { label: "入库数量", width: "7%" },
  { label: "入库日期", width: "9%" },
  { label: "入库经手人", width: "8%" },
  { label: "出库数量", width: "7%" },
  { label: "出库经手人", width: "8%" },
  { label: "当期库存", width: "8%" },
  { label: "备注", width: "9%" }
];

/**
 * @description 【图二·消耗品专用】单原料日流水消耗品出入库台账打印预览模板组件
 */
export function LedgerPrintStyle2Consumable({
  activeLedger,
  activeItem,
  style2StartDate,
  style2EndDate,
  style2DatesArray
}: LedgerPrintStyle2ConsumableProps) {
  const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === activeItem.name);

  // 累计每日结余，起初结余为早于 style2StartDate 的所有累计量
  let tempStock = activeItem.initialStock || 0;
  Object.entries(activeItem.dailyRecords).forEach(([dateKey, record]) => {
    if (dateKey < style2StartDate) {
      tempStock += (record.inQuantity || 0) - (record.outQuantity || 0);
    }
  });

  const stockByDay: Record<string, number> = {};
  style2DatesArray.forEach((dStr) => {
    const rec = activeItem.dailyRecords[dStr];
    if (rec) {
      tempStock = tempStock + (rec.inQuantity || 0) - (rec.outQuantity || 0);
    }
    stockByDay[dStr] = Math.round(tempStock * 100) / 100;
  });

  // 仅列出有出入库活动的日期，逐日展示一行
  const activeRows = style2DatesArray
    .map((dStr) => ({ dStr, record: activeItem.dailyRecords[dStr] }))
    .filter(({ record }) => record && ((record.inQuantity || 0) > 0 || (record.outQuantity || 0) > 0));

  const emptyRowsCount = Math.max(0, LEDGER_PRINT_CONSUMABLE_CONFIG.minPrintRows - activeRows.length);

  return (
    <div style={{ fontFamily: LEDGER_PRINT_CONSUMABLE_CONFIG.fontFamily, fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.contentFontSize, color: "#000" }} className="text-center">
      {/* 大标题：去掉黑色边框，标题加上下划线 */}
      <table className="w-full border-collapse mb-0" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td style={{ border: "none", padding: "12px 0", textAlign: "center" }}>
              <span
                style={{
                  fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.titleFontSize,
                  fontWeight: "bold",
                  textDecoration: "underline"
                }}
              >
                {LEDGER_PRINT_CONSUMABLE_CONFIG.titlePrefix}{activeLedger?.name || ""}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* 打印时间段说明 */}
      <div className="text-center text-xs mb-3 font-bold">
        <span>日期：（  {style2StartDate} 至 {style2EndDate}  ）</span>
      </div>

      {/* 主表格：每行独立展示一天的出入库流水，不做跨行合并 */}
      <table className="w-full border-collapse border border-black text-center" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {COLUMNS.map((col) => (
            <col key={col.label} style={{ width: col.width }} />
          ))}
        </colgroup>

        <thead>
          <tr className="font-bold bg-gray-50" style={{ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.contentFontSize }}>
            {COLUMNS.map((col) => (
              <th key={col.label} className="border border-black px-1 py-2 align-middle">{col.label}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {activeRows.map(({ dStr, record }, idx) => (
            <tr key={dStr} style={{ height: "28px", fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.contentFontSize }}>
              <td className="border border-black px-1 py-1 font-mono">{idx + 1}</td>
              <td className="border border-black px-1 py-1 text-left font-bold">{dictItem?.name ?? activeItem.name}</td>
              <td className="border border-black px-1 py-1">{dictItem?.remark || activeItem.spec || "-"}</td>
              <td className="border border-black px-1 py-1">{dictItem?.unit ?? activeItem.unit}</td>
              <td className="border border-black px-1 py-1">{record.supplier || ""}</td>
              <td className="border border-black px-1 py-1 font-mono">{record.inQuantity > 0 ? record.inQuantity : ""}</td>
              <td className="border border-black px-1 py-1 font-mono">{record.inQuantity > 0 ? dStr : ""}</td>
              <td className="border border-black px-1 py-1">{record.buyer || ""}</td>
              <td className="border border-black px-1 py-1 font-mono">{record.outQuantity > 0 ? record.outQuantity : ""}</td>
              <td className="border border-black px-1 py-1">{record.outHandler || ""}</td>
              <td className="border border-black px-1 py-1 font-mono">{stockByDay[dStr]}</td>
              <td className="border border-black px-1 py-1 text-left">{record.note || ""}</td>
            </tr>
          ))}

          {/* 补充空行至最小行数，保持完整网格线（每格独立，不合并） */}
          {Array.from({ length: emptyRowsCount }).map((_, i) => (
            <tr key={`empty-${i}`} style={{ height: "28px", fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.contentFontSize }}>
              {COLUMNS.map((col) => (
                <td key={col.label} className="border border-black"></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
