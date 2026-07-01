/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from "react";
import { FoodCategory, PreparedItem, TargetGroup, GroupMonthlyReport, DynamicGroup, DynamicCategory } from "../types.ts";
import { PrepReportService } from "../store.ts";
import { FOOD_CATEGORY_LABELS, TARGET_GROUP_LABELS, UI_TEXT } from "../constants.ts";
import { getDaysInMonth, getItemMonthlySummary, LogBroker, matchPinyin, convertItemsToCsv } from "../utils.ts";
import { Plus, Trash, Copy, SlidersHorizontal, Grid, Search, CalendarDays, Check, Flame, Download } from "lucide-react";
import { SearchableSelect } from "./SearchableSelect.tsx";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { LedgerService } from "../ledgerStore.ts";

/**
 * @description 备菜网格组件的输入参数协议
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
 * @description 二级分组采购细表的主题样式属性定义
 */
interface ThemeStyle {
  primaryBg: string;      // 主题主背景（如 bg-sky-500）
  primaryText: string;    // 主题主文字颜色（如 text-sky-700）
  lightBg: string;        // 主题浅色背景（如 bg-sky-50/50）
  borderHover: string;    // 卡片悬停边框颜色（如 hover:border-sky-300）
  badgeClass: string;     // 日历天数等徽章背景（如 bg-sky-500 text-white）
  accentText: string;     // 金额等高亮强调文字颜色（如 text-sky-800）
  accentBg: string;       // 合计等高亮强调背景颜色（如 bg-sky-100/50）
  btnActive: string;      // 激活态按钮背景类名
}

/**
 * @description 预设精美的四套细表主题样式映射表
 */
