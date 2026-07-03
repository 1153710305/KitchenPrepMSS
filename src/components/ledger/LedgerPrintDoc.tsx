/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账出入库凭证单的纯净打印模板组件：按食品行业规范排版出库登记表，供物理打印或导出留档使用。
 */

import { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { AlertCircle } from "lucide-react";
import { FOOD_CATEGORY_LABELS } from "../../constants/constants.ts";
import { FoodCategory } from "../../types/types.ts";
import { LEDGER_PRINT_OUT_CONFIG } from "../../constants/ledgerConstants.ts";

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

  // ==== 日期解析：自动填入完整年月日 ====
  const dateParts = selectedDate.split("-");
  const printYear = dateParts[0] || "";
  /** 去掉前缀零的月份，如 "06" → "6" */
  const printMonth = dateParts[1] ? String(parseInt(dateParts[1])) : "";
  /** 去掉前缀零的日期，如 "01" → "1" */
  const printDay = dateParts[2] ? String(parseInt(dateParts[2])) : "";

  // ==== 动态供货商提取：将每个出库条目对应的供货商按名称分组，并汇总每个供货商负责的二级品类 ====
  /**
   * @description supplierToCategoriesMap: key=供货商名称, value=该供货商对应的所有出库原料所属二级品类标签列表
   */
  const supplierToCategoriesMap = new Map<string, string[]>();

  dailyOutwardItems.forEach(item => {
    // 仅读取当日出库记录中的供货商字段，不回落扫描历史记录
    const supplier: string = item.record.supplier || "";

    // 没有供货商信息的条目跳过
    if (!supplier) return;

    // 只展示原料所属的二级品类，不展示具体原料名称
    const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
    if (!dictItem) return;
    const catLabel = FOOD_CATEGORY_LABELS[dictItem.category] ?? dictItem.category;

    if (!supplierToCategoriesMap.has(supplier)) {
      supplierToCategoriesMap.set(supplier, []);
    }
    const existingCategories = supplierToCategoriesMap.get(supplier)!;
    if (!existingCategories.includes(catLabel)) {
      existingCategories.push(catLabel);
    }
  });

  /**
   * @description 将供货商映射表转换为打印行文本数组
   * 格式： 供货商：【供货商名称】（二级品类1、二级品类2…）
   */
  const dynamicSupplierLines: string[] = [];
  supplierToCategoriesMap.forEach((catLabels, supplierName) => {
    dynamicSupplierLines.push(`供货商：${supplierName}（${catLabels.join("、")}）`);
  });

  return (
    <div style={{ fontFamily: LEDGER_PRINT_OUT_CONFIG.outDocFontFamily, fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize, color: "#000" }}>
      {/* 出库单标题和日期行（无黑色边框，独立结构） */}
      <table className="w-full border-collapse mb-2" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td
              className="py-2 px-0 text-center relative"
              style={{ border: "none" }}
            >
              <div>
                <span style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocTitleFontSize, fontWeight: "bold" }}>
                  {LEDGER_PRINT_OUT_CONFIG.outDocTitle}
                </span>
                <span style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocSubTitleFontSize, fontWeight: "bold" }}>
                  （{activeLedger?.name}）
                </span>
              </div>
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: "2px",
                  fontSize: LEDGER_PRINT_OUT_CONFIG.outDocSubTitleFontSize,
                  fontWeight: "bold"
                }}
              >
                {printYear}年{printMonth}月{printDay}日
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* 出库明细主表格：类别3字宽、品名6字宽，出库人/接收人两列相应加宽，腾出的空间从其余列按比例收窄换得 */}
      <table
        className="w-full border-collapse border border-black"
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "9%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "33%" }} />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 text-center font-bold" style={{ height: "28px", fontSize: LEDGER_PRINT_OUT_CONFIG.outDocHeaderFontSize }}>
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
            /* 当日无出库数据时只展示空白行，空行也按品类合并 */
            Array.from({ length: LEDGER_PRINT_OUT_CONFIG.minPrintRows }).map((_, i) => (
              <tr key={`empty-all-${i}`} style={{ height: LEDGER_PRINT_OUT_CONFIG.outDocDataRowHeight, fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }} className="text-center">
                {i === 0 ? (
                  <>
                    <td className="border border-black" rowSpan={LEDGER_PRINT_OUT_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black"></td>
                    <td className="border border-black"></td>
                    <td className="border border-black"></td>
                    <td className="border border-black" rowSpan={LEDGER_PRINT_OUT_CONFIG.minPrintRows}>-</td>
                    <td className="border border-black" rowSpan={LEDGER_PRINT_OUT_CONFIG.minPrintRows}>-</td>
                  </>
                ) : (
                  <>
                    <td className="border border-black"></td>
                    <td className="border border-black"></td>
                    <td className="border border-black"></td>
                  </>
                )}
              </tr>
            ))
          ) : (
            <>
              {/* 按品类分组渲染，类别格、出库人、接收人做 rowSpan 合并 */}
              {groupedByCategory.map((group) => {
                // 提前计算该品类分组内所有出库条目的出库人（去重）和接收人（去重）
                const handlers = Array.from(
                  new Set(
                    group.items
                      .map(({ item }) => item.record.outHandler || "")
                      .filter(Boolean)
                  )
                ).join("、") || "-";

                const recipients = Array.from(
                  new Set(
                    group.items
                      .map(({ item }) => item.record.outRecipient || "")
                      .filter(Boolean)
                  )
                ).join("、") || "-";

                return group.items.map(({ item, rowIndex }, idx) => {
                  const isFirstInGroup = idx === 0;
                  const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                  const displayName = dictItem?.name ?? item.name;
                  const displayUnit = dictItem?.unit ?? item.unit;

                  /**
                   * @description 判断当前原料是否设置了有效的换算单位与换算比例
                   */
                  const hasConversion = !!(dictItem && dictItem.conversionUnit && dictItem.conversionRatio);
                  /** 优先展示换算单位，若无则展示普通单位 */
                  const displayPrintUnit = hasConversion ? dictItem.conversionUnit : displayUnit;
                  /** 优先展示换算计算后的数量，若无则展示普通出库数量 */
                  const displayPrintQty = (hasConversion && item.record.outQuantity)
                    ? Number((item.record.outQuantity * dictItem.conversionRatio).toFixed(2))
                    : (item.record.outQuantity || "");

                  return (
                    <tr key={item.id} style={{ height: LEDGER_PRINT_OUT_CONFIG.outDocDataRowHeight }} className="text-center">
                      {isFirstInGroup && (
                        <td
                          className="border border-black font-bold"
                          rowSpan={group.items.length}
                          style={{ verticalAlign: "middle", fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}
                        >
                          {group.categoryLabel}
                        </td>
                      )}
                      <td className="border border-black font-mono" style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>{rowIndex}</td>
                      <td className="border border-black text-center px-1" style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>
                        {displayName}（{displayPrintUnit}）
                      </td>
                      <td className="border border-black font-mono font-bold" style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>
                        {displayPrintQty}
                      </td>
                      {isFirstInGroup && (
                        <td
                          className="border border-black font-bold"
                          rowSpan={group.items.length}
                          style={{ verticalAlign: "middle", fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}
                        >
                          {handlers}
                        </td>
                      )}
                      {isFirstInGroup && (
                        <td
                          className="border border-black font-bold"
                          rowSpan={group.items.length}
                          style={{ verticalAlign: "middle", fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}
                        >
                          {recipients}
                        </td>
                      )}
                    </tr>
                  );
                });
              })}

              {/* 补充空行至最小行数 */}
              {Array.from({ length: emptyRowsCount }).map((_, i) => (
                <tr key={`empty-${i}`} style={{ height: LEDGER_PRINT_OUT_CONFIG.outDocDataRowHeight, fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>
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

      {/* 底部供货商信息：动态提取当日实际出库记录里的真实供货商，按供货商分组列出其对应二级品类（不展示具体原料名称） */}
      <div className="mt-2 text-black leading-6" style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>
        {dynamicSupplierLines.length > 0 ? (
          dynamicSupplierLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))
        ) : (
          // 当出库记录均无供货商信息时展示占位提示
          LEDGER_PRINT_OUT_CONFIG.suppliers.map((line, i) => (
            <div key={i} className="text-gray-400">{line}（请在出库记录中填写对应供货商）</div>
          ))
        )}
      </div>
    </div>
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
