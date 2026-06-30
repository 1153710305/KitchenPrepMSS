/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from "react";
import { FoodCategory, PreparedItem, TargetGroup, GroupMonthlyReport, DynamicGroup, DynamicCategory } from "../types.ts";
import { PrepReportService } from "../store.ts";
import { FOOD_CATEGORY_LABELS, TARGET_GROUP_LABELS, UI_TEXT } from "../constants.ts";
import { getDaysInMonth, getItemMonthlySummary, LogBroker } from "../utils.ts";
import { Plus, Trash, Copy, SlidersHorizontal, Grid, Search, CalendarDays, Check, Flame } from "lucide-react";
import { SearchableSelect } from "./SearchableSelect.tsx";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";

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
  /** 一键列单价批量克隆回调 */
  onBatchPriceUpdate: (targetGroup: TargetGroup, category: FoodCategory, day: string, price: number) => void;
  /** 是否为管理员模式 */
  isAdminMode: boolean;
  /** 激活的一级受众人群列表 */
  activeGroupsList: DynamicGroup[];
  /** 激活的二级食材分类列表 */
  activeCategoriesList: DynamicCategory[];
}

/**
 * @description 多功能后厨电子备料表格与汇总合计组件
 */
export const TableGrid: React.FC<TableGridProps> = ({
  report,
  selectedCategory,
  onCellUpdate,
  onAddItem,
  onDeleteItem,
  onBatchPriceUpdate,
  isAdminMode,
  activeGroupsList,
  activeCategoriesList
}) => {
  // 1. 核心视图布局模式切换：MATRIX (大宽表Excel矩阵) | FOCUS (单日卡片聚焦)
  const [viewMode, setViewMode] = useState<"MATRIX" | "FOCUS">("MATRIX");
  
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

  // 1. 过滤：按选定主类和搜索关键字过滤条目
  const filteredItems = useMemo(() => {
    return report.items.filter((item) => {
      const matchCat = selectedCategory === null ? true : item.category === selectedCategory;
      const matchSearch = item.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchCat && matchSearch;
    });
  }, [report.items, selectedCategory, searchQuery]);

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
   * @description 触发批量价格设定
   */
  const triggerBatchPrice = (day: string) => {
    if (selectedCategory === null) return;
    const priceInput = prompt(UI_TEXT.batchPricePrompt);
    if (priceInput === null) return; // 取消
    const parsed = parseFloat(priceInput);
    if (isNaN(parsed) || parsed < 0) {
      alert("请输入有效的非负数字。");
      return;
    }
    onBatchPriceUpdate(report.targetGroup, selectedCategory, day, parsed);
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
              className="pl-8 pr-4 py-1.5 w-48 sm:w-60 bg-white border border-gray-100 rounded-xl text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all font-sans"
            />
          </div>

          {/* 新增菜品表单 */}
          <form onSubmit={handleAddSubmit} className="flex items-center gap-2">
            <SearchableSelect
              options={dictOptions}
              value={newItemName}
              onChange={(val, opt) => {
                setNewItemName(val);
                if (opt && opt.unit) {
                  setNewItemUnit(opt.unit);
                }
              }}
              placeholder={UI_TEXT.itemNamePlaceholder}
              className="w-36"
            />
            <input
              type="text"
              placeholder="单位"
              value={newItemUnit}
              onChange={(e) => setNewItemUnit(e.target.value)}
              className="px-2 py-1.5 w-12 bg-white border border-gray-100 rounded-xl text-xs text-center text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all font-mono"
            />
            <button
              type="submit"
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-xs"
            >
              <Plus size={13} />
              <span>{UI_TEXT.itemAddBtn}</span>
            </button>
          </form>
        </div>

        {/* 辅视图控制切换 */}
        <div className="flex rounded-md bg-white p-1 border border-gray-100 text-xs shadow-xs">
          <button
            onClick={() => setViewMode("MATRIX")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer font-medium ${
              viewMode === "MATRIX" ? "bg-sky-500 text-white font-bold" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Grid size={13} />
            <span>EXCEL 日历总矩阵</span>
          </button>
          <button
            onClick={() => setViewMode("FOCUS")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer font-medium ${
              viewMode === "FOCUS" ? "bg-sky-500 text-white font-bold" : "text-gray-500 hover:text-gray-900"
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
                          className="px-2 py-1.5 text-center border-b border-r border-gray-100 bg-sky-50/50 text-sky-700"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>{day}号</span>
                            <button
                              onClick={() => triggerBatchPrice(day)}
                              className="text-[9px] text-sky-500 hover:text-sky-700 bg-sky-100/50 px-1 py-0.5 rounded-xs font-mono cursor-pointer transition-all"
                              title={UI_TEXT.batchPriceBtn}
                            >
                              调价
                            </button>
                          </div>
                        </th>
                      ))}
                      <th colSpan={2} className="p-3 text-center border-b border-gray-100 bg-indigo-50/50 text-indigo-800">全月累加</th>
                      <th className="p-3 text-center border-b border-gray-100 bg-gray-50 min-w-[70px]">操作</th>
                    </tr>
                    
                    {/* 二级头: [数量/单价/金额] 三胞胎 */}
                    <tr className="bg-gray-50/40 text-[10px] text-gray-400">
                      <th className="p-2.5 border-b border-r border-gray-100 sticky left-0 bg-gray-50 z-20">食材细分项目</th>
                      {days.map((day) => (
                        <React.Fragment key={`sub-dt-${day}`}>
                          <th className="px-1 py-1 text-center border-b font-normal">数量</th>
                          <th className="px-1 py-1 text-center border-b font-normal">单价</th>
                          <th className="px-1 py-1 text-center border-b border-r border-gray-100 text-sky-600/70 font-semibold bg-sky-50/10">金额</th>
                        </React.Fragment>
                      ))}
                      <th className="p-2 text-center border-b border-r border-gray-100 font-normal">月总用量</th>
                      <th className="p-2 text-center border-b font-medium text-indigo-700 bg-indigo-50/10">月总开销</th>
                      <th className="p-2 border-b text-center">清空控</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {filteredItems.map((item) => {
                      const monthlySummary = getItemMonthlySummary(item, days);
                      return (
                        <tr key={item.id} className="hover:bg-gray-50/35 transition-colors">
                          
                          {/* 粘性冷冻首列：细分菜名，高负荷滑动不丢失行上下文 */}
                          <td className="p-2.5 sticky left-0 bg-white border-r border-gray-100 z-10 font-bold text-gray-700 flex justify-between items-center group/cell">
                            <span className="truncate max-w-[110px]" title={item.name}>
                              {item.name}
                              <span className="text-[10px] font-normal text-gray-400 block mt-0.5">单位: {item.unit}</span>
                            </span>
                          </td>

                          {/* 渲染31天每日录入小卡格 */}
                          {days.map((day) => {
                            const entry = item.dailyData[day] || { quantity: 0, price: 0, amount: 0 };
                            return (
                              <React.Fragment key={`cell-${item.id}-${day}`}>
                                <td className="p-1 border-b">
                                  <input
                                    type="number"
                                    value={entry.quantity || ""}
                                    placeholder="0"
                                    min="0"
                                    step="any"
                                    onChange={(e) => handleInputChange(item.id, day, "quantity", e.target.value)}
                                    onFocus={() => handleInputFocus(item.id, day, "quantity", entry.quantity || 0)}
                                    onBlur={() => handleInputBlur(item.id, day, "quantity", entry.quantity || 0, item)}
                                    className="w-12 px-1 py-0.5 bg-transparent border-0 text-center font-mono focus:bg-white focus:ring-1 focus:ring-sky-500 rounded-md focus:outline-none text-[11px] text-gray-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </td>
                                <td className="p-1 border-b">
                                  <input
                                    type="number"
                                    value={entry.price || ""}
                                    placeholder="0"
                                    min="0"
                                    step="any"
                                    onChange={(e) => handleInputChange(item.id, day, "price", e.target.value)}
                                    onFocus={() => handleInputFocus(item.id, day, "price", entry.price || 0)}
                                    onBlur={() => handleInputBlur(item.id, day, "price", entry.price || 0, item)}
                                    className="w-12 px-1 py-0.5 bg-transparent border-0 text-center font-mono focus:bg-white focus:ring-1 focus:ring-sky-500 rounded-md focus:outline-none text-[11px] text-gray-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                </td>
                                <td className="p-1 border-b border-r border-gray-100 text-center text-[10px] font-semibold text-gray-700 font-mono bg-sky-50/5">
                                  {entry.amount > 0 ? `¥${entry.amount}` : "0"}
                                </td>
                              </React.Fragment>
                            );
                          })}

                          {/* 全月累加列 */}
                          <td className="p-2 border-r border-gray-100 text-center font-semibold font-mono text-gray-600 bg-gray-50/10">
                            {monthlySummary.totalQty} {item.unit}
                          </td>
                          <td className="p-2 text-center font-bold font-mono text-indigo-700 bg-indigo-50/10">
                            ¥{monthlySummary.totalCost}
                          </td>

                          {/* 行移除行 */}
                          <td className="p-2 text-center">
                            <button
                              onClick={() => onDeleteItem(item.id)}
                              className="p-1 text-gray-300 hover:text-red-500 rounded-xs transition-colors hover:bg-red-50 cursor-pointer"
                              title={UI_TEXT.deleteTitle}
                            >
                              <Trash size={12} />
                            </button>
                          </td>

                        </tr>
                      );
                    })}

                    {/* 表底累加汇总：各单日大类整体耗资 */}
                    <tr className="bg-gray-100/50 font-bold text-gray-700">
                      <td className="p-3 sticky left-0 bg-gray-100 text-gray-800 border-r border-gray-200">
                        【{PrepReportService.getActiveCategories().find(c => c.key === selectedCategory)?.label || selectedCategory}】每日开支合计
                      </td>
                      {days.map((day) => (
                        <React.Fragment key={`tot-cell-${day}`}>
                          <td colSpan={2} className="px-1 py-2 text-[10px] text-gray-400 text-center font-semibold uppercase">合计金额:</td>
                          <td className="px-1 py-2 text-center text-[11px] text-sky-700 font-mono border-r border-gray-200 bg-sky-100/30">
                            ¥{dayTotals[day]}
                          </td>
                        </React.Fragment>
                      ))}
                      <td colSpan={2} className="p-3 text-center text-indigo-800 bg-indigo-100/30">
                        ¥{Math.round(Object.values(dayTotals).reduce((s,v)=>s+v,0)*100)/100}
                      </td>
                      <td className="p-3 bg-gray-100"></td>
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
                        className={`px-3.5 py-2 shrink-0 rounded-xl text-xs font-semibold cursor-pointer transition-all border ${
                          isSelected
                            ? "bg-sky-500 text-white border-sky-400 shadow-md shadow-sky-50"
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
                    <span className="p-2 bg-sky-50 text-sky-600 rounded-xl font-bold font-mono">
                      {focusDay}号
                    </span>
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">【{focusDay}号】耗粮记账明细</h4>
                      <p className="text-xs text-gray-400">在该日期下，垂直修改所有原材料的价格与数量</p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => triggerBatchPrice(focusDay)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-sky-600 border border-gray-100 rounded-xl text-xs cursor-pointer transition-all"
                    >
                      <Copy size={12} />
                      <span>{UI_TEXT.batchPriceBtn}</span>
                    </button>
                  </div>
                </div>

                {/* 聚焦日卡片网络流 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredItems.map((item) => {
                    const entry = item.dailyData[focusDay] || { quantity: 0, price: 0, amount: 0 };
                    return (
                      <div
                        key={`focus-card-${item.id}`}
                        className="p-4 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50/20 to-white hover:border-sky-300 transition-all flex flex-col justify-between group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] text-gray-400 font-mono tracking-wider block">原料项 / 单位：{item.unit}</span>
                            <h5 className="font-bold text-gray-800 text-sm">{item.name}</h5>
                          </div>
                          <button
                            onClick={() => onDeleteItem(item.id)}
                            className="p-1 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                          >
                            <Trash size={12} />
                          </button>
                        </div>

                        {/* 修改区 */}
                        <div className="grid grid-cols-2 gap-3 mt-4">
                          <div>
                            <label className="text-[10px] text-gray-400 block mb-1 font-semibold">备载数量 ({item.unit})</label>
                            <input
                              type="number"
                              placeholder="0"
                              value={entry.quantity || ""}
                              onChange={(e) => handleInputChange(item.id, focusDay, "quantity", e.target.value)}
                              onFocus={() => handleInputFocus(item.id, focusDay, "quantity", entry.quantity || 0)}
                              onBlur={() => handleInputBlur(item.id, focusDay, "quantity", entry.quantity || 0, item)}
                              className="px-3 py-1.5 w-full bg-gray-50 border border-gray-100 focus:bg-white focus:ring-1 focus:ring-sky-500 rounded-lg text-xs font-mono text-gray-700 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400 block mb-1 font-semibold">单价 (元)</label>
                            <input
                              type="number"
                              placeholder="0"
                              value={entry.price || ""}
                              onChange={(e) => handleInputChange(item.id, focusDay, "price", e.target.value)}
                              onFocus={() => handleInputFocus(item.id, focusDay, "price", entry.price || 0)}
                              onBlur={() => handleInputBlur(item.id, focusDay, "price", entry.price || 0, item)}
                              className="px-3 py-1.5 w-full bg-gray-50 border border-gray-100 focus:bg-white focus:ring-1 focus:ring-sky-500 rounded-lg text-xs font-mono text-gray-700 focus:outline-none"
                            />
                          </div>
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-gray-50 flex justify-between items-center text-xs">
                          <span className="text-gray-400">日结金额合计:</span>
                          <span className="font-extrabold text-sky-600 font-mono">
                            ¥{entry.amount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 今日总金额结算 */}
                <div className="mt-6 p-4 bg-sky-50/50 border border-sky-100/50 rounded-xl flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">【{focusDay}号】单日大类累计消耗开支：</span>
                  <span className="text-base font-extrabold text-sky-700 font-mono">
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
