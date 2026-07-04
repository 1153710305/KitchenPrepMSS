/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账"购销总表"（样式一）纯净打印模板：以食品原材料购销总表格式排版全部原料的当日出入库明细，供物理打印或留档使用。
 */

import { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";
import { FoodCategory } from "../../types/types.ts";
import { LEDGER_PRINT_STYLE1_CONFIG } from "../../constants/ledgerConstants.ts";

/**
 * @description 购销总表打印预览模板组件入参接口
 */
interface LedgerPrintStyle1Props {
  /** 当前选中的台账 */
  activeLedger: Ledger | null;
  /** 选定的日期 */
  selectedDate: string;
  /** 勾选的分类 */
  selectedPrintCategories: FoodCategory[];
  /** 当前台账的全部原料项 */
  currentLedgerItems: LedgerItem[];
  /** 从字典服务获取的所有原料项目快照 */
  dictItems: any[];
}

/** 数据行行高（数值形式，用于计算跨行合并单元格的总高度） */
const DATA_ROW_HEIGHT_PX = parseFloat(LEDGER_PRINT_STYLE1_CONFIG.dataRowHeight);

/**
 * @description 【图一】购销总表打印预览模板组件 (样式一)
 */
export function LedgerPrintStyle1({
  activeLedger,
  selectedDate,
  selectedPrintCategories,
  currentLedgerItems,
  dictItems
}: LedgerPrintStyle1Props) {
  // 根据用户勾选的二级分类过滤打印原料
  const toPrintItems = currentLedgerItems.filter((item) => {
    const dictItem = dictItems.find(d => d.name === item.name);
    return dictItem && selectedPrintCategories.includes(dictItem.category);
  });

  const filledCount = toPrintItems.length;
  const emptyRowsCount = Math.max(0, LEDGER_PRINT_STYLE1_CONFIG.minPrintRows - filledCount);
  const totalRows = filledCount + emptyRowsCount;

  /** 跨行合并单元格（供货商及地址/采购时间/采购员/检验员/出入库时间/保管员）的总高度 */
  const mergedCellHeightPx = totalRows * DATA_ROW_HEIGHT_PX;

  /**
   * @description 提取各个列的去重非空值，供跨行合并单元格展示
   */
  const getUniqueFieldValues = (extractor: (record: any) => string) => {
    const list = toPrintItems.map(item => {
      const record = item.dailyRecords[selectedDate];
      return record ? extractor(record) : "";
    }).filter(Boolean);
    return Array.from(new Set(list));
  };

  const suppliers = getUniqueFieldValues(r => r.supplier || "");
  const purchaseDates = getUniqueFieldValues(r => r.inQuantity > 0 ? (r.purchaseDate || selectedDate) : "");
  const buyers = getUniqueFieldValues(r => r.buyer || "");
  const inspectors = getUniqueFieldValues(r => r.inspector || "");
  const inDates = getUniqueFieldValues(r => r.inQuantity > 0 ? (r.purchaseDate || selectedDate) : "");
  const outDates = getUniqueFieldValues(r => r.outQuantity > 0 ? (r.outDate || selectedDate) : "");
  const keepers = getUniqueFieldValues(r => r.keeper || "");

  /**
   * @description 渲染合并单元格内的多行文本，内容定位在单元格纵向前 1/3 处（而非居中），便于跨行阅读定位
   */
  const renderMergedCell = (values: string[]) => {
    if (values.length === 0) return "-";
    return (
      <div
        className="flex flex-col items-center gap-0.5"
        style={{ height: `${mergedCellHeightPx}px`, paddingTop: `${mergedCellHeightPx / 3}px`, boxSizing: "border-box" }}
      >
        {values.map((v, i) => <div key={i}>{v}</div>)}
      </div>
    );
  };

  return (
    <div
      style={{
        fontFamily: LEDGER_PRINT_STYLE1_CONFIG.fontFamily,
        fontSize: LEDGER_PRINT_STYLE1_CONFIG.dataFontSize,
        color: "#000",
        // 左右两侧各收回 5mm，在当前打印容器边距基础上腾出装订空间
        marginLeft: "-5mm",
        marginRight: "-5mm"
      }}
      className="text-center"
    >
      {/* 大标题：去掉黑色边框，标题加下划线；受众台账名作为副标题放在标题下方 */}
      <table className="w-full border-collapse mb-0" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td style={{ border: "none", padding: "12px 0 4px", textAlign: "center" }}>
              <div style={{ fontSize: LEDGER_PRINT_STYLE1_CONFIG.titleFontSize, fontWeight: "bold", textDecoration: "underline" }}>
                {LEDGER_PRINT_STYLE1_CONFIG.titlePrefix}
              </div>
              <div style={{ fontSize: LEDGER_PRINT_STYLE1_CONFIG.subtitleFontSize, marginTop: "2px" }}>
                {activeLedger?.name || ""}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* 主表格：线框颜色/粗细通过下方 <style> 强制统一为纯黑细线，避免打印时因子像素反锯齿呈现偏蓝色调、粗细不一 */}
      <style>{`
        .ledger-print-style1-table, .ledger-print-style1-table th, .ledger-print-style1-table td {
          border: 1px solid #000000 !important;
        }
        @media print {
          .ledger-print-style1-table, .ledger-print-style1-table th, .ledger-print-style1-table td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            border-color: #000000 !important;
          }
        }
      `}</style>
      <table className="ledger-print-style1-table w-full border-collapse text-center" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {/* "原材料名称"三字宽、"食品索证"两字宽：窄列腾出的空间分配给"感官性状"/"供货商及地址"两个长文本列 */}
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>

        <thead>
          <tr className="font-bold bg-gray-50" style={{ fontSize: LEDGER_PRINT_STYLE1_CONFIG.headerFontSize }}>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">原材料<br />名称</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">数量</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">食品<br />索证</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">感官性状</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">供货商<br />及地址</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">采购时间</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">采购员</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">检验员</th>
            <th colSpan={2} className="border border-black px-1 py-1 align-middle">出入库时间</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">保管员</th>
          </tr>
          <tr className="font-bold bg-gray-50" style={{ fontSize: LEDGER_PRINT_STYLE1_CONFIG.headerFontSize }}>
            <th className="border border-black px-1 py-1 align-middle">入库</th>
            <th className="border border-black px-1 py-1 align-middle">出库</th>
          </tr>
        </thead>

        <tbody>
          {toPrintItems.length === 0 ? (
            /* 当无明细时，至少渲染 15 行空行，并且后 7 列合并为一个大空单元格 */
            Array.from({ length: LEDGER_PRINT_STYLE1_CONFIG.minPrintRows }).map((_, i) => (
              <tr key={`empty-all-${i}`} style={{ height: LEDGER_PRINT_STYLE1_CONFIG.dataRowHeight, fontSize: LEDGER_PRINT_STYLE1_CONFIG.dataFontSize }}>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                {i === 0 && (
                  <>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black align-middle" rowSpan={LEDGER_PRINT_STYLE1_CONFIG.minPrintRows}>-</td>
                  </>
                )}
              </tr>
            ))
          ) : (
            <>
              {toPrintItems.map((item, idx) => {
                const record = item.dailyRecords[selectedDate] || {
                  inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0,
                  certification: "", sensoryProperty: "", supplier: "",
                  purchaseDate: "", buyer: "", inspector: "", keeper: "", outDate: ""
                };

                const isFirstRow = idx === 0;

                // 数量列：优先展示换算后的数量与换算单位，无换算配置时展示原始数量与默认单位
                const dictItem = dictItems.find(d => d.name === item.name);
                const hasConversion = !!(dictItem && dictItem.conversionUnit && dictItem.conversionRatio);
                const displayUnit = hasConversion ? dictItem.conversionUnit : (dictItem?.unit || item.unit);
                const displayQty = record.inQuantity > 0
                  ? (hasConversion ? Number((record.inQuantity * dictItem.conversionRatio).toFixed(2)) : record.inQuantity)
                  : "";

                return (
                  <tr key={item.id} style={{ height: LEDGER_PRINT_STYLE1_CONFIG.dataRowHeight, fontSize: LEDGER_PRINT_STYLE1_CONFIG.dataFontSize }}>
                    <td className="border border-black px-1 py-1 text-center font-bold">{item.name}</td>
                    <td className="border border-black px-1 py-1 font-mono">
                      {displayQty !== "" ? `${displayQty}${displayUnit}` : ""}
                    </td>
                    <td className="border border-black px-1 py-1">{record.certification || ""}</td>
                    <td className="border border-black px-1 py-1">{record.sensoryProperty || ""}</td>
                    {isFirstRow && (
                      <>
                        <td className="border border-black px-1 py-1 text-center align-top" rowSpan={totalRows}>
                          {renderMergedCell(suppliers)}
                        </td>
                        <td className="border border-black px-1 py-1 font-mono align-top" rowSpan={totalRows}>
                          {renderMergedCell(purchaseDates)}
                        </td>
                        <td className="border border-black px-1 py-1 align-top" rowSpan={totalRows}>
                          {renderMergedCell(buyers)}
                        </td>
                        <td className="border border-black px-1 py-1 align-top" rowSpan={totalRows}>
                          {renderMergedCell(inspectors)}
                        </td>
                        <td className="border border-black px-1 py-1 font-mono align-top" rowSpan={totalRows}>
                          {renderMergedCell(inDates)}
                        </td>
                        <td className="border border-black px-1 py-1 font-mono align-top" rowSpan={totalRows}>
                          {renderMergedCell(outDates)}
                        </td>
                        <td className="border border-black px-1 py-1 align-top" rowSpan={totalRows}>
                          {renderMergedCell(keepers)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}

              {/* 补充空行，只渲染前 4 列，后 7 列由首行 rowSpan 覆盖 */}
              {Array.from({ length: emptyRowsCount }).map((_, i) => (
                <tr key={`empty-${i}`} style={{ height: LEDGER_PRINT_STYLE1_CONFIG.dataRowHeight, fontSize: LEDGER_PRINT_STYLE1_CONFIG.dataFontSize }}>
                  <td className="border border-black"></td>
                  <td className="border border-black"></td>
                  <td className="border border-black"></td>
                  <td className="border border-black"></td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
