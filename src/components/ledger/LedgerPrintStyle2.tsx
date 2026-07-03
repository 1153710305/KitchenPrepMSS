/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账"单原料日流水"（样式二）纯净打印模板：以单个原料为单位排版其在选定时间段内的逐日出入库流水，供物理打印或留档使用。
 */

import { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";
import { FoodCategory } from "../../types/types.ts";
import { LEDGER_PRINT_STYLE2_CONFIG } from "../../constants/ledgerConstants.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { LedgerPrintStyle2Consumable } from "./LedgerPrintStyle2Consumable.tsx";

/**
 * @description 单原料日流水打印入参接口
 */
interface LedgerPrintStyle2Props {
  /** 当前选中的台账 */
  activeLedger: Ledger | null;
  /** 当前焦点的原料项目 ID */
  activeItemId: string;
  /** 选定的日期 */
  selectedDate: string;
  /** 全量原料列表数据 */
  ledgerItems: LedgerItem[];
  /** 采购时间段 - 开始日期 */
  style2StartDate: string;
  /** 采购时间段 - 结束日期 */
  style2EndDate: string;
  /** 样式二时间段内的全量日期列表 */
  style2DatesArray: string[];
}

/**
 * @description 【图二】单原料自定义日期段流水卡片打印预览模板组件 (样式二)
 */
export function LedgerPrintStyle2({
  activeLedger,
  activeItemId,
  selectedDate,
  ledgerItems,
  style2StartDate,
  style2EndDate,
  style2DatesArray
}: LedgerPrintStyle2Props) {
  const activeItem = ledgerItems.find((i) => i.id === activeItemId);
  if (!activeItem) {
    return <div className="text-center p-12 text-slate-400">请先在系统里选择需要打印的单原料明细。</div>;
  }

  // 所选采购项目属于"低耗品"大类时，改用贴合纸质消耗品台账格式的专属打印模板，不与其余大类共用本样式
  const dictCategory = RawMaterialsDictService.getItems().find((d) => d.name === activeItem.name)?.category;
  if (dictCategory === FoodCategory.LOW_CONSUMP) {
    return (
      <LedgerPrintStyle2Consumable
        activeLedger={activeLedger}
        activeItem={activeItem}
        style2StartDate={style2StartDate}
        style2EndDate={style2EndDate}
        style2DatesArray={style2DatesArray}
      />
    );
  }

  // 提取有记录的供货商作为本单打印头部显示
  const sampleRecord = Object.entries(activeItem.dailyRecords).find(
    ([d, rec]) => rec.supplier || rec.certification
  )?.[1] || { supplier: "", certification: "" };

  const recordForSelectedDate = activeItem.dailyRecords[selectedDate] || {};
  const printSupplier = recordForSelectedDate.supplier || sampleRecord.supplier || "宾县鑫百达百货超市";
  const printCert = recordForSelectedDate.certification || sampleRecord.certification || "";

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

  return (
    <div style={{ fontFamily: LEDGER_PRINT_STYLE2_CONFIG.fontFamily, fontSize: LEDGER_PRINT_STYLE2_CONFIG.contentFontSize, color: "#000" }} className="text-center">
      {/* 1. 大标题居中 */}
      <div className="text-center mb-1">
        <h2 className="text-xl font-black tracking-widest">
          {LEDGER_PRINT_STYLE2_CONFIG.titlePrefix}{activeLedger?.name || ""}
        </h2>
      </div>

      {/* 2. 日期部分居中 */}
      <div className="text-center text-xs mb-3 font-bold">
        <span>日期：（  {style2StartDate} 至 {style2EndDate}  ）</span>
      </div>

      <table className="w-full text-center border-collapse border border-black text-xs mb-6" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>

        <thead>
          {/* 表头第一行：基础信息 */}
          <tr style={{ height: "28px" }}>
            <th className="border border-black px-1 font-bold bg-gray-50">采购项目</th>
            <th colSpan={2} className="border border-black px-1 font-bold text-left">{activeItem.name}</th>
            <th className="border border-black px-1 font-bold bg-gray-50">经销商</th>
            <th colSpan={3} className="border border-black px-1 font-normal text-left">{printSupplier}</th>
            <th className="border border-black px-1 font-bold bg-gray-50">索证索票</th>
            <th colSpan={2} className="border border-black px-1 font-normal text-left">{printCert}</th>
          </tr>

          {/* 表头第二行：大分类（入库/出库） */}
          <tr style={{ height: "24px" }} className="bg-gray-50 font-bold">
            <th colSpan={7} className="border border-black">入库</th>
            <th colSpan={3} className="border border-black">出库</th>
          </tr>

          {/* 表头第三行：明细列头 */}
          <tr style={{ height: "24px" }} className="bg-gray-50 font-bold">
            <th className="border border-black">日期</th>
            <th className="border border-black">采购数量</th>
            <th className="border border-black">采购员</th>
            <th className="border border-black">生产日期</th>
            <th className="border border-black">保质期</th>
            <th className="border border-black">感官性状</th>
            <th className="border border-black">检验员</th>
            <th className="border border-black">出库数量</th>
            <th className="border border-black">当日库存</th>
            <th className="border border-black">保管员</th>
          </tr>
        </thead>

        <tbody>
          {(() => {
            const activeDays = style2DatesArray.map((dStr) => {
              const record = activeItem.dailyRecords[dStr];
              const hasActivity = record && ((record.inQuantity || 0) > 0 || (record.outQuantity || 0) > 0);
              return { dStr, record, hasActivity };
            });

            const renderedRows = activeDays.map(({ dStr, record, hasActivity }) => {
              const balance = stockByDay[dStr];
              if (!hasActivity || !record) return null;

              return (
                <tr key={dStr} style={{ height: "28px", fontSize: LEDGER_PRINT_STYLE2_CONFIG.contentFontSize }}>
                  <td className="border border-black font-mono text-[10px]">{dStr}</td>
                  <td className="border border-black font-mono">{record.inQuantity || ""}</td>
                  <td className="border border-black">{record.buyer || ""}</td>
                  <td className="border border-black font-mono text-[10px]">{record.produceDate || ""}</td>
                  <td className="border border-black text-[10px]">{record.shelfLife || ""}</td>
                  <td className="border border-black">{record.sensoryProperty || ""}</td>
                  <td className="border border-black">{record.inspector || ""}</td>
                  <td className="border border-black font-mono">{record.outQuantity || ""}</td>
                  <td className="border border-black font-mono font-bold">{balance}</td>
                  <td className="border border-black">{record.keeper || ""}</td>
                </tr>
              );
            }).filter(Boolean);

            const filledCount = renderedRows.length;
            const emptyRowsCount = Math.max(0, 15 - filledCount);

            return (
              <>
                {renderedRows}
                {Array.from({ length: emptyRowsCount }).map((_, i) => (
                  <tr key={`empty-${i}`} style={{ height: "28px", fontSize: LEDGER_PRINT_STYLE2_CONFIG.contentFontSize }}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="border border-black"></td>
                    ))}
                  </tr>
                ))}
              </>
            );
          })()}
        </tbody>
      </table>


    </div>
  );
}
