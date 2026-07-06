/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账"单原料日流水"（样式二）在所选采购项目属于"低耗品"大类时使用的消耗品出入库台账专属打印模板：按购销总表（图一）同款排版风格（物品名称/数量/规格/供货商/采购时间/采购员/检验员/出入库时间/保管员）逐日列出该原料在选定时间段内的出入库流水，与其余大类共用的单原料日流水样式区分开。
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
  const displayName = dictItem?.name ?? activeItem.name;
  const displaySpec = dictItem?.remark || activeItem.spec || "-";

  // 仅列出有出入库活动的日期，逐日展示一行
  const activeRows = style2DatesArray
    .map((dStr) => ({ dStr, record: activeItem.dailyRecords[dStr] }))
    .filter(({ record }) => record && ((record.inQuantity || 0) > 0 || (record.outQuantity || 0) > 0));

  const emptyRowsCount = Math.max(0, LEDGER_PRINT_CONSUMABLE_CONFIG.minPrintRows - activeRows.length);

  return (
    <div style={{ fontFamily: LEDGER_PRINT_CONSUMABLE_CONFIG.fontFamily, fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize, color: "#000" }} className="text-center">
      {/* 标题区：标题+日期作为一个左对齐整体块居中摆放；受众台账名与日期同一行水平对齐，且右边缘对齐标题最后一个字 */}
      <div className="mb-3" style={{ display: "flex", justifyContent: "center" }}>
        <div className="text-left">
          <div style={{ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.titleFontSize, fontWeight: "bold", textDecoration: "underline" }} className="tracking-widest">
            {LEDGER_PRINT_CONSUMABLE_CONFIG.titlePrefix}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "2px" }}>
            <div style={{ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.subtitleFontSize, fontWeight: "bold" }}>
              日期：（  {style2StartDate} 至 {style2EndDate}  ）
            </div>
            <div style={{ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.subtitleFontSize, whiteSpace: "nowrap", marginLeft: "12px" }}>
              {activeLedger?.name || ""}
            </div>
          </div>
        </div>
      </div>

      {/* 主表格：与购销总表（图一）同款排版风格，每行独立展示一天的出入库流水，不做跨行合并；
          线框颜色/粗细通过下方 <style> 强制统一为纯黑细线，与其余打印样式保持一致 */}
      <style>{`
        .ledger-print-consumable-table, .ledger-print-consumable-table th, .ledger-print-consumable-table td {
          border: 1px solid #000000 !important;
        }

        /* 增加下面这三行，用来强行干掉 index.html 里的灰色表头背景 */
        .ledger-print-consumable-table thead th {
          background-color: #ffffff !important;
        }
        @media print {
          .ledger-print-consumable-table, .ledger-print-consumable-table th, .ledger-print-consumable-table td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            border-color: #000000 !important;
          }
        }
      `}</style>
      <table className="ledger-print-consumable-table w-full border-collapse text-center" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "23%" }} />
        </colgroup>

        <thead>
          <tr className=" bg-white" style={{ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.headerFontSize }}>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">物品名称</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">数量</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">规格</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">供货商</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">
              <div>采购</div>
              <div>时间</div>
            </th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">采购员</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">检验员</th>
            <th colSpan={2} className="border border-black px-1 py-1 align-middle">出入库时间</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">保管员</th>
          </tr>
          <tr className=" bg-white" style={{ fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.headerFontSize }}>
            <th className="border border-black px-1 py-1 align-middle">入库</th>
            <th className="border border-black px-1 py-1 align-middle">出库</th>
          </tr>
        </thead>

        <tbody>
          {activeRows.map(({ dStr, record }) => (
            <tr key={dStr} style={{ height: LEDGER_PRINT_CONSUMABLE_CONFIG.dataRowHeight, fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize }}>
              <td className="border border-black px-1 py-1 ">{displayName}</td>
              <td className="border border-black px-1 py-1 ">{record.inQuantity > 0 ? record.inQuantity : ""}</td>
              <td className="border border-black px-1 py-1">{displaySpec}</td>
              <td className="border border-black px-1 py-1">{record.supplier || ""}</td>
              <td className="border border-black px-1 py-1 ">{record.inQuantity > 0 ? (record.purchaseDate || dStr) : ""}</td>
              <td className="border border-black px-1 py-1">{record.buyer || ""}</td>
              <td className="border border-black px-1 py-1">{record.inspector || ""}</td>
              <td className="border border-black px-1 py-1 ">{record.inQuantity > 0 ? (record.purchaseDate || dStr) : ""}</td>
              <td className="border border-black px-1 py-1 ">{record.outQuantity > 0 ? (record.outDate || dStr) : ""}</td>
              <td className="border border-black px-1 py-1">{record.keeper || ""}</td>
            </tr>
          ))}

          {/* 补充空行至最小行数，保持完整网格线（每格独立，不合并） */}
          {Array.from({ length: emptyRowsCount }).map((_, i) => (
            <tr key={`empty-${i}`} style={{ height: LEDGER_PRINT_CONSUMABLE_CONFIG.dataRowHeight, fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize }}>
              {Array.from({ length: 10 }).map((_, j) => (
                <td key={j} className="border border-black"></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
