/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Bookmark, Check, X } from "lucide-react";
import { Ledger } from "../ledgerTypes.ts";
import { LEDGER_UI_TEXT } from "../ledgerConstants.ts";

interface LedgerSidebarProps {
  ledgers: Ledger[];
  activeLedgerId: string;
  renameLedgerId: string | null;
  renameLedgerName: string;
  setActiveLedgerId: (id: string) => void;
  setRenameLedgerName: (name: string) => void;
  setRenameLedgerId: (id: string | null) => void;
  handleRenameLedgerSubmit: (e: React.FormEvent) => void;
}

export function LedgerSidebar({
  ledgers,
  activeLedgerId,
  renameLedgerId,
  renameLedgerName,
  setActiveLedgerId,
  setRenameLedgerName,
  setRenameLedgerId,
  handleRenameLedgerSubmit
}: LedgerSidebarProps) {
  return (
    <div className="w-full lg:w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
          {LEDGER_UI_TEXT.listTitle}
        </span>
        <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-bold">
          {ledgers.length}个台账
        </span>
      </div>

      {/* 台账名录列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {ledgers.map((ledger) => {
          const isSelected = activeLedgerId === ledger.id;
          const isEditing = renameLedgerId === ledger.id;

          return (
            <div 
              key={ledger.id}
              className={`group flex items-center justify-between p-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                isSelected 
                  ? "bg-emerald-50 text-emerald-700 font-bold border-l-4 border-emerald-500" 
                  : "text-slate-600 hover:bg-slate-50 border-l-4 border-transparent"
              }`}
              onClick={() => {
                if (!isEditing) {
                  setActiveLedgerId(ledger.id);
                }
              }}
            >
              {isEditing ? (
                <form 
                  onSubmit={handleRenameLedgerSubmit}
                  className="flex items-center gap-1.5 w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input 
                    type="text"
                    value={renameLedgerName}
                    onChange={(e) => setRenameLedgerName(e.target.value)}
                    className="flex-1 bg-white border border-emerald-400 px-1.5 py-0.5 rounded text-[11px] outline-none"
                    autoFocus
                    required
                  />
                  <button type="submit" className="p-1 text-emerald-600 hover:text-emerald-700">
                    <Check size={12} />
                  </button>
                  <button type="button" onClick={() => setRenameLedgerId(null)} className="p-1 text-slate-400">
                    <X size={12} />
                  </button>
                </form>
              ) : (
                <>
                  <span className="truncate flex items-center gap-1.5">
                    <Bookmark size={12} className={isSelected ? "text-emerald-600" : "text-slate-400"} />
                    {ledger.name}台账
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 提示信息：新增/修改台账受众请前往管理后台 */}
      <div className="p-3 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 leading-normal text-center">
        注：如需增加、删除或重命名台账受众，请在系统登录后前往管理配置后台进行维护。
      </div>
    </div>
  );
}
