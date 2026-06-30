/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { LedgerService } from "../ledgerStore.ts";
import { matchPinyin } from "../utils.ts";

/**
 * @description 行内添加采购项表单组件入参接口
 */
interface LedgerAddMaterialInlineFormProps {
  /** 当前激活的台账 ID */
  activeLedgerId: string;
  /** 新原料名称 */
  newMaterialName: string;
  /** 设置新原料名称的回调 */
  setNewMaterialName: (val: string) => void;
  /** 添加原料的拼音/中文搜索查询词 */
  addMaterialSearchQuery: string;
  /** 设置搜索查询词的回调 */
  setAddMaterialSearchQuery: (val: string) => void;
  /** 下拉搜索浮框是否展开 */
  isAddDropdownOpen: boolean;
  /** 设置下拉搜索浮框展开状态的回调 */
  setIsAddDropdownOpen: (val: boolean) => void;
  /** 设置保存轻量气泡提示文字的回调 */
  setSaveToast: (val: string | null) => void;
  /** 触发全局错误提示的回调 */
  triggerError: (msg: string) => void;
}

export function LedgerAddMaterialInlineForm({
  activeLedgerId,
  newMaterialName,
  setNewMaterialName,
  addMaterialSearchQuery,
  setAddMaterialSearchQuery,
  isAddDropdownOpen,
  setIsAddDropdownOpen,
  setSaveToast,
  triggerError
}: LedgerAddMaterialInlineFormProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterialName.trim()) return;
    
    // 从大字典拉出规格、单位并调用新增接口
    const dictItem = RawMaterialsDictService.getItems().find(d => d.name === newMaterialName);
    const unit = dictItem ? dictItem.unit : "斤";
    const spec = dictItem ? (dictItem.remark || "") : "";
    
    LedgerService.addLedgerItem(activeLedgerId, newMaterialName, unit, spec, 0)
      .then(() => {
        setNewMaterialName("");
        setAddMaterialSearchQuery("");
        setIsAddDropdownOpen(false);
        setSaveToast("成功新增台账原料行！");
        setTimeout(() => setSaveToast(null), 2000);
      })
      .catch((err) => triggerError(err.message));
  };

  return (
    <form 
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-2 md:p-3 relative add-material-search-container z-40"
    >
      <span className="text-[10px] text-slate-500 font-bold shrink-0">添加原料采购项:</span>
      
      {/* 相对定位输入容器，用来精准挂载悬浮框 */}
      <div className="relative min-w-[200px] flex-1 max-w-xs">
        <input
          type="text"
          placeholder="输入拼音/汉字进行联想匹配..."
          value={addMaterialSearchQuery}
          onFocus={() => setIsAddDropdownOpen(true)}
          onChange={(e) => {
            setAddMaterialSearchQuery(e.target.value);
            setIsAddDropdownOpen(true);
            // 如果用户清空了输入，重置选中项
            if (!e.target.value.trim()) {
              setNewMaterialName("");
            }
          }}
          className="bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs w-full outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 font-bold placeholder-slate-400"
          required
        />

        {/* 实时动态检索联想浮窗，显示在输入框的正下方 */}
        {isAddDropdownOpen && (
          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 py-1 scrollbar-thin">
            {(() => {
              const filtered = RawMaterialsDictService.getItems().filter((item) => 
                matchPinyin(item.name, addMaterialSearchQuery)
              );
              if (filtered.length === 0) {
                return <div className="p-2 text-[10px] text-slate-400 text-center font-bold">无匹配的字典原料</div>;
              }
              return filtered.map((item) => (
                <div
                  key={item.name}
                  onClick={() => {
                    setNewMaterialName(item.name);
                    setAddMaterialSearchQuery(item.name);
                    setIsAddDropdownOpen(false);
                  }}
                  className={`p-2 text-xs font-bold cursor-pointer transition-colors flex items-center justify-between ${
                    newMaterialName === item.name 
                      ? "bg-teal-50 text-teal-700" 
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span>{item.name}</span>
                  <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0 font-medium">
                    {item.unit} ({item.category})
                  </span>
                </div>
              ));
            })()}
          </div>
        )}
      </div>

      {newMaterialName && (
        <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 font-extrabold">
          已选: {newMaterialName}
        </span>
      )}
      
      <button
        type="submit"
        disabled={!newMaterialName}
        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 transition-colors shadow-xs"
      >
        添加
      </button>
      
      {(addMaterialSearchQuery || newMaterialName) && (
        <button
          type="button"
          onClick={() => {
            setAddMaterialSearchQuery("");
            setNewMaterialName("");
            setIsAddDropdownOpen(false);
          }}
          className="text-[10px] text-slate-400 hover:text-slate-600 underline font-bold cursor-pointer"
        >
          清空
        </button>
      )}
    </form>
  );
}
