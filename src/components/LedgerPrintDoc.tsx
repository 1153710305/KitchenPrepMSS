/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ledger, LedgerItem } from "../ledgerTypes.ts";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { AlertCircle } from "lucide-react";
import { FOOD_CATEGORY_LABELS } from "../constants.ts";
import { FoodCategory } from "../types.ts";
import { LEDGER_PRINT_OUT_CONFIG } from "../ledgerConstants.ts";

/**
 * @description 打印凭证组件入参接口
 */
interface LedgerPrintDocProps {
  /** 打印单据类型: "in" | "out" */
  printDocType: "in" | "out";
  /** 当前选定台账 */
  activeLedger: Ledger | null;
  /** 选定日期 */
  selectedDate: string;
  /** 当日有入库变动明细 */
  dailyInwardItems: any[];
  /** 当日有出库变动明细 */
  dailyOutwardItems: any[];
  /** 今日总入库金额 */
  dailyInTotalAmount: number;
  /** 关闭预览回调 */
  onClose: () => void;
}

/**
 * @description 入库单打印模板内容组件
 */
function PrintInDoc({
  activeLedger,
  selectedDate,
  dailyInwardItems,
  dailyInTotalAmount
}: {
  activeLedger: Ledger | null;
  selectedDate: string;
  dailyInwardItems: any[];
  dailyInTotalAmount: number;
}) {
  return (
    <>
      {/* 凭证大标题 */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-black tracking-widest border-b-2 border-black pb-2 inline-block">
          {activeLedger?.name}台账 —— 原料入库单
        </h2>
        <div className="flex justify-between text-xs mt-3 px-1">
          <span>日期：<strong className="underline">{selectedDate}</strong></span>
          <span>台账类别：<strong className="underline">{activeLedger?.name}</strong></span>
          <span>单据编号：<strong className="underline font-mono">NO.{selectedDate.replace(/-/g, "")}01</strong></span>
        </div>
      </div>

      {/* 凭证明细表格 */}
      <table className="w-full text-left border-collapse border border-black text-xs mb-8">
        <thead>
          <tr className="bg-gray-100 text-center">
            <th className="border border-black px-2 py-2.5 w-12 font-bold">序号</th>
            <th className="border border-black px-3 py-2.5 font-bold">食品原材料品名</th>
            <th className="border border-black px-3 py-2.5 font-bold">规格描述</th>
            <th className="border border-black px-2 py-2.5 w-16 font-bold">单位</th>
            <th className="border border-black px-3 py-2.5 w-24 font-bold">今日入库数</th>
            <th className="border border-black px-3 py-2.5 w-24 font-bold">单价(元)</th>
            <th className="border border-black px-3 py-2.5 w-28 font-bold">金额(元)</th>
            <th className="border border-black px-3 py-2.5 w-24 font-bold">发料出库人</th>
            <th className="border border-black px-3 py-2.5 w-24 font-bold">接收领料人</th>
            <th className="border border-black px-3 py-2.5 w-20 font-bold">食品索证</th>
            <th className="border border-black px-3 py-2.5 w-20 font-bold">感官性状</th>
            <th className="border border-black px-3 py-2.5 font-bold">备注说明/去处</th>
          </tr>
        </thead>
        <tbody>
          {dailyInwardItems.length === 0 ? (
            <tr>
              <td colSpan={12} className="border border-black text-center py-6 text-gray-500 italic">
                今日无入库数据记录
              </td>
            </tr>
          ) : (
            dailyInwardItems.map((item, index) => (
              <tr key={item.id} className="hover:bg-gray-50 text-center">
                <td className="border border-black px-2 py-2 font-mono">{index + 1}</td>
                <td className="border border-black px-3 py-2 text-left font-bold">
                  {RawMaterialsDictService.getItems().find(d => d.name === item.name)?.name ?? item.name}
                </td>
                <td className="border border-black px-3 py-2 text-left">
                  {RawMaterialsDictService.getItems().find(d => d.name === item.name)?.remark || item.spec || "-"}
                </td>
                <td className="border border-black px-2 py-2">
                  {RawMaterialsDictService.getItems().find(d => d.name === item.name)?.unit ?? item.unit}
                </td>
                <td className="border border-black px-3 py-2 text-right font-mono font-bold">{item.record.inQuantity}</td>
                <td className="border border-black px-3 py-2 text-right font-mono">¥{item.record.inPrice.toFixed(2)}</td>
                <td className="border border-black px-3 py-2 text-right font-mono font-bold">¥{item.record.inAmount.toFixed(2)}</td>
                <td className="border border-black px-3 py-2">{item.record.outHandler || item.record.buyer || "-"}</td>
                <td className="border border-black px-3 py-2">{item.record.outRecipient || item.record.inspector || "-"}</td>
                <td className="border border-black px-3 py-2">{item.record.certification || "-"}</td>
                <td className="border border-black px-3 py-2">{item.record.sensoryProperty || "-"}</td>
                <td className="border border-black px-3 py-2 text-left">{item.record.note || "-"}</td>
              </tr>
            ))
          )}
          
          {/* 入库单合计行 */}
          {dailyInwardItems.length > 0 && (
            <tr className="bg-gray-50">
              <td colSpan={5} className="border border-black px-3 py-2.5 font-bold text-center">合计金额 (大写)：{new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(dailyInTotalAmount)}</td>
              <td colSpan={1} className="border border-black px-3 py-2.5 font-bold text-right">小写合计:</td>
              <td className="border border-black px-3 py-2.5 text-right font-mono font-black text-sm text-red-600">
                ¥{dailyInTotalAmount.toFixed(2)}
              </td>
              <td colSpan={5} className="border border-black px-3 py-2"></td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 入库单签章栏 */}
      <div className="grid grid-cols-3 gap-4 text-xs mt-12 px-2">
        <div><span>主管审核签字：____________________</span></div>
        <div className="text-center"><span>出库发料人签字：____________________</span></div>
        <div className="text-right"><span>接收领料人签字：____________________</span></div>
      </div>
    </>
  );
}

/**
 * @description 新版出库单打印模板内容组件（按图片样式：按品类合并行展示）
 */
function PrintOutDoc({
  activeLedger,
  selectedDate,
  dailyOutwardItems
}: {
  activeLedger: Ledger | null;
  selectedDate: string;
  dailyOutwardItems: any[];
}) {
  const yearStr = selectedDate.split("-")[0];

  /**
   * @description 按食品大类对出库条目进行分组，并匹配对应的品类中文标签
   */
  const groupedByCategory: Array<{
    categoryLabel: string;
    items: Array<{ item: any; rowIndex: number }>;
  }> = [];

  // 统计每个 category 的所有原料条目
  const categoryMap = new Map<string, any[]>();
  dailyOutwardItems.forEach(item => {
    const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
    const catKey = dictItem?.category ?? "其他";
    if (!categoryMap.has(catKey)) {
      categoryMap.set(catKey, []);
    }
    categoryMap.get(catKey)!.push(item);
  });

  let globalIndex = 1;
  // 按照 FoodCategory 枚举顺序排列输出，保证类别顺序稳定
  const categoryOrder = [
    FoodCategory.VEGETABLE,
    FoodCategory.GRAIN_OIL,
    FoodCategory.SEASONING,
    FoodCategory.MEAT,
    FoodCategory.LOW_CONSUMP,
    FoodCategory.FRUIT
  ];

  categoryOrder.forEach(catKey => {
    const items = categoryMap.get(catKey);
    if (items && items.length > 0) {
      groupedByCategory.push({
        categoryLabel: FOOD_CATEGORY_LABELS[catKey as FoodCategory] ?? catKey,
        items: items.map(item => ({ item, rowIndex: globalIndex++ }))
      });
    }
  });

  // 还有不在枚举里的分类（兜底）
  categoryMap.forEach((items, catKey) => {
    if (!categoryOrder.includes(catKey as FoodCategory)) {
      groupedByCategory.push({
        categoryLabel: String(catKey),
        items: items.map(item => ({ item, rowIndex: globalIndex++ }))
      });
    }
  });

  // 填充空行至 minPrintRows
  const totalDataRows = globalIndex - 1;
  const emptyRowsCount = Math.max(0, LEDGER_PRINT_OUT_CONFIG.minPrintRows - totalDataRows);

  return (
    <>
      {/* 出库单标题行（模仿图片中带绿色边框的单行标题） */}
      <table
        className="w-full border-collapse border-2 text-sm mb-0"
        style={{ borderColor: "#2a7d2e", tableLayout: "fixed" }}
      >
        <tbody>
          <tr>
            <td
              className="py-2 px-4 font-black text-base text-center"
              style={{ width: "50%" }}
            >
              {LEDGER_PRINT_OUT_CONFIG.outDocTitle}（{activeLedger?.name}）
            </td>
            <td
              className="py-2 px-4 font-bold text-sm"
              style={{ width: "50%" }}
            >
              {yearStr}年&emsp;月&emsp;日
            </td>
          </tr>
        </tbody>
      </table>

      {/* 出库明细主表格 */}
      <table
        className="w-full border-collapse border border-black text-xs"
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "9%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "24%" }} />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 text-center font-bold" style={{ height: "28px" }}>
            <th className="border border-black px-1">类别</th>
            <th className="border border-black px-1">序号</th>
            <th className="border border-black px-1">品名</th>
            <th className="border border-black px-1">数量</th>
            <th className="border border-black px-1">出库人</th>
            <th className="border border-black px-1">接收人</th>
          </tr>
        </thead>
        <tbody>
          {groupedByCategory.length === 0 ? (
            /* 当日无出库数据时只展示空白行 */
            Array.from({ length: LEDGER_PRINT_OUT_CONFIG.minPrintRows }).map((_, i) => (
              <tr key={`empty-all-${i}`} style={{ height: "26px" }}>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
              </tr>
            ))
          ) : (
            <>
              {/* 按品类分组渲染，类别格做 rowSpan 合并 */}
              {groupedByCategory.map((group) => (
                group.items.map(({ item, rowIndex }, idx) => {
                  const isFirstInGroup = idx === 0;
                  const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                  const displayName = dictItem?.name ?? item.name;
                  const displayUnit = dictItem?.unit ?? item.unit;
                  return (
                    <tr key={item.id} style={{ height: "26px" }} className="text-center">
                      {isFirstInGroup && (
                        <td
                          className="border border-black font-bold text-[11px]"
                          rowSpan={group.items.length}
                          style={{ verticalAlign: "middle" }}
                        >
                          {group.categoryLabel}
                        </td>
                      )}
                      <td className="border border-black font-mono text-[11px]">{rowIndex}</td>
                      <td className="border border-black text-left px-1 text-[11px]">
                        {displayName}（{displayUnit}）
                      </td>
                      <td className="border border-black font-mono font-bold text-[11px]">
                        {item.record.outQuantity || ""}
                      </td>
                      <td className="border border-black text-[11px]">
                        {item.record.outHandler || ""}
                      </td>
                      <td className="border border-black text-[11px]">
                        {item.record.outRecipient || ""}
                      </td>
                    </tr>
                  );
                })
              ))}

              {/* 补充空行至最小行数 */}
              {Array.from({ length: emptyRowsCount }).map((_, i) => (
                <tr key={`empty-${i}`} style={{ height: "26px" }}>
                  <td className="border border-black"></td>
                  <td className="border border-black"></td>
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

      {/* 底部供货商信息（与图片一致，在表格外独立显示） */}
      <div className="mt-2 text-[11px] text-black leading-6">
        {LEDGER_PRINT_OUT_CONFIG.suppliers.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </>
  );
}

/**
 * @description 当日入库单/出库单物理凭证的纯净打印模板组件
 * （出库单采用新版按类别合并行样式；入库单保持原有样式）
 */
export function LedgerPrintDoc({
  printDocType,
  activeLedger,
  selectedDate,
  dailyInwardItems,
  dailyOutwardItems,
  dailyInTotalAmount,
  onClose
}: LedgerPrintDocProps) {
  const isPrintIn = printDocType === "in";

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-auto p-8 font-sans text-black leading-relaxed">
      {/* 顶部退出预览条（打印时自动隐藏） */}
      <div className="mb-6 flex justify-between items-center border-b border-gray-200 pb-4 print:hidden">
        <span className="text-sm text-gray-500 flex items-center gap-1.5">
          <AlertCircle size={16} />
          温馨提示：下方为打印纸质效果预览，请按 Ctrl + P / Cmd + P 确认打印。
        </span>
        <button
          onClick={onClose}
          className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded cursor-pointer transition-all"
        >
          返回台账主页
        </button>
      </div>

      {/* 根据类型渲染不同模板 */}
      {isPrintIn ? (
        <PrintInDoc
          activeLedger={activeLedger}
          selectedDate={selectedDate}
          dailyInwardItems={dailyInwardItems}
          dailyInTotalAmount={dailyInTotalAmount}
        />
      ) : (
        <PrintOutDoc
          activeLedger={activeLedger}
          selectedDate={selectedDate}
          dailyOutwardItems={dailyOutwardItems}
        />
      )}
    </div>
  );
}
