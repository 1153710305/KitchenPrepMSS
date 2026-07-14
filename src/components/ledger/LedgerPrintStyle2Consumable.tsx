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
  style2DatesArray,
  customDataRows
}: LedgerPrintStyle2ConsumableProps) {
  const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === activeItem.name);
  const displayName = dictItem?.name ?? activeItem.name;
  const displaySpec = dictItem?.remark || activeItem.spec || "";

  const activeRows = style2DatesArray
    .map((dStr) => ({ dStr, record: activeItem.dailyRecords[dStr] }))
    .filter(({ record }) => record && ((record.inQuantity || 0) > 0 || (record.outQuantity || 0) > 0));

  const rowsPerPage = customDataRows;
  const pages: Array<typeof activeRows> = [];
  if (activeRows.length === 0) {
    pages.push([]);
  } else {
    for (let i = 0; i < activeRows.length; i += rowsPerPage) {
      pages.push(activeRows.slice(i, i + rowsPerPage));
    }
  }

  const totalPages = pages.length;

  return (
    <div
      style={{
        fontFamily: LEDGER_PRINT_CONSUMABLE_CONFIG.fontFamily,
        fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize,
        color: "#000",
        marginLeft: "6mm",
        marginRight: "6mm"
      }}
      className="text-center"
    >
      {/* 提取共有样式至全局，避免每页重复定义 */}
      <style>{`
        .ledger-print-consumable-table, .ledger-print-consumable-table th, .ledger-print-consumable-table td {
          border: 1px solid #000000 !important;
        }

        /* 强行干掉 index.html 里的灰色表头背景 */
        .ledger-print-consumable-table thead th {
          background-color: #ffffff !important;
        }
        @page {
          margin: 12mm 18mm;
        }
        @media print {
          .ledger-print-consumable-table, .ledger-print-consumable-table th, .ledger-print-consumable-table td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            border-color: #000000 !important;
          }
        }
        /* 强制允许换行，并压缩字号行高防止撑开固定行高 */
        /* 强制允许换行，超出长度时在渲染节点内动态缩小字号 */
        .ledger-print-consumable-table td {
          word-break: break-all !important;
          white-space: normal !important;
        }
      `}</style>

      {pages.map((pageData, pageIndex) => {
        const isLastPage = pageIndex === totalPages - 1;
        const emptyRowsCount = Math.max(0, rowsPerPage - pageData.length);

        return (
          <div key={pageIndex}>
            <div style={{ position: "relative" }}>
              {/* 标题区：标题+日期作为一个左对齐整体块居中摆放 */}
              <div className="mb-3 relative" style={{ display: "flex", justifyContent: "center" }}>
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
                {/* 多页时显示页码，位于左下角 */}
                {totalPages > 1 && (
                  <div style={{ position: "absolute", left: 0, bottom: "2px", fontSize: "12px", color: "#444" }}>
                    第 {pageIndex + 1} / {totalPages} 页
                  </div>
                )}
              </div>

              <table className="ledger-print-consumable-table w-full border-collapse text-center mb-6" style={{ tableLayout: "fixed" }}>
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
                  {(() => {
                    const nameText = displayName || "";
                    const nameFontSize = nameText.length > 5 ? "11px" : LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize;
                    const nameLineHeight = nameText.length > 5 ? "1.2" : "normal";

                    const specText = displaySpec || "";
                    const specFontSize = specText.length > 4 ? "11px" : LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize;
                    const specLineHeight = specText.length > 4 ? "1.2" : "normal";

                    return pageData.map(({ dStr, record }) => {
                      const supplier = record!.supplier || "";
                      const supplierFontSize = supplier.length > 11 ? "11px" : LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize;
                      const supplierLineHeight = supplier.length > 11 ? "1.2" : "normal";

                      const buyer = record!.buyer || "";
                      const buyerFontSize = buyer.length > 4 ? "11px" : LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize;
                      const buyerLineHeight = buyer.length > 4 ? "1.2" : "normal";

                      const inspector = record!.inspector || "";
                      const inspectorFontSize = inspector.length > 10 ? "11px" : LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize;
                      const inspectorLineHeight = inspector.length > 10 ? "1.2" : "normal";

                      const keeper = record!.keeper || "";
                      const keeperFontSize = keeper.length > 15 ? "11px" : LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize;
                      const keeperLineHeight = keeper.length > 15 ? "1.2" : "normal";

                      return (
                        <tr key={dStr} style={{ height: LEDGER_PRINT_CONSUMABLE_CONFIG.dataRowHeight, fontSize: LEDGER_PRINT_CONSUMABLE_CONFIG.dataFontSize }}>
                          <td className="border border-black px-1 py-1" style={{ fontSize: nameFontSize, lineHeight: nameLineHeight }}>{nameText}</td>
                          <td className="border border-black px-1 py-1 ">{record!.inQuantity > 0 ? record!.inQuantity : ""}</td>
                          <td className="border border-black px-1 py-1" style={{ fontSize: specFontSize, lineHeight: specLineHeight }}>{specText}</td>
                          <td className="border border-black px-1 py-1" style={{ fontSize: supplierFontSize, lineHeight: supplierLineHeight }}>{supplier}</td>
                          <td className="border border-black px-1 py-1 ">{record!.inQuantity > 0 ? (record!.purchaseDate || dStr) : ""}</td>
                          <td className="border border-black px-1 py-1" style={{ fontSize: buyerFontSize, lineHeight: buyerLineHeight }}>{buyer}</td>
                          <td className="border border-black px-1 py-1" style={{ fontSize: inspectorFontSize, lineHeight: inspectorLineHeight }}>{inspector}</td>
                          <td className="border border-black px-1 py-1 ">{record!.inQuantity > 0 ? (record!.purchaseDate || dStr) : " \n "}</td>
                          <td className="border border-black px-1 py-1 ">{record!.outQuantity > 0 ? (record!.outDate || dStr) : ""}</td>
                          <td className="border border-black px-1 py-1" style={{ fontSize: keeperFontSize, lineHeight: keeperLineHeight }}>{keeper}</td>
                        </tr>
                      );
                    });
                  })()}

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
            {!isLastPage && <div style={{ breakAfter: "page", pageBreakAfter: "always", height: 0, overflow: "hidden" }}></div>}
          </div>
        );
      })}
    </div>
  );
}
