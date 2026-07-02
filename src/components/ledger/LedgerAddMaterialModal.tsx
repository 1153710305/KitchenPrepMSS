/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { X } from "lucide-react";
import { SearchableSelect } from "../shared/SearchableSelect.tsx";

interface LedgerAddMaterialModalProps {
  isOpen: boolean;
  activeLedgerName: string;
  newMaterialName: string;
  newMaterialUnit: string;
  newMaterialSpec: string;
  newMaterialStock: number;
  dictOptions: Array<{ value: string; label: string; unit?: string; category?: string }>;
  setNewMaterialName: (val: string) => void;
  setNewMaterialUnit: (val: string) => void;
  setNewMaterialSpec: (val: string) => void;
  setNewMaterialStock: (val: number) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function LedgerAddMaterialModal({
  isOpen,
  activeLedgerName,
  newMaterialName,
  newMaterialUnit,
  newMaterialSpec,
  newMaterialStock,
  dictOptions,
  setNewMaterialName,
  setNewMaterialUnit,
  setNewMaterialSpec,
  setNewMaterialStock,
  onClose,
  onSubmit
}: LedgerAddMaterialModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[999]">
      <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-sm w-full p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-800">
            新增「{activeLedgerName}」台账原料采购项
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 block uppercase">原料名称 (必填)</label>
            <SearchableSelect
              options={dictOptions}
              value={newMaterialName}
              onChange={(val, opt) => {
                setNewMaterialName(val);
                if (opt && opt.unit) {
                  setNewMaterialUnit(opt.unit);
                }
              }}
              placeholder="请输入或选择原料，如: 土豆"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 block uppercase">计量单位</label>
            <input 
              type="text" placeholder="如: 斤 / 袋 / 箱" value={newMaterialUnit} onChange={(e) => setNewMaterialUnit(e.target.value)}
              className="w-full bg-slate-50 text-xs p-2.5 border border-slate-200 rounded outline-none focus:border-emerald-500 focus:bg-white" required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 block uppercase">规格描述</label>
            <input 
              type="text" placeholder="如: 25kg/袋" value={newMaterialSpec} onChange={(e) => setNewMaterialSpec(e.target.value)}
              className="w-full bg-slate-50 text-xs p-2.5 border border-slate-200 rounded outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 block uppercase">初始库存</label>
            <input 
              type="number" step="any" value={newMaterialStock} onChange={(e) => setNewMaterialStock(Number(e.target.value))}
              className="w-full bg-slate-50 text-xs p-2.5 border border-slate-200 rounded outline-none focus:border-emerald-500 focus:bg-white" required
            />
          </div>

          <button 
            type="submit"
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
          >
            确认添加
          </button>
        </form>
      </div>
    </div>
  );
}