const THEME_MAP: Record<string, ThemeStyle> = {
  sky: {
    primaryBg: "bg-sky-600",
    primaryText: "text-sky-900",
    lightBg: "bg-sky-100/60",
    borderHover: "hover:border-sky-400",
    badgeClass: "bg-sky-600 text-white shadow-sky-50",
    accentText: "text-sky-950 font-black",
    accentBg: "bg-sky-200/50",
    btnActive: "bg-sky-600 text-white font-bold"
  },
  emerald: {
    primaryBg: "bg-emerald-600",
    primaryText: "text-emerald-900",
    lightBg: "bg-emerald-100/60",
    borderHover: "hover:border-emerald-400",
    badgeClass: "bg-emerald-600 text-white shadow-emerald-50",
    accentText: "text-emerald-950 font-black",
    accentBg: "bg-emerald-200/50",
    btnActive: "bg-emerald-600 text-white font-bold"
  },
  purple: {
    primaryBg: "bg-violet-600",
    primaryText: "text-violet-900",
    lightBg: "bg-violet-100/60",
    borderHover: "hover:border-violet-400",
    badgeClass: "bg-violet-600 text-white shadow-violet-50",
    accentText: "text-violet-950 font-black",
    accentBg: "bg-violet-200/50",
    btnActive: "bg-violet-600 text-white font-bold"
  },
  charcoal: {
    primaryBg: "bg-slate-700",
    primaryText: "text-slate-900",
    lightBg: "bg-slate-150",
    borderHover: "hover:border-slate-500",
    badgeClass: "bg-slate-700 text-white shadow-slate-50",
    accentText: "text-slate-950 font-black",
    accentBg: "bg-slate-200",
    btnActive: "bg-slate-700 text-white font-bold"
  }
};

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

  // 主题样式管理，默认翡翠绿 "emerald"
  const [theme, setTheme] = useState<"sky" | "emerald" | "purple" | "charcoal">(() => {
    return (localStorage.getItem("prep_table_theme") as any) || "emerald";
  });

  const activeTheme = THEME_MAP[theme] || THEME_MAP.emerald;

  const handleThemeChange = (newTheme: "sky" | "emerald" | "purple" | "charcoal") => {
    setTheme(newTheme);
    localStorage.setItem("prep_table_theme", newTheme);
    LogBroker.publish("INFO", "TableGrid", `用户切换了备餐明细表格的主题样式为：${newTheme === "sky" ? "天空蓝" : newTheme === "emerald" ? "翡翠绿" : newTheme === "purple" ? "丁香紫" : "典雅暗灰"}`);
  };

  // 聚焦日的索引状态，默认聚焦 1 号
  const [focusDay, setFocusDay] = useState<string>("1");

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
    return g ? g.label : (TARGET_GROUP_LABELS[groupKey as TargetGroup] || groupKey);
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
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg"><Flame size={18} /></span>
              {UI_TEXT.summaryName}
            </h3>
            <p className="text-xs text-gray-400 mt-1">汇聚餐段：{report.year}年{report.month}月 - 统一统筹合计表</p>
          </div>
          <span className="text-sm font-semibold text-indigo-700 bg-indigo-50 px-4 py-1.5 rounded-full">
            总预算耗资: ¥{grandTotal.toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categoryRows.map((row) => {
            const pct = grandTotal > 0 ? ((row.amount / grandTotal) * 100).toFixed(1) : "0.0";
            return (
              <div key={row.key} className="p-5 rounded-xl border border-gray-100 bg-gradient-to-tr from-gray-50/30 to-white flex justify-between items-center hover:shadow-xs transition-shadow">
                <div className="space-y-1">
                  <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider block">食材大类</span>
                  <span className="text-base font-bold text-gray-800">{row.label}类别</span>
                </div>
                <div className="text-right space-y-1">
                  <span className="text-[11px] text-gray-400 block">月耗开销</span>
                  <span className="text-base font-extrabold text-sky-600">¥{row.amount.toFixed(2)}</span>
                  <span className="text-[10px] text-gray-400 font-mono block">占比 {pct}%</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 p-4 bg-yellow-50/50 border border-yellow-10 border-dashed rounded-xl flex items-start gap-2 text-xs text-yellow-800">
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
    <div className="space-y-4">

      {/* 过滤条与功能操作开关 */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100 mt-4">
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
              className="pl-8 pr-4 py-1.5 w-44 bg-white border border-gray-100 rounded-xl text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all font-sans"
            />
          </div>

          {/* 新增原料采购项下拉框 (只允许从原料大字典已存在的原料中挑选新增，只读模式下隐藏) */}
          {!readOnly && (
            <form onSubmit={handleAddSubmit} className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-xl px-2.5 py-1">
              <span className="text-[10px] text-gray-400 font-bold shrink-0">添加原料:</span>
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
                className="text-xs text-gray-700 bg-transparent outline-none cursor-pointer max-w-[110px]"
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
                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-300 text-white text-[10px] font-bold rounded-lg transition-colors cursor-pointer shrink-0"
              >
                新增
              </button>
            </form>
          )}

          {/* 导出当前客群和二级分组的月度采购细表按钮 */}
          <button
            onClick={handleExportCsv}
            type="button"
            className={`flex items-center gap-1.5 px-3 py-1.5 ${activeTheme.lightBg} border ${activeTheme.primaryText.replace("text-", "border-").replace("-700", "-200")} ${activeTheme.primaryText} text-xs font-bold rounded-xl transition-all cursor-pointer`}
            title="导出当前餐位二级大类当月所有的每日采购明细表 (CSV)"
          >
            <Download size={13} />
            <span>导出本月细表 (CSV)</span>
          </button>

          {/* 细表主题样式选择器 */}
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-1.5 text-xs select-none">
            <span className="text-[10px] text-gray-400 font-bold shrink-0">表格主题:</span>
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

        <div className="flex rounded-md bg-white p-1 border border-gray-100 text-xs shadow-xs">
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

      {filteredItems.length === 0 ? (
        <div className="py-16 text-center bg-white border border-gray-100/50 rounded-2xl text-gray-400 text-xs italic">
          {UI_TEXT.noDataMessage}
        </div>
      ) : (
        <>
          {/* ================ (1) 大宽表日历矩阵 ================ */}
          {viewMode === "MATRIX" && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
              <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                <table className="w-full border-collapse text-left text-xs text-gray-500">
                  <thead className="bg-gray-50/75 text-gray-600 text-[11px] font-semibold">
                    {/* 一级头: 日期编号号 */}
                    <tr>
                      <th className="p-3 border-b border-r border-gray-100 sticky left-0 bg-gray-50 min-w-[124px] z-20">日期/品类</th>
                      {days.map((day) => (
                        <th
                          key={`col-day-${day}`}
                          colSpan={3}
                          className={`px-2 py-1.5 text-center border-b border-r border-gray-100 ${activeTheme.lightBg} ${activeTheme.primaryText}`}
                        >
                          <div className="flex items-center justify-center">
                            <span>{day}号</span>
                          </div>
                        </th>
                      ))}
                      <th colSpan={2} className="p-3 text-center border-b border-slate-300 bg-indigo-100 text-indigo-900 font-extrabold">全月累加</th>
                    </tr>

                    {/* 二级头: [数量/单价/金额] 三胞胎 */}
                    <tr className="bg-slate-100 text-[10px] text-slate-700 font-bold border-b border-slate-350">
                      <th className="p-2.5 border-b border-r border-slate-350 sticky left-0 bg-slate-100 z-20">食材细分项目</th>
                      {days.map((day) => (
                        <React.Fragment key={`sub-dt-${day}`}>
                          <th className="px-1 py-1 text-center border-b border-r border-slate-300 font-semibold bg-slate-100/70 text-slate-800">数量</th>
                          <th className="px-1 py-1 text-center border-b border-r border-slate-300 font-semibold bg-slate-100/50 text-slate-800">单价</th>
                          <th className={`px-1 py-1 text-center border-b border-r border-slate-350 font-black ${activeTheme.primaryText} ${activeTheme.lightBg}`}>金额</th>
                        </React.Fragment>
                      ))}
                      <th className="p-2 text-center border-b border-r border-slate-350 font-bold bg-slate-100 text-slate-800">月总用量</th>
                      <th className="p-2 text-center border-b border-r border-slate-350 font-black text-indigo-900 bg-indigo-100">月总开销</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-300">
                    {filteredItems.map((item) => {
                      const monthlySummary = getItemMonthlySummary(item, days);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors border-b border-slate-350">

                          {/* 粘性冷冻首列：细分菜名，高负荷滑动不丢失行上下文 */}
                          <td className="p-3 sticky left-0 bg-white border-r-2 border-slate-400 z-10 font-extrabold text-slate-900 flex justify-between items-center group/cell min-w-[150px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                            <span className="truncate max-w-[110px] text-xs font-bold" title={item.name}>
                              {(() => {
                                const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                                const displayName = dictItem ? dictItem.name : item.name;
                                const displayUnit = dictItem ? dictItem.unit : item.unit;
                                const displayRemark = dictItem?.remark || "";
                                return (
                                  <>
                                    <span className="text-slate-900 text-xs font-black">{displayName}</span>
                                    <span className="text-[10px] font-bold text-slate-600 block mt-0.5">
                                      单位: {displayUnit} {displayRemark && `(${displayRemark})`}
                                    </span>
                                  </>
                                );
                              })()}
                            </span>

                            {/* 悬浮删除原料项按钮（只读模式下隐藏，防止在餐位分组页误删） */}
                            {!readOnly && (
                              <button
                                onClick={() => onDeleteItem(item.id)}
                                className="opacity-0 group-hover/cell:opacity-100 p-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg cursor-pointer transition-all shrink-0 ml-1.5"
                                title="删除此原料行"
                              >
                                <Trash size={12} />
                              </button>
                            )}
                          </td>

                          {/* 渲染31天每日录入小卡格 */}
                          {days.map((day) => {
                            const entry = item.dailyData[day] || { quantity: 0, price: 0, amount: 0 };
                            return (
                              <React.Fragment key={`cell-${item.id}-${day}`}>
                                <td className="p-2 border-b border-r border-slate-300 text-center font-mono text-xs font-semibold text-slate-900 bg-white">
                                  {entry.quantity || 0}
                                </td>
                                <td className="p-2 border-b border-r border-slate-300 text-center font-mono text-xs font-semibold text-slate-900 bg-slate-50">
                                  ¥{entry.price || 0}
                                </td>
                                <td className={`p-2 border-b border-r border-slate-350 text-center text-xs font-black font-mono ${activeTheme.primaryText} ${activeTheme.lightBg}`}>
                                  {entry.amount > 0 ? `¥${entry.amount}` : "0"}
                                </td>
                              </React.Fragment>
                            );
                          })}

                          {/* 全月累加列 */}
                          <td className="p-3 border-r border-slate-350 text-center font-black font-mono text-xs text-slate-900 bg-slate-100/60">
                            {monthlySummary.totalQty} {item.unit}
                          </td>
                          <td className="p-3 text-center font-black font-mono text-xs text-indigo-950 bg-indigo-100/50">
                            ¥{monthlySummary.totalCost}
                          </td>

                        </tr>
                      );
                    })}

                    {/* 表底累加汇总：各单日大类整体耗资 */}
                    <tr className="bg-slate-200 font-extrabold text-slate-900 border-t-2 border-slate-400">
                      <td className="p-3 sticky left-0 bg-slate-200 text-slate-900 border-r border-slate-300 font-black shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)] text-xs">
                        【{PrepReportService.getActiveCategories().find(c => c.key === selectedCategory)?.label || selectedCategory}】每日开支合计
                      </td>
                      {days.map((day) => (
                        <React.Fragment key={`tot-cell-${day}`}>
                          <td colSpan={2} className="px-1 py-3 text-[10px] text-slate-500 text-center font-bold uppercase">合计金额:</td>
                          <td className={`px-1 py-3 text-center text-xs font-black border-r border-slate-300 ${activeTheme.accentText} ${activeTheme.accentBg} font-mono`}>
                            ¥{dayTotals[day]}
                          </td>
                        </React.Fragment>
                      ))}
                      <th colSpan={2} className="p-3 text-center text-indigo-950 bg-indigo-200/50 font-black text-xs">
                        ¥{Math.round(Object.values(dayTotals).reduce((s, v) => s + v, 0) * 100) / 100}
                      </th>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================ (2) 单日聚焦卡片 ================ */}
          {viewMode === "FOCUS" && (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs space-y-6">

              {/* 日期选择横轴 slider */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-2.5">
                  横向日历刻度盘 (聚焦今日并极速记账)：
                </label>
                <div className="flex gap-2 pb-3 overflow-x-auto scrollbar-thin">
                  {days.map((day) => {
                    const hasDataOnDay = dayTotals[day] > 0;
                    const isSelected = focusDay === day;
                    return (
                      <button
                        key={`focus-btn-${day}`}
                        onClick={() => setFocusDay(day)}
                        className={`px-3.5 py-2 shrink-0 rounded-xl text-xs font-semibold cursor-pointer transition-all border ${isSelected
                            ? `${activeTheme.primaryBg} text-white border-transparent shadow-md`
                            : hasDataOnDay
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                              : "bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100"
                          }`}
                      >
                        <div className="text-[10px] opacity-75 font-normal">周天</div>
                        <div>{day}号</div>
                        {hasDataOnDay && (
                          <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-1 ${isSelected ? "bg-white" : "bg-emerald-500"}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 当天聚焦记账盘 */}
              <div>
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`p-2 ${activeTheme.lightBg} ${activeTheme.primaryText} rounded-xl font-bold font-mono`}>
                      {focusDay}号
                    </span>
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">【{focusDay}号】耗粮记账明细</h4>
                      <p className="text-xs text-gray-400">在该日期下，垂直修改所有原材料的价格与数量</p>
                    </div>
                  </div>


                </div>

                {/* 聚焦日卡片网络流 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredItems.map((item) => {
                    const entry = item.dailyData[focusDay] || { quantity: 0, price: 0, amount: 0 };
                    return (
                      <div
                        key={`focus-card-${item.id}`}
                        className={`p-4 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50/20 to-white ${activeTheme.borderHover} transition-all flex flex-col justify-between group`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            {(() => {
                              const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                              const displayName = dictItem ? dictItem.name : item.name;
                              const displayUnit = dictItem ? dictItem.unit : item.unit;
                              const displayRemark = dictItem?.remark || "";
                              return (
                                <>
                                  <span className="text-[10px] text-gray-400 font-mono tracking-wider block">
                                    原料项 / 单位：{displayUnit} {displayRemark && `(${displayRemark})`}
                                  </span>
                                  <h5 className="font-bold text-gray-800 text-sm">{displayName}</h5>
                                </>
                              );
                            })()}
                          </div>

                          {/* 垃圾桶删除行按钮（只读模式下隐藏，防止在餐位分组页误删） */}
                          {!readOnly && (
                            <button
                              onClick={() => onDeleteItem(item.id)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg cursor-pointer transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                              title="从备餐细表中移除该原料项目"
                            >
                              <Trash size={13} />
                            </button>
                          )}
                        </div>

                        {/* 修改区 */}
                        <div className="grid grid-cols-2 gap-3 mt-4 text-center">
                          <div className="bg-slate-50 p-2 rounded-lg">
                            <label className="text-[10px] text-slate-400 block mb-0.5 font-semibold">
                              备载数量 ({RawMaterialsDictService.getItems().find(d => d.name === item.name)?.unit || item.unit})
                            </label>
                            <span className="text-xs font-mono font-bold text-slate-700">{entry.quantity || 0}</span>
                          </div>
                          <div className="bg-slate-50 p-2 rounded-lg">
                            <label className="text-[10px] text-slate-400 block mb-0.5 font-semibold">单价 (元)</label>
                            <span className="text-xs font-mono font-bold text-slate-700">¥{entry.price || 0}</span>
                          </div>
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-gray-50 flex justify-between items-center text-xs">
                          <span className="text-gray-400">日结金额合计:</span>
                          <span className={`font-extrabold ${activeTheme.primaryText} font-mono`}>
                            ¥{entry.amount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 今日总金额结算 */}
                <div className={`mt-6 p-4 ${activeTheme.lightBg} border border-slate-100 rounded-xl flex items-center justify-between text-xs`}>
                  <span className="text-gray-500 font-medium">【{focusDay}号】单日大类累计消耗开支：</span>
                  <span className={`text-base font-extrabold ${activeTheme.primaryText} font-mono`}>
                    ¥{dayTotals[focusDay].toFixed(2)} 元
                  </span>
                </div>

              </div>

            </div>
          )}
        </>
      )}

    </div>
  );
};
