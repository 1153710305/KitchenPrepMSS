/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Search, Filter, X, Trash2 } from "lucide-react";
import { LedgerItem, DailyStockRecord } from "../../types/ledgerTypes.ts";
import { LedgerService } from "../../services/ledgerStore.ts";
import { SearchableSelect } from "../shared/SearchableSelect.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FOOD_CATEGORY_LABELS } from "../../constants/constants.ts";
import { LEDGER_HEADERS } from "../../constants/ledgerConstants.ts";
import { FoodCategory } from "../../types/types.ts";

/**
 * @description 常用台账字段选择器（支持显示已有的自定义内容）
 */
function HelperSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  className = "w-28"
}: {
  value: string;
  options: string[];
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder: string;
  className?: string;
}) {
  if (disabled) {
    return (
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        disabled={true}
        className="bg-slate-50 text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none w-full"
      />
    );
  }
  // 如果值存在但不在字典候选项里，则合并到首位展示以防止已有数值丢失
  const allOpts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-white border border-slate-200 px-2 py-1 rounded outline-none text-xs cursor-pointer focus:border-emerald-400 ${className}`}
    >
      <option value="">-- 选择 --</option>
      {allOpts.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

/**
 * @description 感官性状多选气泡组件
 */
function SensorySelector({ 
  value, 
  onChange, 
  disabled 
}: { 
  value: string; 
  onChange: (val: string) => void; 
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  /** 备选感官性状字典项 */
  const options = [
    "包装完整", "米粒饱满", "新鲜", "有光泽", "味正", "颜色好", 
    "肉鲜", "新鲜光滑", "鲜", "嫩", "绿", "色泽鲜亮", "形状饱满", 
    "光泽度好", "颜色鲜艳"
  ];
  
  /** 解析当前逗号或顿号分割的选中值 */
  const selectedValues = value ? value.split("、").filter(Boolean) : [];
  
  const handleToggle = (opt: string) => {
    let next: string[];
    if (selectedValues.includes(opt)) {
      next = selectedValues.filter(v => v !== opt);
    } else {
      next = [...selectedValues, opt];
    }
    onChange(next.join("、"));
  };

  React.useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-block w-full">
      <input
        type="text"
        value={value}
        onClick={() => !disabled && setIsOpen(true)}
        placeholder={disabled ? "未开启录入" : "合格 (点击选择)"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none cursor-pointer text-xs focus:border-emerald-400"
      />
      {isOpen && !disabled && (
        <div className="absolute left-0 mt-1 p-2.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 w-64 max-h-48 overflow-y-auto">
          <div className="text-[10px] text-slate-400 font-bold mb-2 pb-1 border-b border-slate-100 flex justify-between items-center select-none">
            <span>感官性状 (多选)</span>
            <button 
              type="button" 
              onClick={() => onChange("")} 
              className="text-rose-500 hover:text-rose-600 font-black cursor-pointer text-[10px]"
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {options.map((opt) => {
              const isSelected = selectedValues.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleToggle(opt)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-emerald-500 border-emerald-500 text-white font-bold"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-600"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface LedgerStyle1TableProps {
  currentLedgerItems: LedgerItem[];
  filteredLedgerItems: LedgerItem[];
  selectedDate: string;
  isRecordingMode: boolean;
  draftRecords: Record<string, DailyStockRecord>;
  editingMaterialId: string | null;
  editMaterialName: string;
  editMaterialSpec: string;
  editMaterialUnit: string;
  editMaterialStock: number;
  dictOptions: any[];
  availableCategories: string[];
  availableBuyers: string[];
  availableInspectors: string[];
  availableKeepers: string[];
  filterName: string;
  filterCategory: string;
  filterBuyer: string;
  filterInspector: string;
  filterKeeper: string;
  hasActiveFilters: boolean;
  setFilterName: (val: string) => void;
  setFilterCategory: (val: string) => void;
  setFilterBuyer: (val: string) => void;
  setFilterInspector: (val: string) => void;
  setFilterKeeper: (val: string) => void;
  handleSaveEditMaterial: (e: React.FormEvent) => void;
  handleDeleteMaterial: (id: string) => void;
  handleDraftCellChange: (itemId: string, fields: Partial<DailyStockRecord>) => void;
  setEditingMaterialId: (val: string | null) => void;
  setEditMaterialName: (val: string) => void;
  setEditMaterialSpec: (val: string) => void;
  setEditMaterialUnit: (val: string) => void;
  setEditMaterialStock: (val: number) => void;
}

export function LedgerStyle1Table({
  currentLedgerItems,
  filteredLedgerItems,
  selectedDate,
  isRecordingMode,
  draftRecords,
  editingMaterialId,
  editMaterialName,
  editMaterialSpec,
  editMaterialUnit,
  editMaterialStock,
  dictOptions,
  availableCategories,
  availableBuyers,
  availableInspectors,
  availableKeepers,
  filterName,
  filterCategory,
  filterBuyer,
  filterInspector,
  filterKeeper,
  hasActiveFilters,
  setFilterName,
  setFilterCategory,
  setFilterBuyer,
  setFilterInspector,
  setFilterKeeper,
  handleSaveEditMaterial,
  handleDeleteMaterial,
  handleDraftCellChange,
  setEditingMaterialId,
  setEditMaterialName,
  setEditMaterialSpec,
  setEditMaterialUnit,
  setEditMaterialStock,
}: LedgerStyle1TableProps) {
  /**
   * @description 动态计算输入框自适应宽度（防止输入框过窄，随用户打字自适应伸展）
   */
  const getInputWidth = (val: any, placeholder?: string, isDate?: boolean) => {
    if (isDate) return "115px";
    const valStr = val === undefined || val === null ? "" : String(val);
    const content = valStr || placeholder || "";
    let charLen = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) > 127) {
        charLen += 2;
      } else {
        charLen += 1.15;
      }
    }
    const minWidth = placeholder && (placeholder.includes("0") || placeholder.includes("¥")) ? 75 : 105;
    const calculated = charLen * 7.5 + 20;
    return `${Math.max(minWidth, calculated)}px`;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* ===== 多维度筛选工具栏 ===== */}
      <div className="px-3 py-2 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center gap-2">
        {/* 名称搜索框 */}
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
          <Search size={12} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="搜索原料名称..."
            className="text-[11px] outline-none bg-transparent w-28 text-slate-700"
          />
        </div>
        {/* 品类筛选 */}
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
          <Filter size={12} className="text-violet-400 shrink-0" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-[11px] outline-none bg-transparent text-slate-700 cursor-pointer"
          >
            <option value="">全部品类</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat}>
                {FOOD_CATEGORY_LABELS[cat as FoodCategory] || cat}
              </option>
            ))}
          </select>
        </div>
        {/* 采购员筛选 */}
        {availableBuyers.length > 0 && (
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-slate-400 shrink-0">采购员:</span>
            <select value={filterBuyer} onChange={(e) => setFilterBuyer(e.target.value)} className="text-[11px] outline-none bg-transparent text-slate-700 cursor-pointer">
              <option value="">不限</option>
              {availableBuyers.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        )}
        {/* 检验员筛选 */}
        {availableInspectors.length > 0 && (
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-slate-400 shrink-0">检验员:</span>
            <select value={filterInspector} onChange={(e) => setFilterInspector(e.target.value)} className="text-[11px] outline-none bg-transparent text-slate-700 cursor-pointer">
              <option value="">不限</option>
              {availableInspectors.map(ins => <option key={ins} value={ins}>{ins}</option>)}
            </select>
          </div>
        )}
        {/* 保管员筛选 */}
        {availableKeepers.length > 0 && (
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-slate-400 shrink-0">保管员:</span>
            <select value={filterKeeper} onChange={(e) => setFilterKeeper(e.target.value)} className="text-[11px] outline-none bg-transparent text-slate-700 cursor-pointer">
              <option value="">不限</option>
              {availableKeepers.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        )}
        {/* 清空筛选按钮 */}
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterName(""); setFilterCategory(""); setFilterBuyer(""); setFilterInspector(""); setFilterKeeper(""); }}
            className="flex items-center gap-1 px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11px] font-bold rounded-lg cursor-pointer transition-all border border-rose-200"
          >
            <X size={11} />清空筛选
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          显示 <span className="font-bold text-slate-600">{filteredLedgerItems.length}</span> / {currentLedgerItems.length} 条
          {hasActiveFilters && <span className="ml-1 text-amber-600">（已过滤）</span>}
        </span>
      </div>
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-500">【图一样式】原料购销日总表明细</span>
        <span className="text-[9px] text-slate-400 font-medium">修改任意格后失去焦点自动同步物理库存</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs min-w-[1380px]">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 font-bold uppercase">
              <th className="px-4 py-3 text-slate-600 font-bold w-44">{LEDGER_HEADERS.materialName}</th>
              <th className="px-3 py-3 text-center text-violet-700 font-bold bg-violet-50/40 w-20">二级品类</th>
              <th className="px-3 py-3 text-center text-slate-600 font-bold w-20">单位</th>
              <th className="px-3 py-3 text-emerald-800 font-bold bg-emerald-50/30 w-28">{LEDGER_HEADERS.inQuantity}</th>
              <th className="px-3 py-3 text-emerald-800 font-bold bg-emerald-50/30 w-24">单价(元)</th>
              <th className="px-3 py-3 text-indigo-800 font-bold bg-indigo-50/30 w-28">{LEDGER_HEADERS.outQuantity}</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.certification}</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.sensoryProperty}</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-48">{LEDGER_HEADERS.supplier}</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-36">生产日期</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-36">保质期</th>
              <th className="px-3 py-3 text-emerald-700 font-bold bg-emerald-50/20 w-36">采购/入库时间</th>
              <th className="px-3 py-3 text-indigo-700 font-bold bg-indigo-50/20 w-36">出库时间</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.buyer}</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.inspector}</th>
              <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.keeper}</th>
              <th className="px-3 py-3 text-indigo-700 font-bold bg-indigo-50/20 w-28">出库人</th>
              <th className="px-3 py-3 text-indigo-700 font-bold bg-indigo-50/20 w-28">接收人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {currentLedgerItems.length === 0 ? (
              <tr>
                <td colSpan={18} className="text-center py-12 text-slate-400 italic">
                  该台账暂无采购原料。请点击右上方“新增原料采购项”进行录入填充。
                </td>
              </tr>
            ) : filteredLedgerItems.length === 0 ? (
              <tr>
                <td colSpan={18} className="text-center py-10 text-slate-400 italic">
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Search size={26} className="text-slate-200" />
                    <span>未找到符合筛选条件的原料，请调整条件后重试。</span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredLedgerItems.map((item) => {
                const isItemEditing = editingMaterialId === item.id;
                const record = item.dailyRecords[selectedDate] || {
                  inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "",
                  certification: "", sensoryProperty: "", supplier: "", buyer: "", inspector: "", keeper: "",
                  outHandler: "", outRecipient: ""
                };

                if (isItemEditing) {
                  return (
                    <tr key={item.id} className="bg-emerald-50/20">
                      <td colSpan={18} className="px-4 py-3">
                        <form onSubmit={handleSaveEditMaterial} className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400">原料品名:</span>
                            <SearchableSelect
                              options={dictOptions}
                              value={editMaterialName}
                              onChange={(val, opt) => {
                                setEditMaterialName(val);
                                if (opt && opt.unit) {
                                  setEditMaterialUnit(opt.unit);
                                }
                              }}
                              placeholder="选择原料"
                              className="w-28"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400">规格:</span>
                            <input 
                              type="text" value={editMaterialSpec} onChange={(e) => setEditMaterialSpec(e.target.value)}
                              className="bg-white border border-slate-300 px-2 py-1 rounded text-xs w-28 outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400">单位:</span>
                            <input 
                              type="text" value={editMaterialUnit} onChange={(e) => setEditMaterialUnit(e.target.value)}
                              className="bg-white border border-slate-300 px-2 py-1 rounded text-xs w-16 text-center outline-none" required
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400">初始库存:</span>
                            <input 
                              type="number" step="any" value={editMaterialStock} onChange={(e) => setEditMaterialStock(Number(e.target.value))}
                              className="bg-white border border-slate-300 px-2 py-1 rounded text-xs w-20 text-right outline-none" required
                            />
                          </div>
                          <button type="submit" className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold cursor-pointer">
                            保存原料参数
                          </button>
                          <button type="button" onClick={() => setEditingMaterialId(null)} className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs cursor-pointer">
                            取消
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                }

                const draftRecord = draftRecords[item.id];
                const recordToRender = isRecordingMode ? (draftRecord || {
                  inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "",
                  certification: "", sensoryProperty: "", supplier: "", buyer: "", inspector: "", keeper: "",
                  outHandler: "", outRecipient: ""
                }) : record;

                return (
                  <tr key={item.id} className="hover:bg-slate-50/50 group">
                    <td className="px-4 py-2.5 font-bold text-slate-800 flex justify-between items-center min-w-[150px]">
                      <div>
                        {(() => {
                          const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                          const displayName = dictItem ? dictItem.name : item.name;
                          const displayRemark = dictItem?.remark || "";
                          return (
                            <>
                              {displayName}
                              {displayRemark ? (
                                <div className="text-[9px] text-slate-400 font-normal mt-0.5">{displayRemark}</div>
                              ) : (
                                <div className="text-[9px] text-slate-350 font-normal mt-0.5">{item.spec || "-"}</div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      
                      {/* 悬浮删除原料采购项目按钮 */}
                      {!isRecordingMode && (
                        <button
                          onClick={() => handleDeleteMaterial(item.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg cursor-pointer transition-all shrink-0 ml-2"
                          title="删除此台账原料采购项"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                    {/* 二级品类标签列 */}
                    <td className="px-3 py-2.5 text-center bg-violet-50/30">
                      {(() => {
                        const dictItem2 = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                        const cat = dictItem2?.category;
                        if (!cat) return <span className="text-slate-300 text-[10px]">—</span>;
                        const catLabel = FOOD_CATEGORY_LABELS[cat as FoodCategory] || cat;
                        const colorMap: Record<string, string> = {
                          VEGETABLE: "bg-green-100 text-green-700 border-green-200",
                          GRAIN_OIL: "bg-amber-100 text-amber-700 border-amber-200",
                          SEASONING: "bg-orange-100 text-orange-700 border-orange-200",
                          MEAT: "bg-red-100 text-red-700 border-red-200",
                          LOW_CONSUMP: "bg-slate-100 text-slate-600 border-slate-200",
                          FRUIT: "bg-pink-100 text-pink-700 border-pink-200"
                        };
                        return (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${colorMap[cat] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {catLabel}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500">
                      {RawMaterialsDictService.getItems().find(d => d.name === item.name)?.unit || item.unit}
                    </td>
                    
                    {/* 采购数量 */}
                    <td className="px-3 py-2 bg-emerald-50/10">
                      <input 
                        type="number" step="any"
                        value={recordToRender.inQuantity || ""}
                        placeholder={isRecordingMode ? "0" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { inQuantity: Number(e.target.value) })}
                        className="bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                        style={{ width: getInputWidth(recordToRender.inQuantity, isRecordingMode ? "0" : "未开启录入") }}
                      />
                      {(() => {
                        const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                        if (dictItem && dictItem.conversionUnit && dictItem.conversionRatio) {
                          const qty = recordToRender.inQuantity || 0;
                          const converted = qty * dictItem.conversionRatio;
                          return (
                            <div className="text-[9px] text-emerald-600 font-bold text-right mt-0.5">
                              折合: {converted.toFixed(1)} {dictItem.conversionUnit}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </td>
                    
                    {/* 单价 */}
                    <td className="px-3 py-2 bg-emerald-50/10">
                      <input 
                        type="number" step="any"
                        value={recordToRender.inPrice || ""}
                        placeholder={isRecordingMode ? "¥0.00" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { inPrice: Number(e.target.value) })}
                        className="bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                        style={{ width: getInputWidth(recordToRender.inPrice, isRecordingMode ? "¥0.00" : "未开启录入") }}
                      />
                    </td>

                    {/* 出库数量 */}
                    <td className="px-3 py-2 bg-indigo-50/10">
                      <input 
                        type="number" step="any"
                        value={recordToRender.outQuantity || ""}
                        placeholder={isRecordingMode ? "0" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { outQuantity: Number(e.target.value) })}
                        className="bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                        style={{ width: getInputWidth(recordToRender.outQuantity, isRecordingMode ? "0" : "未开启录入") }}
                      />
                    </td>

                    {/* 食品索证 */}
                    <td className="px-3 py-2">
                      {isRecordingMode ? (
                        <select
                          value={recordToRender.certification || ""}
                          onChange={(e) => handleDraftCellChange(item.id, { certification: e.target.value })}
                          className="bg-white border border-slate-200 px-2 py-1 rounded outline-none w-24 text-xs cursor-pointer focus:border-emerald-400"
                        >
                          <option value="">-- 选择 --</option>
                          <option value="有">有</option>
                          <option value="无">无</option>
                        </select>
                      ) : (
                        <input 
                          type="text"
                          value={recordToRender.certification || ""}
                          placeholder="未开启录入"
                          disabled={true}
                          className="bg-slate-50 text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                          style={{ width: getInputWidth(recordToRender.certification, "未开启录入") }}
                        />
                      )}
                    </td>
 
                    {/* 感官性状 */}
                    <td className="px-3 py-2">
                      <SensorySelector
                        value={recordToRender.sensoryProperty || ""}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { sensoryProperty: val })}
                      />
                    </td>
 
                    {/* 供货商及地址 */}
                    <td className="px-3 py-2">
                      <HelperSelect
                        value={recordToRender.supplier || ""}
                        options={LedgerService.getHelperDict().suppliers}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { supplier: val })}
                        placeholder="未开启录入"
                        className="w-48"
                      />
                    </td>

                    {/* 生产日期 */}
                    <td className="px-3 py-2">
                      <input 
                        type="date"
                        value={recordToRender.produceDate || ""}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { produceDate: e.target.value })}
                        className="bg-white disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 px-1.5 py-1 rounded font-mono text-xs outline-none focus:border-emerald-400"
                        style={{ width: getInputWidth(recordToRender.produceDate, "", true) }}
                        title="生产日期 (选填)"
                      />
                    </td>

                    {/* 保质期 */}
                    <td className="px-3 py-2">
                      {isRecordingMode ? (
                        <select
                          value={recordToRender.shelfLife || ""}
                          onChange={(e) => handleDraftCellChange(item.id, { shelfLife: e.target.value })}
                          className="bg-white border border-slate-200 px-2 py-1 rounded outline-none w-28 text-xs cursor-pointer focus:border-emerald-400"
                        >
                          <option value="">-- 选择 --</option>
                          <option value="2天">2天</option>
                          <option value="15天">15天</option>
                          <option value="1个月">1个月</option>
                          <option value="3个月">3个月</option>
                          <option value="6个月">6个月</option>
                          <option value="1年">1年</option>
                          <option value="一年以上">一年以上</option>
                          <option value="保质期较短">保质期较短</option>
                        </select>
                      ) : (
                        <input 
                          type="text"
                          value={recordToRender.shelfLife || ""}
                          placeholder="未开启录入"
                          disabled={true}
                          className="bg-slate-50 text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                          style={{ width: getInputWidth(recordToRender.shelfLife, "未开启录入") }}
                        />
                      )}
                    </td>

                    {/* 采购/入库时间（默认选定日期，允许手动修改） */}
                    <td className="px-3 py-2 bg-emerald-50/20">
                      <input 
                        type="date"
                        value={recordToRender.purchaseDate || selectedDate}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { purchaseDate: e.target.value })}
                        className="bg-white disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 px-1.5 py-1 rounded font-mono text-xs outline-none focus:border-emerald-400"
                        style={{ width: getInputWidth(recordToRender.purchaseDate || selectedDate, "", true) }}
                        title="采购入库时间（默认为当日，可手动修改）"
                      />
                    </td>

                    {/* 出库时间（默认选定日期，允许手动修改） */}
                    <td className="px-3 py-2 bg-indigo-50/20">
                      <input 
                        type="date"
                        value={recordToRender.outDate || selectedDate}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { outDate: e.target.value })}
                        className="bg-white disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 px-1.5 py-1 rounded font-mono text-xs outline-none focus:border-indigo-400"
                        style={{ width: getInputWidth(recordToRender.outDate || selectedDate, "", true) }}
                        title="出库时间（默认为当日，可手动修改）"
                      />
                    </td>
 
                    {/* 采购员 */}
                    <td className="px-3 py-2">
                      <HelperSelect
                        value={recordToRender.buyer || ""}
                        options={LedgerService.getHelperDict().buyers}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { buyer: val })}
                        placeholder="未开启录入"
                        className="w-28"
                      />
                    </td>
 
                    {/* 检验员 */}
                    <td className="px-3 py-2">
                      <HelperSelect
                        value={recordToRender.inspector || ""}
                        options={LedgerService.getHelperDict().inspectors}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { inspector: val })}
                        placeholder="未开启录入"
                        className="w-28"
                      />
                    </td>
 
                    {/* 保管员 */}
                    <td className="px-3 py-2">
                      <HelperSelect
                        value={recordToRender.keeper || ""}
                        options={LedgerService.getHelperDict().keepers}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { keeper: val })}
                        placeholder="未开启录入"
                        className="w-28"
                      />
                    </td>

                    {/* 发料出库人 */}
                    <td className="px-3 py-2 bg-indigo-50/10">
                      <HelperSelect
                        value={recordToRender.outHandler || ""}
                        options={LedgerService.getHelperDict().outHandlers}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { outHandler: val })}
                        placeholder="未开启录入"
                        className="w-28"
                      />
                    </td>

                    {/* 领用接收人 */}
                    <td className="px-3 py-2 bg-indigo-50/10">
                      <HelperSelect
                        value={recordToRender.outRecipient || ""}
                        options={LedgerService.getHelperDict().outRecipients}
                        disabled={!isRecordingMode}
                        onChange={(val) => handleDraftCellChange(item.id, { outRecipient: val })}
                        placeholder="未开启录入"
                        className="w-28"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
