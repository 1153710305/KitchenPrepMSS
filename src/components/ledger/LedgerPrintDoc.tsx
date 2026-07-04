/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账出入库凭证单的纯净打印模板组件：按食品行业规范排版出库登记表，供物理打印或导出留档使用。
 */

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
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
 * @description 按每页固定行数(rowsPerPage)对品类分组做贪心装箱分页：品类组整体不跨页拆分（组内条目一律移到下一页），
 * 仅当单个品类组自身条目数就超过整页容量时才在组内部拆分并标记续页(continued)——这种极端情况在当前原料字典规模下基本不会触发，
 * 但仍需正确处理避免死循环或数据丢失。
 */
function paginateGroupedItems(
  groups: Array<{ categoryLabel: string; items: Array<{ item: any; rowIndex: number }> }>,
  rowsPerPage: number
): Array<Array<{ categoryLabel: string; items: Array<{ item: any; rowIndex: number }>; continued: boolean }>> {
  const pages: Array<Array<{ categoryLabel: string; items: Array<{ item: any; rowIndex: number }>; continued: boolean }>> = [];
  let currentPage: Array<{ categoryLabel: string; items: Array<{ item: any; rowIndex: number }>; continued: boolean }> = [];
  let currentRows = 0;

  groups.forEach((group) => {
    let remainingItems = group.items;
    let isFirstSlice = true;

    while (remainingItems.length > 0) {
      const spaceLeft = rowsPerPage - currentRows;

      if (remainingItems.length <= spaceLeft) {
        // 当前页容得下整组（或该组尚未渲染的剩余部分）
        currentPage.push({ categoryLabel: group.categoryLabel, items: remainingItems, continued: !isFirstSlice });
        currentRows += remainingItems.length;
        remainingItems = [];
      } else if (currentRows === 0) {
        // 当前页是全新空页，但整组仍放不下一整页——单组行数超过整页容量的兜底分支，此时才允许组内拆分
        const slice = remainingItems.slice(0, rowsPerPage);
        currentPage.push({ categoryLabel: group.categoryLabel, items: slice, continued: !isFirstSlice });
        remainingItems = remainingItems.slice(rowsPerPage);
        pages.push(currentPage);
        currentPage = [];
        currentRows = 0;
        isFirstSlice = false;
      } else {
        // 当前页已有内容且放不下整组剩余部分——整组（不拆分）移到下一页
        pages.push(currentPage);
        currentPage = [];
        currentRows = 0;
      }
    }
  });

  if (currentPage.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  return pages;
}

/**
 * @description 新版出库单打印模板内容组件（按图片样式：按品类合并行展示；[V5.73.0] 支持超出单页容量时自动分页续排）
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

  // ==== 分页：出库单表格每页固定 minPrintRows 行，超出部分按品类整体移到下一页（[V5.73.0]） ====
  const rowsPerPage = LEDGER_PRINT_OUT_CONFIG.minPrintRows;
  const rowPages = groupedByCategory.length > 0 ? paginateGroupedItems(groupedByCategory, rowsPerPage) : [];

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

  // ==== 供货商信息分页：每页最多 maxSuppliersPerPage 条，超出部分另起续页（[V5.73.0]） ====
  const isPlaceholderSuppliers = dynamicSupplierLines.length === 0;
  const supplierDisplayLines = isPlaceholderSuppliers ? LEDGER_PRINT_OUT_CONFIG.suppliers : dynamicSupplierLines;
  const maxSuppliersPerPage = LEDGER_PRINT_OUT_CONFIG.maxSuppliersPerPage;
  const supplierChunks: string[][] = [];
  for (let i = 0; i < supplierDisplayLines.length; i += maxSuppliersPerPage) {
    supplierChunks.push(supplierDisplayLines.slice(i, i + maxSuppliersPerPage));
  }
  if (supplierChunks.length === 0) supplierChunks.push([]);
  const firstSupplierChunk = supplierChunks[0];
  const extraSupplierChunks = supplierChunks.slice(1);

  // 总页数：行数据表页数（当日无数据时仍固定展示 1 页空表）+ 供货商续页数
  const totalPages = Math.max(rowPages.length, 1) + extraSupplierChunks.length;

  /**
   * @description 渲染每一页顶部重复的标题+日期栏；总页数大于 1 时额外展示"第 N / 共 M 页"，供货商续页额外标注
   */
  const renderTitleBlock = (pageIndex: number, isSupplierContinuationPage: boolean) => (
    <table className="w-full border-collapse mb-2" style={{ tableLayout: "fixed" }}>
      <tbody>
        <tr>
          <td className="py-2 px-0 text-center relative" style={{ border: "none" }}>
            <div>
              <span style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocTitleFontSize, fontWeight: "bold" }}>
                {LEDGER_PRINT_OUT_CONFIG.outDocTitle}
              </span>
              <span style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocSubTitleFontSize, fontWeight: "bold" }}>
                （{activeLedger?.name}{isSupplierContinuationPage ? "·供货商续页" : ""}）
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
            {totalPages > 1 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: "2px",
                  fontSize: LEDGER_PRINT_OUT_CONFIG.outDocSubTitleFontSize,
                  fontWeight: "normal",
                  color: "#444"
                }}
              >
                第 {pageIndex + 1} / {totalPages} 页
              </div>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );

  /**
   * @description 渲染底部供货商信息栏；无真实供货商数据时展示灰色占位提示文案（保持原有行为不变）
   */
  const renderSupplierFooter = (lines: string[]) => (
    <div className="mt-2 text-black leading-6" style={{ fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>
      {lines.map((line, i) => (
        <div key={i} className={isPlaceholderSuppliers ? "text-gray-400" : undefined}>
          {isPlaceholderSuppliers ? `${line}（请在出库记录中填写对应供货商）` : line}
        </div>
      ))}
    </div>
  );

  /**
   * @description 每页内容外层容器：除首页外，打印时强制插入分页符另起一页（page-break，含新旧两种 CSS 属性兜底浏览器兼容性）；
   * 屏幕预览（非打印态）下额外展示浅色分页提示，方便操作员在打印前确认断页位置
   */
  const renderPageWrapper = (pageIndex: number, children: ReactNode) => (
    <div
      key={`print-page-${pageIndex}`}
      style={{
        breakBefore: pageIndex === 0 ? "auto" : "page",
        pageBreakBefore: pageIndex === 0 ? "auto" : "always"
      }}
    >
      {pageIndex > 0 && (
        <div className="print:hidden text-center text-[11px] text-gray-400 my-3 select-none">
          －－－ 以下另起第 {pageIndex + 1} 页打印 －－－
        </div>
      )}
      {children}
    </div>
  );

  /** 主表格固定列宽 colgroup + 表头，各页共用，避免重复书写导致后续调整列宽时遗漏某一页 */
  const renderTableHead = () => (
    <>
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
    </>
  );

  return (
    <div style={{ fontFamily: LEDGER_PRINT_OUT_CONFIG.outDocFontFamily, fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize, color: "#000" }}>
      {/* 线框颜色/粗细通过下方 <style> 强制统一为纯黑细线，避免打印时因子像素反锯齿呈现偏蓝色调、粗细不一，与图一/图二打印样式保持一致；
          同时声明 A4 纸张与页边距，配合各页容器的强制分页符，保证内容行数/供货商条数超出单页容量时完整续排到下一页，不再被物理纸张边缘截断 */}
      <style>{`
        .ledger-print-out-table, .ledger-print-out-table th, .ledger-print-out-table td {
          border: 1px solid #000000 !important;
        }
        @page {
          size: A4;
          margin: 12mm;
        }
        @media print {
          .ledger-print-out-table, .ledger-print-out-table th, .ledger-print-out-table td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            border-color: #000000 !important;
          }
        }
      `}</style>

      {rowPages.length === 0 ? (
        // 当日无任何出库数据：保持原有单页空表展示（不涉及分页），仅在末尾追加供货商信息栏
        renderPageWrapper(0, (
          <>
            {renderTitleBlock(0, extraSupplierChunks.length > 0)}
            <table className="ledger-print-out-table w-full border-collapse" style={{ tableLayout: "fixed" }}>
              {renderTableHead()}
              <tbody>
                {Array.from({ length: rowsPerPage }).map((_, i) => (
                  <tr key={`empty-all-${i}`} style={{ height: LEDGER_PRINT_OUT_CONFIG.outDocDataRowHeight, fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }} className="text-center">
                    {i === 0 ? (
                      <>
                        <td className="border border-black" rowSpan={rowsPerPage}>-</td>
                        <td className="border border-black"></td>
                        <td className="border border-black"></td>
                        <td className="border border-black"></td>
                        <td className="border border-black" rowSpan={rowsPerPage}>-</td>
                        <td className="border border-black" rowSpan={rowsPerPage}>-</td>
                      </>
                    ) : (
                      <>
                        <td className="border border-black"></td>
                        <td className="border border-black"></td>
                        <td className="border border-black"></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {renderSupplierFooter(firstSupplierChunk)}
          </>
        ))
      ) : (
        rowPages.map((pageGroups, pageIndex) => {
          const rowsUsedOnThisPage = pageGroups.reduce((sum, g) => sum + g.items.length, 0);
          const pageEmptyRowsCount = Math.max(0, rowsPerPage - rowsUsedOnThisPage);
          const isLastRowPage = pageIndex === rowPages.length - 1;

          return renderPageWrapper(pageIndex, (
            <>
              {renderTitleBlock(pageIndex, false)}
              <table className="ledger-print-out-table w-full border-collapse" style={{ tableLayout: "fixed" }}>
                {renderTableHead()}
                <tbody>
                  {/* 按品类分组渲染，类别格、出库人、接收人做 rowSpan 合并（合并范围限定在当前页内这一组的切片行数，不跨页） */}
                  {pageGroups.map((group, groupIdx) => {
                    // 提前计算该品类分组切片内所有出库条目的出库人（去重）和接收人（去重）
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
                        <tr key={`${item.id}-p${pageIndex}g${groupIdx}`} style={{ height: LEDGER_PRINT_OUT_CONFIG.outDocDataRowHeight }} className="text-center">
                          {isFirstInGroup && (
                            <td
                              className="border border-black font-bold"
                              rowSpan={group.items.length}
                              style={{ verticalAlign: "middle", fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}
                            >
                              {group.categoryLabel}{group.continued ? "（续）" : ""}
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

                  {/* 补充空行至本页固定行数 */}
                  {Array.from({ length: pageEmptyRowsCount }).map((_, i) => (
                    <tr key={`empty-${pageIndex}-${i}`} style={{ height: LEDGER_PRINT_OUT_CONFIG.outDocDataRowHeight, fontSize: LEDGER_PRINT_OUT_CONFIG.outDocDataFontSize }}>
                      <td className="border border-black"></td>
                      <td className="border border-black"></td>
                      <td className="border border-black"></td>
                      <td className="border border-black"></td>
                      <td className="border border-black"></td>
                      <td className="border border-black"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {isLastRowPage && renderSupplierFooter(firstSupplierChunk)}
            </>
          ));
        })
      )}

      {/* 供货商信息超过每页上限时的续页：仅展示标题与剩余供货商信息，不重复行数据表格 */}
      {extraSupplierChunks.map((chunk, chunkIdx) => {
        const pageIndex = Math.max(rowPages.length, 1) + chunkIdx;
        return renderPageWrapper(pageIndex, (
          <>
            {renderTitleBlock(pageIndex, true)}
            {renderSupplierFooter(chunk)}
          </>
        ));
      })}
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

  // 修复分页打印失效问题（根因分两层，缺一不可）：
  // 1) 本组件原先直接嵌在 App 主界面的 DOM 树里（#root 内部），外层还套着好几层 h-screen/overflow-hidden 的布局容器；
  //    这些祖先容器平时不影响它——因为它自身是 position:fixed，视觉上能"跳出"祖先的裁剪覆盖满全屏——但打印引擎在决定
  //    分页范围时，仍然只按它在文档流里"物理所处的那个位置与可用高度"来处理，祖先的 overflow:hidden/固定高度依旧会把
  //    它限制在一屏之内，导致哪怕内部分页符正确，也只有第一页能被打印引擎"看见"。
  // 2) 即使解决了祖先裁剪问题，本容器自身平时也用 position:fixed + overflow:auto 让预览区域能在屏幕上独立滚动——这类
  //    "定高可滚动"容器在打印时同样会被引擎当成一个固定尺寸的单页画框，内部超出可视高度的部分直接被丢弃。
  // 解决方式：用 createPortal 把整个打印预览挂到 document.body 下（彻底跳出 #root 及其所有 overflow-hidden 祖先），
  // 再配合 @media print 规则：打印时把 #root（承载头部导航栏等其余界面）整体隐藏，避免其内容穿透进打印输出；
  // 同时把这个 portal 容器自身在打印时强制退回普通文档流（position:static + overflow:visible + 高度自适应），
  // 使其随多页内容自然撑高，分页符才能在真实的分页布局里生效，多页内容才能完整续排打印。
  return createPortal(
    <div className="ledger-print-doc-overlay fixed inset-0 bg-white z-[9999] overflow-auto p-8 font-sans text-black leading-relaxed">
      <style>{`
        @media print {
          #root {
            display: none !important;
          }
          .ledger-print-doc-overlay {
            position: static !important;
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
        }
      `}</style>
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
    </div>,
    document.body
  );
}
