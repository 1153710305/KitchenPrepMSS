/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐采购细表的编排层组件：按选定二级大类过滤并与台账入库数据对齐生成明细行，提供搜索、CSV 导出、主题切换、"合计汇总"视图，并根据 viewMode 渲染 EXCEL 日历总矩阵（TableGridMatrixView）或单日聚焦卡片（TableGridFocusView）子组件。
 */

import React, { useState, useMemo, useRef } from "react";
import { FoodCategory, PreparedItem, TargetGroup, GroupMonthlyReport, DynamicGroup, DynamicCategory } from "../../types/types.ts";
import { PrepReportService } from "../../services/store.ts";
import { FOOD_CATEGORY_LABELS, UI_TEXT } from "../../constants/constants.ts";
import { getDaysInMonth, LogBroker, matchPinyin, convertItemsToCsv } from "../../utils.ts";
import { Grid, Search, CalendarDays, Check, Flame, Download, TrendingUp } from "lucide-react";
import { SearchableSelect } from "../shared/SearchableSelect.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { LedgerService } from "../../services/ledgerStore.ts";
import { useTableTheme } from "../../hooks/useTableTheme.ts";
import { TableGridMatrixView } from "./TableGridMatrixView.tsx";
import { TableGridFocusView } from "./TableGridFocusView.tsx";
import { MonthlySpendingChart } from "./MonthlySpendingChart.tsx";

/**
 * @description 备餐网格组件的输入参数协议
 */
interface TableGridProps {
  /** 当前选定聚焦的餐类人群报告 */
  report: GroupMonthlyReport;
  /** 当前激活的食材二级分类 (VEGETABLE | GRAIN_OIL... ；合计子表用 null 表示) */
  selectedCategory: FoodCategory | null;
  /** 当发生单元格数字修改时的全局联动回调 */
  onCellUpdate: (itemId: string, day: string, quantity: number, price: number) => void;
  /** 新增食材明细时的操作回调 */
  onAddItem: (targetGroup: TargetGroup, category: FoodCategory, name: string, unit: string) => void;
  /** 删除特定食材行的操作回调 */
  onDeleteItem: (itemId: string) => void;
  /** 是否为管理员模式 */
  isAdminMode: boolean;
  /** 激活的一级受众人群列表 */
  activeGroupsList: DynamicGroup[];
  /** 激活的二级食材分类列表 */
  activeCategoriesList: DynamicCategory[];
  /** 是否为只读模式（餐位分组页面下禁用增删改操作时传 true） */
  readOnly?: boolean;
}

/**
 * @description 多功能食堂电子备料表格与汇总合计组件
 */
