/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Search, Filter, X, Trash2 } from "lucide-react";
import { LedgerItem, DailyStockRecord } from "../ledgerTypes.ts";
import { SearchableSelect } from "./SearchableSelect.tsx";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { FOOD_CATEGORY_LABELS } from "../constants.ts";
import { LEDGER_HEADERS } from "../ledgerConstants.ts";
import { FoodCategory } from "../types.ts";

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
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
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
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
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
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                      />
                    </td>

                    {/* 食品索证 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.certification || ""}
                        placeholder={isRecordingMode ? "已索证" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { certification: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>
 
                    {/* 感官性状 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.sensoryProperty || ""}
                        placeholder={isRecordingMode ? "合格/合格率" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { sensoryProperty: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>
 
                    {/* 供货商及地址 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.supplier || ""}
                        placeholder={isRecordingMode ? "经销商地址及名称" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { supplier: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>

                    {/* 生产日期 */}
                    <td className="px-3 py-2">
                      <input 
                        type="date"
                        value={recordToRender.produceDate || ""}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { produceDate: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 px-1.5 py-1 rounded font-mono text-xs outline-none focus:border-emerald-400"
                        title="生产日期 (选填)"
                      />
                    </td>

                    {/* 保质期 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.shelfLife || ""}
                        placeholder={isRecordingMode ? "如: 6个月" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { shelfLife: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                        title="保质期 (选填)"
                      />
                    </td>

                    {/* 采购/入库时间（默认选定日期，允许手动修改） */}
                    <td className="px-3 py-2 bg-emerald-50/20">
                      <input 
                        type="date"
                        value={recordToRender.purchaseDate || selectedDate}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { purchaseDate: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 px-1.5 py-1 rounded font-mono text-xs outline-none focus:border-emerald-400"
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
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-300 border border-slate-200 px-1.5 py-1 rounded font-mono text-xs outline-none focus:border-indigo-400"
                        title="出库时间（默认为当日，可手动修改）"
                      />
                    </td>
 
                    {/* 采购员 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.buyer || ""}
                        placeholder={isRecordingMode ? "采购经办" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { buyer: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>
 
                    {/* 检验员 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.inspector || ""}
                        placeholder={isRecordingMode ? "检验验收" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { inspector: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>
 
                    {/* 保管员 */}
                    <td className="px-3 py-2">
                      <input 
                        type="text"
                        value={recordToRender.keeper || ""}
                        placeholder={isRecordingMode ? "库管签字" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { keeper: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>

                    {/* 发料出库人 */}
                    <td className="px-3 py-2 bg-indigo-50/10">
                      <input 
                        type="text"
                        value={recordToRender.outHandler || ""}
                        placeholder={isRecordingMode ? "出库人" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { outHandler: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                      />
                    </td>

                    {/* 领用接收人 */}
                    <td className="px-3 py-2 bg-indigo-50/10">
                      <input 
                        type="text"
                        value={recordToRender.outRecipient || ""}
                        placeholder={isRecordingMode ? "接收人" : "未开启录入"}
                        disabled={!isRecordingMode}
                        onChange={(e) => handleDraftCellChange(item.id, { outRecipient: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
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
