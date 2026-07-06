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
  const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === activeItem.name);
  if (dictItem?.category === FoodCategory.LOW_CONSUMP) {
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

  // 采购数量列：优先展示换算后的数量与换算单位，无换算配置时展示原始数量与默认单位
  const hasConversion = !!(dictItem && dictItem.conversionUnit && dictItem.conversionRatio);
  const displayUnit = hasConversion ? dictItem!.conversionUnit : (dictItem?.unit || activeItem.unit);

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
    <div style={{ fontFamily: LEDGER_PRINT_STYLE2_CONFIG.fontFamily, fontSize: LEDGER_PRINT_STYLE2_CONFIG.dataFontSize, color: "#000" }} className="text-center">
      {/* 标题区：标题+日期作为一个整体块居中摆放；受众台账名与日期同一行水平对齐，且右边缘对齐标题最后一个字"账" */}
      <div className="mb-3" style={{ display: "flex", justifyContent: "center" }}>
        <div className="text-left">
          <div style={{ fontSize: LEDGER_PRINT_STYLE2_CONFIG.titleFontSize, fontWeight: "bold" }} className="tracking-widest">
            {LEDGER_PRINT_STYLE2_CONFIG.titlePrefix}
          </div>
          {/* 日期与受众副标题同一行：justify-content: space-between 使受众副标题贴到本行右边缘，
              而本行宽度继承自上方标题行（作为本区块内最宽的一行），故受众副标题的最后一个字恰好与标题的最后一个字对齐 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "2px" }}>
            <div style={{ fontSize: LEDGER_PRINT_STYLE2_CONFIG.dateFontSize, fontWeight: "bold", marginLeft: "28px" }}>
              日期：（  {style2StartDate} 至 {style2EndDate}  ）
            </div>
            <div style={{ fontSize: LEDGER_PRINT_STYLE2_CONFIG.subtitleFontSize, whiteSpace: "nowrap", marginRight: "52px" }}>
              {activeLedger?.name || ""}
            </div>
          </div>
        </div>
      </div>

      {/* 主表格：线框颜色/粗细通过下方 <style> 强制统一为纯黑细线，与图一打印样式保持一致 */}
      <style>{`
        .ledger-print-style2-table, .ledger-print-style2-table th, .ledger-print-style2-table td {
          border: 1px solid #000000 !important;
        }
        /* 干掉 index.html 的表头全局灰色 */
.ledger-print-style2-table thead th {
  background-color: #ffffff !important;
}

        @media print {
          .ledger-print-style2-table, .ledger-print-style2-table th, .ledger-print-style2-table td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            border-color: #000000 !important;
          }
        }
        @page {
          margin: 12mm 18mm; /* 上下保持 12mm 不变，左右 1.5 倍变为 18mm */
        }
      `}</style>
      <table className="ledger-print-style2-table w-full text-center border-collapse mb-6" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "25%" }} />
        </colgroup>

        <thead style={{ fontSize: LEDGER_PRINT_STYLE2_CONFIG.headerFontSize }}>
          {/* 表头第一行：基础信息 */}
          <tr style={{ height: "28px" }}>
            <th className="border border-black px-1  bg-white">采购项目</th>
            <th colSpan={2} className="border border-black px-1  text-center">{activeItem.name}</th>
            <th className="border border-black px-1  bg-white">经销商</th>
            <th colSpan={3} className="border border-black px-1 font-normal text-center">{printSupplier}</th>
            <th className="border border-black px-1  bg-white">索证索票</th>
            <th colSpan={2} className="border border-black px-1 font-normal text-center">{printCert}</th>
          </tr>

          {/* 表头第二行：大分类（入库/出库） */}
          <tr style={{ height: "24px" }} className="bg-white ">
            <th colSpan={7} className="border border-black">入库</th>
            <th colSpan={3} className="border border-black">出库</th>
          </tr>

          {/* 表头第三行：明细列头 */}
          <tr style={{ height: "24px" }} className="bg-white ">
            <th className="border border-black">日期</th>
            <th className="border border-black">
              <div>采购</div>
              <div>数量</div>
            </th>
            <th className="border border-black">采购员</th>
            <th className="border border-black">
              <div>生产</div>
              <div>日期</div>
            </th>
            <th className="border border-black">保质期</th>
            <th className="border border-black">感官性状</th>
            <th className="border border-black">检验员</th>
            <th className="border border-black">
              <div>出库</div>
              <div>数量</div>
            </th>
            <th className="border border-black">
              <div>当日</div>
              <div>库存</div>
            </th>
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

              // 采购数量：优先展示换算后的数量与换算单位，无换算配置时展示原始数量与默认单位
              const displayQty = record.inQuantity > 0
                ? (hasConversion ? Number((record.inQuantity * dictItem!.conversionRatio!).toFixed(2)) : record.inQuantity)
                : "";

              return (
                <tr key={dStr} style={{ height: "28px", fontSize: LEDGER_PRINT_STYLE2_CONFIG.dataFontSize }}>
                  <td className="border border-black  ">{dStr}</td>
                  <td className="border border-black ">{displayQty !== "" ? `${displayQty}${displayUnit}` : ""}</td>
                  <td className="border border-black">{record.buyer || ""}</td>
                  <td className="border border-black  ">{record.produceDate || ""}</td>
                  <td className="border border-black ">{record.shelfLife || ""}</td>
                  <td className="border border-black">{record.sensoryProperty || ""}</td>
                  <td className="border border-black">{record.inspector || ""}</td>
                  <td className="border border-black ">{record.outQuantity || ""}</td>
                  <td className="border border-black  ">{balance}</td>
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
                  <tr key={`empty-${i}`} style={{ height: "28px", fontSize: LEDGER_PRINT_STYLE2_CONFIG.dataFontSize }}>
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
