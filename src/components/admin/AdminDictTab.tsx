/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 管理后台"原料字典管理"Tab：提供全局原料大字典（名称/单位/所属大类/规格备注/换算比例）的搜索、新增、编辑与删除界面。
 */

import React, { useState } from "react";
import {
  FileSpreadsheet,
  Edit2,
  Trash2,
  Sparkles,
  ShieldAlert,
  Check,
  PlusCircle,
  Lock
} from "lucide-react";
import { RawMaterialsDictService, RawMaterialDictItem } from "../../services/rawMaterialDict.ts";
import { FoodCategory } from "../../types/types.ts";
import { matchPinyin } from "../../utils.ts";

interface AdminDictTabProps {
  activeCategoriesList: Array<{ key: string; label: string }>;
}

export function AdminDictTab({ activeCategoriesList }: AdminDictTabProps) {
  const [dictItems, setDictItems] = useState(() => RawMaterialsDictService.getItems());
  
  // Inputs
  const [dictNameInput, setDictNameInput] = useState<string>("");
  const [dictCategoryInput, setDictCategoryInput] = useState<FoodCategory>("VEGETABLE");
  const [dictUnitInput, setDictUnitInput] = useState<string>("斤");
  const [dictRemarkInput, setDictRemarkInput] = useState<string>("");
  const [dictConversionUnitInput, setDictConversionUnitInput] = useState<string>("");
  const [dictConversionRatioInput, setDictConversionRatioInput] = useState<string>("");
  
  // Editing state
  const [editingDictName, setEditingDictName] = useState<string | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);
  
  // Search state
  const [dictSearchQuery, setDictSearchQuery] = useState<string>("");
  const [dictSearchCategory, setDictSearchCategory] = useState<string>("ALL");

  const handleSaveDictSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDictError(null);

    const name = dictNameInput.trim();
    if (!name) {
      setDictError("原料名称不能为空！");
      return;
    }

    let conversionRatio: number | undefined = undefined;
    const rawRatio = dictConversionRatioInput.trim();
    if (rawRatio !== "" && rawRatio !== "NaN" && rawRatio !== "null") {
      const parsed = Number(rawRatio);
      if (isNaN(parsed)) {
        setDictError("换算比例必须是有效的数值！");
        return;
      }
      conversionRatio = parsed;
    }

    try {
      if (editingDictName) {
        await RawMaterialsDictService.updateMaterial(
          editingDictName,
          name,
          dictCategoryInput,
          dictUnitInput,
          dictRemarkInput.trim() || undefined,
          dictConversionUnitInput.trim() || undefined,
          conversionRatio
        );
      } else {
        await RawMaterialsDictService.addMaterial(
          name,
          dictCategoryInput,
          dictUnitInput,
          dictRemarkInput.trim() || undefined,
          dictConversionUnitInput.trim() || undefined,
          conversionRatio
        );
      }

      setDictItems([...RawMaterialsDictService.getItems()]);
      setDictNameInput("");
      setDictUnitInput("斤");
      setDictRemarkInput("");
      setDictConversionUnitInput("");
      setDictConversionRatioInput("");
      setDictCategoryInput("VEGETABLE");
      setEditingDictName(null);
    } catch (err: any) {
      setDictError(err.message || "保存原料时发生错误");
    }
  };

  const handleStartEditDict = (item: RawMaterialDictItem) => {
    setDictError(null);
    setEditingDictName(item.name);
    setDictNameInput(item.name);
    setDictCategoryInput(item.category);
    setDictUnitInput(item.unit);
    setDictRemarkInput(item.remark || "");
    setDictConversionUnitInput(item.conversionUnit || "");
    setDictConversionRatioInput(item.conversionRatio !== undefined && item.conversionRatio !== null ? String(item.conversionRatio) : "");
  };

  const handleDeleteDict = async (name: string) => {
    if (window.confirm(`确定要从核心字典库中永久删除原料「${name}」吗？（这不会影响已记录的台账历史，但以后新增时将无法联想）`)) {
      try {
        await RawMaterialsDictService.deleteMaterial(name);
        setDictItems([...RawMaterialsDictService.getItems()]);
        if (editingDictName === name) {
          setEditingDictName(null);
          setDictNameInput("");
          setDictUnitInput("斤");
          setDictRemarkInput("");
          setDictConversionUnitInput("");
          setDictConversionRatioInput("");
          setDictCategoryInput("VEGETABLE");
        }
      } catch (err: any) {
        alert(err.message || "删除失败");
      }
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center space-x-2.5">
            <FileSpreadsheet className="text-teal-600" size={18} />
            <h3 className="text-sm font-bold text-slate-900">核心原料库字典管理</h3>
          </div>
          <span className="text-[10px] bg-teal-50 text-teal-700 font-mono px-2 py-0.5 rounded-full font-extrabold">
            {dictItems.length} 项原料已注册
          </span>
        </div>

        {/* 原料字典检索查找面板 */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg mb-4 text-xs">
          <div className="flex items-center gap-1.5 min-w-[200px]">
            <span className="font-bold text-slate-500 shrink-0">原料名称查找:</span>
            <input
              type="text"
              placeholder="输入原料品名，如：大米"
              value={dictSearchQuery}
              onChange={(e) => setDictSearchQuery(e.target.value)}
              className="bg-white border border-slate-300 rounded px-2.5 py-1.5 w-full outline-none focus:border-teal-500 font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-500 shrink-0">按食材品类筛选:</span>
            <select
              value={dictSearchCategory}
              onChange={(e) => setDictSearchCategory(e.target.value)}
              className="bg-white border border-slate-300 rounded px-2.5 py-1.5 outline-none focus:border-teal-500 font-bold"
            >
              <option value="ALL">-- 全部品类 --</option>
              {activeCategoriesList.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.label} ({cat.key})
                </option>
              ))}
            </select>
          </div>
          
          {(dictSearchQuery || dictSearchCategory !== "ALL") && (
            <button
              onClick={() => {
                setDictSearchQuery("");
                setDictSearchCategory("ALL");
              }}
              className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded cursor-pointer transition-colors"
            >
              重置搜索
            </button>
          )}
        </div>

        {/* 原料卡片列表 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
          {dictItems
            .filter((item) => {
              const matchSearch = matchPinyin(item.name, dictSearchQuery);
              const matchCat = dictSearchCategory === "ALL" ? true : item.category === dictSearchCategory;
              return matchSearch && matchCat;
            })
            .map((item) => {
              const isUnderEdit = editingDictName === item.name;
              return (
                <div 
                  key={item.name}
                  className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-all ${
                    isUnderEdit 
                      ? "bg-teal-50/50 border-teal-300 shadow-xs" 
                      : "bg-slate-50 border-slate-150 hover:bg-slate-100"
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-extrabold text-slate-800 truncate flex items-center gap-1.5">
                      {item.name}
                      {item.isDefault && (
                        <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.2 rounded font-bold shrink-0" title="系统默认原料，不允许删除">
                          默认
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.2 rounded">
                        {item.unit}
                      </span>
                      <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.2 rounded font-medium">
                        {item.category}
                      </span>
                      {item.remark && (
                        <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.2 rounded font-bold border border-amber-200 max-w-[120px] truncate" title={item.remark}>
                          {item.remark}
                        </span>
                      )}
                      {item.conversionUnit && item.conversionRatio && (
                        <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.2 rounded font-bold border border-emerald-200">
                          换算: {item.conversionRatio}{item.conversionUnit}/{item.unit}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      onClick={() => handleStartEditDict(item)}
                      className="p-1 text-slate-500 hover:text-teal-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                      title="编辑原料"
                      disabled={isUnderEdit}
                    >
                      <Edit2 size={11} />
                    </button>
                    {item.isDefault ? (
                      <span className="p-1 text-slate-300 cursor-not-allowed" title="系统默认原料，不允许删除">
                        <Lock size={11} />
                      </span>
                    ) : (
                      <button
                        onClick={() => handleDeleteDict(item.name)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                        title="删除原料"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* 新增/编辑原料表单 */}
        <form onSubmit={handleSaveDictSubmit} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-3">
            <Sparkles size={13} className="text-teal-600" />
            {editingDictName ? "修改已有原料属性定义" : "增添全新食品与备品原料记录"}
          </h4>

          {dictError && (
            <div className="text-[11px] bg-rose-50 text-rose-600 p-2.5 rounded border border-rose-100 mb-3 flex items-center space-x-1.5">
              <ShieldAlert size={12} className="shrink-0" />
              <span>{dictError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">原料品名(如: 大米)</label>
              <input
                type="text"
                placeholder="如: 西蓝花"
                value={dictNameInput}
                onChange={(e) => setDictNameInput(e.target.value)}
                className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">所属二级食材大类</label>
              <select
                value={dictCategoryInput}
                onChange={(e) => setDictCategoryInput(e.target.value as FoodCategory)}
                className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
              >
                {activeCategoriesList.map((cat) => (
                  <option key={cat.key} value={cat.key}>
                    {cat.label} ({cat.key})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">默认单位(如: 袋/箱/瓶)</label>
              <input
                type="text"
                placeholder="如: 袋"
                value={dictUnitInput}
                onChange={(e) => setDictUnitInput(e.target.value)}
                className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">备注(规格，如: 25kg/袋)</label>
              <input
                type="text"
                placeholder="如: 25kg/袋"
                value={dictRemarkInput}
                onChange={(e) => setDictRemarkInput(e.target.value)}
                className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">换算单位(选填，如: 斤)</label>
              <input
                type="text"
                placeholder="如: 斤"
                value={dictConversionUnitInput}
                onChange={(e) => setDictConversionUnitInput(e.target.value)}
                className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">换算比例(选填，袋/箱折合数，如: 50)</label>
              <input
                type="number"
                step="any"
                placeholder="如: 50"
                value={dictConversionRatioInput}
                onChange={(e) => setDictConversionRatioInput(e.target.value)}
                className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end items-center mt-3.5 space-x-2">
            {editingDictName && (
              <button
                type="button"
                onClick={() => {
                  setEditingDictName(null);
                  setDictNameInput("");
                  setDictUnitInput("斤");
                  setDictRemarkInput("");
                  setDictConversionUnitInput("");
                  setDictConversionRatioInput("");
                  setDictCategoryInput("VEGETABLE");
                }}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs cursor-pointer font-bold transition-all"
              >
                取消编辑
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs cursor-pointer font-bold flex items-center space-x-1 shadow-sm"
            >
              {editingDictName ? <Check size={12} /> : <PlusCircle size={12} />}
              <span>{editingDictName ? "保存原料属性" : "添加至原料库"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