export const TableGrid: React.FC<TableGridProps> = ({
  report,
  selectedCategory,
  onCellUpdate,
  onAddItem,
  onDeleteItem,
  isAdminMode,
  activeGroupsList,
  activeCategoriesList,
  readOnly = false
}) => {
  // 1. 核心视图布局模式切换：MATRIX (大宽表Excel矩阵) | FOCUS (单日卡片聚焦)
  const [viewMode, setViewMode] = useState<"MATRIX" | "FOCUS">("MATRIX");

  // 主题样式管理，统一由 useTableTheme 提供
  const { theme, activeTheme, handleThemeChange } = useTableTheme();

  // 聚焦日的索引状态，默认聚焦 1 号
  const [focusDay, setFocusDay] = useState<string>("1");

  // 当前受众+当前品类的当月采购花销趋势图显示开关，默认隐藏，由用户手动点击按钮展开
  const [showSpendingChart, setShowSpendingChart] = useState<boolean>(false);

  // 食材搜索关键字
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 新条目新增窗控制
  const [newItemName, setNewItemName] = useState<string>("");
  const [newItemUnit, setNewItemUnit] = useState<string>("斤");

  /** 根据当前所选二级大品类，过滤该大类下所有的原料字典选项 */
  const dictOptions = useMemo(() => {
    return RawMaterialsDictService.getItems()
      .filter((item) => !selectedCategory || item.category === selectedCategory)
      .map((item) => ({
        value: item.name,
        label: item.name,
        unit: item.unit,
        category: item.category
      }));
  }, [selectedCategory]);

  // 当月包含的日期数组 (["1", "2", ..., "31"])
  const days = useMemo(() => getDaysInMonth(report.year, report.month), [report.year, report.month]);

  // 1. 过滤与台账每日采购明细无缝对齐：按选定主类和搜索关键字过滤条目，并将 dailyData 数据完全拦截重定向至对应台账采购数量与单价上
  const filteredItems = useMemo(() => {
    // 拉取台账所有原料项目
    const allLedgerItems = LedgerService.getLedgerItems();

    // 找出与当前备餐报表所属客群（targetGroup）相匹配的台账集合
    const groupLedgerItems = allLedgerItems.filter((i) => i.ledgerId === report.targetGroup);

    return groupLedgerItems
      .filter((item) => {
        // 解析该台账原料在字典里的所属品类大类
        const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === item.name);

        // 安全防呆校验：必须确保台账明细原料存在于后台原料字典大底库中，避免后台不存在的品类出现
        if (!dictItem) return false;

        const cat = dictItem.category;
        const matchCat = selectedCategory === null ? true : cat === selectedCategory;
        const matchSearch = matchPinyin(item.name, searchQuery);
        return matchCat && matchSearch;
      })
      .map((item) => {
        // 构造克隆条目，重定向其每日数据为台账当日入库数据
        const alignedDailyData: Record<string, any> = {};

        days.forEach((day) => {
          // 台账的日期索引是 YYYY-MM-DD
          const monthStr = String(report.month).padStart(2, "0");
          const dayStr = String(day).padStart(2, "0");
          const targetDateKey = `${report.year}-${monthStr}-${dayStr}`;

          const ledgerRecord = item.dailyRecords?.[targetDateKey];

          if (ledgerRecord && ledgerRecord.inQuantity > 0) {
            alignedDailyData[day] = {
              quantity: ledgerRecord.inQuantity,
              price: ledgerRecord.inPrice,
              amount: Number((ledgerRecord.inQuantity * ledgerRecord.inPrice).toFixed(2))
            };
          } else {
            // 台账内某日采购无对应记录，则细表中不对应显示任何值，置为 0
            alignedDailyData[day] = { quantity: 0, price: 0, amount: 0 };
          }
        });

        // 返回由台账映射而成的标准备餐明细项
        const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === item.name);
        return {
          id: item.id,
          name: item.name,
          category: dictItem ? dictItem.category : FoodCategory.VEGETABLE,
          targetGroup: report.targetGroup,
          unit: item.unit,
          dailyData: alignedDailyData
        };
      });
  }, [report.targetGroup, report.year, report.month, selectedCategory, searchQuery, days]);

  // 2. 统计计算：每个日期(1-31号)在该类目下的总开销汇总
  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    days.forEach((day) => {
      let sum = 0;
      filteredItems.forEach((item) => {
        sum += item.dailyData[day]?.amount || 0;
      });
      totals[day] = Math.round(sum * 100) / 100;
    });
    return totals;
  }, [filteredItems, days]);

  // 高性能修改跟踪，用于在 input 失去焦点(onBlur)时记录变动日志，避免打字时的实时输入卡顿
  const editTrackerRef = useRef<{
    itemId: string;
    day: string;
    field: "quantity" | "price";
    initialValue: number;
  } | null>(null);

  const getGroupLabel = (groupKey: string) => {
    const g = activeGroupsList.find((g) => g.key === groupKey);
    return g ? g.label : groupKey;
  };

  const getCategoryLabel = (catKey: string) => {
    const c = activeCategoriesList.find((c) => c.key === catKey);
    return c ? c.label : (FOOD_CATEGORY_LABELS[catKey as FoodCategory] || catKey);
  };

  const handleInputFocus = (itemId: string, day: string, field: "quantity" | "price", value: number) => {
    editTrackerRef.current = {
      itemId,
      day,
      field,
      initialValue: value
    };
  };

  const handleInputBlur = (itemId: string, day: string, field: "quantity" | "price", currentValue: number, item: PreparedItem) => {
    const tracker = editTrackerRef.current;
    if (tracker && tracker.itemId === itemId && tracker.day === day && tracker.field === field) {
      if (tracker.initialValue !== currentValue) {
        const operator = isAdminMode ? "系统管理员" : "普通记账员";
        const groupLabel = getGroupLabel(item.targetGroup);
        const catLabel = getCategoryLabel(item.category);
        const dailyEntry = item.dailyData[day] || { quantity: 0, price: 0 };

        // 计算旧的和新的实收金额
        const oldQty = field === "quantity" ? tracker.initialValue : dailyEntry.quantity;
        const oldPrice = field === "price" ? tracker.initialValue : dailyEntry.price;
        const oldAmount = Math.round(oldQty * oldPrice * 100) / 100;

        const newQty = dailyEntry.quantity;
        const newPrice = dailyEntry.price;
        const newAmount = Math.round(newQty * newPrice * 100) / 100;

        const actionType = field === "quantity" ? "数量" : "单价";
        const targetUnitStr = field === "quantity" ? ` ${item.unit}` : "元";

        LogBroker.publish(
          "INFO",
          "TableGrid",
          `【修改备餐${actionType}】操作员 [${operator}] 修改了「${groupLabel}」的 [${catLabel}类]「${item.name}」在 [${day}号] 的${actionType}：从 [${tracker.initialValue}${targetUnitStr}] 变更为 [${currentValue}${targetUnitStr}]，核算金额从 [¥${oldAmount}] 变更为 [¥${newAmount}]。`
        );
      }
    }
    editTrackerRef.current = null;
  };

  /** 
   * @description 触发快速单格输入修改 
   */
  const handleInputChange = (itemId: string, day: string, field: "quantity" | "price", rawValue: string) => {
    const numericValue = parseFloat(rawValue);
    const sanitized = isNaN(numericValue) || numericValue < 0 ? 0 : numericValue;

    // 快速定位当前行和天并渲染
    const targetItem = report.items.find((i) => i.id === itemId);
    if (targetItem) {
      const currentEntry = targetItem.dailyData[day] || { quantity: 0, price: 0, amount: 0 };
      const nextQty = field === "quantity" ? sanitized : currentEntry.quantity;
      const nextPrice = field === "price" ? sanitized : currentEntry.price;
      onCellUpdate(itemId, day, nextQty, nextPrice);
    }
  };

  /**
   * @description 触发新食材录入
   */
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    if (selectedCategory === null) {
      LogBroker.publish("WARN", "TableGrid", "在「合计汇总」面板中无法新增未确定大类的食材项！请至各大类卡片下添加。");
      return;
    }
    onAddItem(report.targetGroup, selectedCategory, newItemName, newItemUnit);
    setNewItemName("");
    setNewItemUnit("斤");
  };

  /**
   * @description 导出当前餐位二级分组在当月的采购明细表
   */
  const handleExportCsv = () => {
    const catLabel = selectedCategory ? (FOOD_CATEGORY_LABELS[selectedCategory] || selectedCategory) : "汇总合计";
    const groupLabel = getGroupLabel(report.targetGroup);

    // 生成 CSV 内容
    const csvString = convertItemsToCsv(filteredItems, days, catLabel);

    // 创建 blob 并下载
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${report.year}年${report.month}月_${groupLabel}_${catLabel}_采购细表.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    LogBroker.publish(
      "INFO",
      "TableGrid",
      `【导出明细】操作员导出了「${groupLabel}」的 [${catLabel}类] 在 ${report.year}年${report.month}月 的采购细表 CSV。`
    );
  };




  // --- 合计汇总报表视图渲染 (当 selectedCategory === null 时触发) ---
  const renderCategoryCombinedSummary = () => {
    // 聚合各大类的总金额
    const categoryRows = PrepReportService.getActiveCategories().map((cat) => {
      let costSum = 0;
      const catItems = report.items.filter((item) => item.category === cat.key as FoodCategory);

      days.forEach((day) => {
        catItems.forEach((item) => {
          costSum += item.dailyData[day]?.amount || 0;
        });
      });

      return {
        key: cat.key,
        label: cat.label,
        amount: Math.round(costSum * 100) / 100
      };
    });

    const grandTotal = categoryRows.reduce((sum, r) => sum + r.amount, 0);

    return (
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs mt-4">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-800 text-xl flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg"><Flame size={18} /></span>
              {UI_TEXT.summaryName}
            </h3>
            <p className="text-[13px] text-gray-400 mt-1">汇聚餐段：{report.year}年{report.month}月 - 统一统筹合计表</p>
          </div>
          <span className="text-[15px] font-semibold text-indigo-700 bg-indigo-50 px-4 py-1.5 rounded-full">
            总预算耗资: ¥{grandTotal.toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categoryRows.map((row) => {
            const pct = grandTotal > 0 ? ((row.amount / grandTotal) * 100).toFixed(1) : "0.0";
            return (
              <div key={row.key} className="p-5 rounded-xl border border-gray-100 bg-gradient-to-tr from-gray-50/30 to-white flex justify-between items-center hover:shadow-xs transition-shadow">
                <div className="space-y-1">
                  <span className="text-[12px] text-gray-400 font-bold uppercase tracking-wider block">食材大类</span>
                  <span className="text-lg font-bold text-gray-800">{row.label}类别</span>
                </div>
                <div className="text-right space-y-1">
                  <span className="text-[12px] text-gray-400 block">月耗开销</span>
                  <span className="text-lg font-extrabold text-sky-600">¥{row.amount.toFixed(2)}</span>
                  <span className="text-[11px] text-gray-400 font-mono block">占比 {pct}%</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 p-4 bg-yellow-50/50 border border-yellow-10 border-dashed rounded-xl flex items-start gap-2 text-[13px] text-yellow-800">
          <Check size={16} className="text-yellow-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>合计表业务说明：</strong>该表自动归集了当前目标受众分类（教师、幼儿、低/高年级）在各分食材（蔬菜、粮油、调料、肉类、低耗品、水果）卡片里的金额输入流。如果您需要增删或微调，请点击对应类目的标签即可下潜编辑。所有的修改都将完美自动向本表累合并瞬间落盘。
          </p>
        </div>
      </div>
    );
  };

  if (selectedCategory === null) {
    return renderCategoryCombinedSummary();
  }

  return (
    <div className="space-y-3">

      {/* 过滤条与功能操作开关 */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
        <div className="flex flex-wrap items-center gap-3">
          {/* 搜索框 */}
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
              <Search size={14} />
            </span>
            <input
              type="text"
              placeholder="快速检索当前页食材..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-4 py-1.5 w-44 bg-white border border-gray-100 rounded-xl text-[13px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all font-sans"
            />
          </div>

          {/* 新增原料采购项下拉框 (只允许从原料大字典已存在的原料中挑选新增，只读模式下隐藏) */}
          {!readOnly && (
            <form onSubmit={handleAddSubmit} className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-xl px-2.5 py-1">
              <span className="text-[11px] text-gray-400 font-bold shrink-0">添加原料:</span>
              <select
                value={newItemName}
                onChange={(e) => {
                  const name = e.target.value;
                  setNewItemName(name);
                  const matched = dictOptions.find(opt => opt.value === name);
                  if (matched) {
                    setNewItemUnit(matched.unit);
                  }
                }}
                className="text-[13px] text-gray-700 bg-transparent outline-none cursor-pointer max-w-[110px]"
                required
              >
                <option value="">-- 选择原料 --</option>
                {dictOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.unit})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!newItemName}
                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-300 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer shrink-0"
              >
                新增
              </button>
            </form>
          )}

          {/* 导出当前客群和二级分组的月度采购细表按钮 */}
          <button
            onClick={handleExportCsv}
            type="button"
            className={`flex items-center gap-1.5 px-3 py-1.5 ${activeTheme.lightBg} border ${activeTheme.primaryText.replace("text-", "border-").replace("-700", "-200")} ${activeTheme.primaryText} text-[13px] font-bold rounded-xl transition-all cursor-pointer`}
            title="导出当前餐位二级大类当月所有的每日采购明细表 (CSV)"
          >
            <Download size={13} />
            <span>导出本月细表 (CSV)</span>
          </button>

          {/* 当前受众+当前品类的当月采购花销趋势图显示开关，默认隐藏 */}
          <button
            onClick={() => setShowSpendingChart((v) => !v)}
            type="button"
            className={`flex items-center gap-1.5 px-3 py-1.5 border text-[13px] font-bold rounded-xl transition-all cursor-pointer ${showSpendingChart
              ? `${activeTheme.lightBg} ${activeTheme.primaryText} ${activeTheme.primaryText.replace("text-", "border-").replace("-700", "-200").replace("-900", "-200")}`
              : "bg-white border-gray-100 text-gray-500 hover:text-gray-800"
              }`}
            title="展示/隐藏当前受众与品类的本月每日采购花销趋势图"
          >
            <TrendingUp size={13} />
            <span>{showSpendingChart ? "隐藏花销趋势图" : "本月花销趋势图"}</span>
          </button>

          {/* 细表主题样式选择器 */}
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-1.5 text-[13px] select-none">
            <span className="text-[11px] text-gray-400 font-bold shrink-0">表格主题:</span>
            <div className="flex gap-1.5">
              <button
                type="button" onClick={() => handleThemeChange("sky")}
                className={`w-3.5 h-3.5 rounded-full bg-sky-500 cursor-pointer border-2 transition-all hover:scale-110 ${theme === "sky" ? "border-slate-800 scale-105 shadow-xs" : "border-transparent"}`}
                title="天空蓝主题"
              />
              <button
                type="button" onClick={() => handleThemeChange("emerald")}
                className={`w-3.5 h-3.5 rounded-full bg-emerald-500 cursor-pointer border-2 transition-all hover:scale-110 ${theme === "emerald" ? "border-slate-800 scale-105 shadow-xs" : "border-transparent"}`}
                title="翡翠绿主题"
              />
              <button
                type="button" onClick={() => handleThemeChange("purple")}
                className={`w-3.5 h-3.5 rounded-full bg-violet-500 cursor-pointer border-2 transition-all hover:scale-110 ${theme === "purple" ? "border-slate-800 scale-105 shadow-xs" : "border-transparent"}`}
                title="丁香紫主题"
              />
              <button
                type="button" onClick={() => handleThemeChange("charcoal")}
                className={`w-3.5 h-3.5 rounded-full bg-slate-600 cursor-pointer border-2 transition-all hover:scale-110 ${theme === "charcoal" ? "border-slate-800 scale-105 shadow-xs" : "border-transparent"}`}
                title="典雅暗灰主题"
              />
            </div>
          </div>

        </div>

        <div className="flex rounded-md bg-white p-1 border border-gray-100 text-[13px] shadow-xs">
          <button
            onClick={() => setViewMode("MATRIX")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer font-medium ${viewMode === "MATRIX" ? activeTheme.btnActive : "text-gray-500 hover:text-gray-900"
              }`}
          >
            <Grid size={13} />
            <span>EXCEL 日历总矩阵</span>
          </button>
          <button
            onClick={() => setViewMode("FOCUS")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer font-medium ${viewMode === "FOCUS" ? activeTheme.btnActive : "text-gray-500 hover:text-gray-900"
              }`}
          >
            <CalendarDays size={13} />
            <span>单日聚焦卡片 (推荐)</span>
          </button>
        </div>
      </div>

      {/* 当前受众+当前品类的当月采购花销趋势图，默认隐藏，点击上方按钮展开 */}
      {showSpendingChart && (
        <MonthlySpendingChart
          days={days}
          dayTotals={dayTotals}
          groupLabel={getGroupLabel(report.targetGroup)}
          categoryLabel={getCategoryLabel(selectedCategory)}
          activeTheme={activeTheme}
        />
      )}

      {filteredItems.length === 0 ? (
        <div className="py-16 text-center bg-white border border-gray-100/50 rounded-2xl text-gray-400 text-[13px] italic">
          {UI_TEXT.noDataMessage}
        </div>
      ) : (
        <>
          {/* ================ (1) 大宽表日历矩阵 ================ */}
          {viewMode === "MATRIX" && (
            <TableGridMatrixView
              days={days}
              filteredItems={filteredItems}
              dayTotals={dayTotals}
              activeTheme={activeTheme}
              selectedCategory={selectedCategory}
              readOnly={readOnly}
              onDeleteItem={onDeleteItem}
            />
          )}

          {/* ================ (2) 单日聚焦卡片 ================ */}
          {viewMode === "FOCUS" && (
            <TableGridFocusView
              days={days}
              filteredItems={filteredItems}
              dayTotals={dayTotals}
              activeTheme={activeTheme}
              focusDay={focusDay}
              setFocusDay={setFocusDay}
              readOnly={readOnly}
              onDeleteItem={onDeleteItem}
            />
          )}
        </>
      )}

    </div>
  );
};
