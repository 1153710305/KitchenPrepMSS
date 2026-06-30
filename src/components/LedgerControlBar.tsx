/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  Play, 
  Check, 
  X, 
  Save, 
  Download, 
  Printer 
} from "lucide-react";
import { LedgerItem } from "../ledgerTypes.ts";
import { LedgerAddMaterialInlineForm } from "./LedgerAddMaterialInlineForm.tsx";

interface LedgerControlBarProps {
  activeTab: "entry" | "invoice";
  setActiveTab: (tab: "entry" | "invoice") => void;
  isRecordingMode: boolean;
  ledgerItems: LedgerItem[];
  activeItemId: string;
  setActiveItemId: (id: string) => void;
  currentLedgerItems: LedgerItem[];
  ledgerStyle: "style1" | "style2";
  dailyInwardItems: any[];
  dailyOutwardItems: any[];
  batchOutHandler: string;
  setBatchOutHandler: (val: string) => void;
  batchOutRecipient: string;
  setBatchOutRecipient: (val: string) => void;
  newMaterialName: string;
  setNewMaterialName: (val: string) => void;
  addMaterialSearchQuery: string;
  setAddMaterialSearchQuery: (val: string) => void;
  isAddDropdownOpen: boolean;
  setIsAddDropdownOpen: (val: boolean) => void;
  setSaveToast: (val: string | null) => void;
  triggerError: (msg: string) => void;
  handleStartRecording: () => void;
  handleConfirmRecording: () => void;
  handleCancelRecording: () => void;
  handleApplyBatchSignatures: () => void;
  handleExportInwardCsv: () => void;
  handleExportOutwardCsv: () => void;
  triggerPrintDoc: (type: "in" | "out") => void;
  setPrintModalOpen: (val: boolean) => void;
  setPrintPreviewStyle: (style: "style1" | "style2" | null) => void;
  activeLedgerId: string;
}

export function LedgerControlBar({
  activeTab,
  setActiveTab,
  isRecordingMode,
  ledgerItems,
  activeItemId,
  setActiveItemId,
  currentLedgerItems,
  ledgerStyle,
  dailyInwardItems,
  dailyOutwardItems,
  batchOutHandler,
  setBatchOutHandler,
  batchOutRecipient,
  setBatchOutRecipient,
  newMaterialName,
  setNewMaterialName,
  addMaterialSearchQuery,
  setAddMaterialSearchQuery,
  isAddDropdownOpen,
  setIsAddDropdownOpen,
  setSaveToast,
  triggerError,
  handleStartRecording,
  handleConfirmRecording,
  handleCancelRecording,
  handleApplyBatchSignatures,
  handleExportInwardCsv,
  handleExportOutwardCsv,
  triggerPrintDoc,
  setPrintModalOpen,
  setPrintPreviewStyle,
  activeLedgerId
}: LedgerControlBarProps) {
  return (
    <div className="px-4 py-2.5 bg-white border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setActiveTab("entry")}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
            activeTab === "entry" 
              ? "bg-slate-900 text-white shadow-sm" 
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          台账数据录入
        </button>
        <button
          onClick={() => setActiveTab("invoice")}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
            activeTab === "invoice" 
              ? "bg-slate-900 text-white shadow-sm" 
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          当日出入库单 (单据归集)
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {activeTab === "entry" ? (
          <>
            {/* 新增原料的下拉控制槽：不论是否开启录入模式均提供，允许随时添加原料 */}
            <LedgerAddMaterialInlineForm
              activeLedgerId={activeLedgerId}
              newMaterialName={newMaterialName}
              setNewMaterialName={setNewMaterialName}
              addMaterialSearchQuery={addMaterialSearchQuery}
              setAddMaterialSearchQuery={setAddMaterialSearchQuery}
              isAddDropdownOpen={isAddDropdownOpen}
              setIsAddDropdownOpen={setIsAddDropdownOpen}
              setSaveToast={setSaveToast}
              triggerError={triggerError}
            />

            <div className="h-4 w-px bg-slate-200 mx-1"></div>

            {/* 录入模式控制按钮 */}
            {!isRecordingMode ? (
              <>
                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-1 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                  title="开启今日数据记账，开启后支持双击单元格或点击编辑按钮进行数据填写"
                >
                  <Play size={13} fill="white" />
                  <span>开启今日录入</span>
                </button>

                <button 
                  onClick={() => {
                    if (ledgerStyle === "style2") {
                      setPrintPreviewStyle("style2");
                    } else {
                      setPrintModalOpen(true);
                    }
                  }}
                  disabled={ledgerItems.length === 0}
                  className="flex items-center gap-1 px-3.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
                >
                  <Printer size={13} className="text-slate-500" />
                  <span>打印登记表</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleConfirmRecording}
                  className="flex items-center gap-1 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-750 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                  title="确认并同步保存今日所有的采购入库及出库记录数据"
                >
                  <Check size={13} />
                  <span>保存并同步今日采购</span>
                </button>
                <button
                  onClick={handleCancelRecording}
                  className="flex items-center gap-1 px-3.5 py-1.5 bg-slate-500 hover:bg-slate-600 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                >
                  <Save size={13} />
                  <span>暂存本地并退出</span>
                </button>
              </>
            )}

            {/* 样式二的原料选择下拉框 */}
            {ledgerStyle === "style2" && currentLedgerItems.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-bold text-slate-500">采购项目:</span>
                <select
                  value={activeItemId}
                  onChange={(e) => setActiveItemId(e.target.value)}
                  className="bg-white border border-slate-200 px-2 py-1.5 rounded outline-none focus:border-emerald-500 text-xs"
                >
                  {currentLedgerItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 批量签字填充控制栏 */}
            <div className="flex items-center gap-1.5 border border-dashed border-emerald-300 rounded-lg p-1 bg-emerald-50/50">
              <input
                type="text"
                placeholder="批量填出库人"
                value={batchOutHandler}
                onChange={(e) => setBatchOutHandler(e.target.value)}
                className="bg-white text-[10px] px-2 py-1.5 rounded w-24 border border-slate-200 outline-none"
              />
              <input
                type="text"
                placeholder="批量填接收人"
                value={batchOutRecipient}
                onChange={(e) => setBatchOutRecipient(e.target.value)}
                className="bg-white text-[10px] px-2 py-1.5 rounded w-24 border border-slate-200 outline-none"
              />
              <button
                onClick={handleApplyBatchSignatures}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded cursor-pointer"
                title="一键将输入的出库人与接收人填充到今日所有发生出入库项目的签字栏上"
              >
                一键应用
              </button>
            </div>
            
            <div className="h-4 w-px bg-slate-200 mx-1"></div>

            <button
              onClick={handleExportInwardCsv}
              disabled={dailyInwardItems.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
            >
              <Download size={12} />
              <span>导出入库单</span>
            </button>
            <button
              onClick={() => triggerPrintDoc("in")}
              disabled={dailyInwardItems.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
            >
              <Printer size={12} />
              <span>打印入库单</span>
            </button>
            <div className="h-4 w-px bg-slate-200 mx-1"></div>
            <button
              onClick={handleExportOutwardCsv}
              disabled={dailyOutwardItems.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
            >
              <Download size={12} />
              <span>导出出库单</span>
            </button>
            <button
              onClick={() => triggerPrintDoc("out")}
              disabled={dailyOutwardItems.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
            >
              <Printer size={12} />
              <span>打印出库单</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
