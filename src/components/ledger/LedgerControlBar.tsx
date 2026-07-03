/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账系统顶部控制条组件：提供样式一/样式二显示切换、账期日期选择、今日录入模式的开启/确认/取消操作按钮，以及打印与导出入口。
 */

import {
  Play,
  Check,
  X,
  Save,
  Download,
  Printer,
  LayoutGrid,
  TrendingUp
} from "lucide-react";
import { LedgerItem } from "../../types/ledgerTypes.ts";

interface LedgerControlBarProps {
  activeTab: "entry" | "invoice";
  setActiveTab: (tab: "entry" | "invoice") => void;
  isRecordingMode: boolean;
  ledgerItems: LedgerItem[];
  activeItemId: string;
  setActiveItemId: (id: string) => void;
  currentLedgerItems: LedgerItem[];
  ledgerStyle: "style1" | "style2";
  setLedgerStyle: (style: "style1" | "style2") => void;
  dailyInwardItems: any[];
  dailyOutwardItems: any[];
  batchOutHandler: string;
  setBatchOutHandler: (val: string) => void;
  batchOutRecipient: string;
  setBatchOutRecipient: (val: string) => void;
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
  setLedgerStyle,
  dailyInwardItems,
  dailyOutwardItems,
  batchOutHandler,
  setBatchOutHandler,
  batchOutRecipient,
  setBatchOutRecipient,
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
    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-col gap-2 shrink-0 font-sans">
      {/* 顶层：页面 Tab 切换 + 核心说明 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center bg-slate-200/60 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab("entry")}
            className={`px-4.5 py-1.5 text-[13px] font-bold rounded-lg cursor-pointer transition-all ${
              activeTab === "entry"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            📊 台账数据录入
          </button>
          <button
            onClick={() => setActiveTab("invoice")}
            className={`px-4.5 py-1.5 text-[13px] font-bold rounded-lg cursor-pointer transition-all ${
              activeTab === "invoice"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            📋 当日出入库单归集
          </button>
        </div>

        {/* 状态贴心提示 */}
        <div className="text-[12px] text-slate-400 font-medium">
          {activeTab === "entry" ? (
            isRecordingMode ? (
              <span className="flex items-center gap-1.5 text-rose-500 font-semibold animate-pulse">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                台账录入编辑模式开启中，请记得同步保存
              </span>
            ) : "双击单元格或点击编辑可修改，台账实时自动同步服务器"
          ) : "当日出入库单的集中归集、签字登记和打印单据"}
        </div>
      </div>

      {/* 下层：基于不同 Tab 展示专享的高逻辑操作台 */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-2.5 rounded-xl border border-slate-200/80">
        {activeTab === "entry" ? (
          <div className="flex flex-wrap items-center gap-3 w-full">
            {/* 呈现样式选择：置于最左侧，先选好看哪种表再操作，逻辑顺序更清晰 */}
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 order-0 shrink-0">
              <button
                onClick={() => setLedgerStyle("style1")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[12px] font-bold rounded-md cursor-pointer transition-all ${
                  ledgerStyle === "style1"
                    ? "bg-white text-emerald-700 shadow-xs"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <LayoutGrid size={11} />
                <span>总表模式 (图一)</span>
              </button>
              <button
                onClick={() => setLedgerStyle("style2")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[12px] font-bold rounded-md cursor-pointer transition-all ${
                  ledgerStyle === "style2"
                    ? "bg-white text-emerald-700 shadow-xs"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <TrendingUp size={11} />
                <span>单原料日流水 (图二)</span>
              </button>
            </div>

            {/* 记账行为控制：紧随呈现样式选择之后，方便用户第一眼定位 */}
            <div className="flex items-center gap-2 order-1">
              {!isRecordingMode ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-black rounded-lg cursor-pointer transition-all shadow-md shadow-emerald-50 hover:scale-[1.02]"
                    title="开启今日数据记账"
                  >
                    <Play size={13} fill="currentColor" />
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
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-[13px] font-bold rounded-lg cursor-pointer transition-all"
                  >
                    <Printer size={13} className="text-slate-500" />
                    <span>打印记账登记表</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleConfirmRecording}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-[13px] font-black rounded-lg cursor-pointer transition-all shadow-md shadow-teal-50 hover:scale-[1.02]"
                    title="保存今日修改"
                  >
                    <Check size={13} className="stroke-[3]" />
                    <span>保存并同步今日采购</span>
                  </button>
                  <button
                    onClick={handleCancelRecording}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-500 hover:bg-slate-600 text-white text-[13px] font-medium rounded-lg cursor-pointer transition-all"
                  >
                    <Save size={13} />
                    <span>暂存退出</span>
                  </button>
                </>
              )}
            </div>

            {/* 辅助筛选：仅样式二（单原料日流水）显示当前聚焦的采购项目切换，跟随在主操作按钮之后 */}
            {ledgerStyle === "style2" && currentLedgerItems.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100 text-[13px] order-2">
                <span className="font-bold text-slate-500 shrink-0">采购项目:</span>
                <select
                  value={activeItemId}
                  onChange={(e) => setActiveItemId(e.target.value)}
                  className="bg-transparent outline-none cursor-pointer font-bold text-slate-700 max-w-[120px]"
                >
                  {currentLedgerItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between w-full gap-3">
            {/* 左侧：签字快捷栏 (边框虚线美化，逻辑清晰) */}
            <div className="flex items-center gap-2 bg-emerald-50/60 border border-emerald-100 rounded-xl p-1.5">
              <span className="text-[11px] text-emerald-800 font-extrabold px-1 shrink-0">签字填充:</span>
              <input
                type="text"
                placeholder="出库人姓名"
                value={batchOutHandler}
                onChange={(e) => setBatchOutHandler(e.target.value)}
                className="bg-white text-[13px] px-2 py-1.5 rounded-lg w-24 border border-slate-200 outline-none focus:border-emerald-500 transition-colors"
              />
              <input
                type="text"
                placeholder="接收人姓名"
                value={batchOutRecipient}
                onChange={(e) => setBatchOutRecipient(e.target.value)}
                className="bg-white text-[13px] px-2 py-1.5 rounded-lg w-24 border border-slate-200 outline-none focus:border-emerald-500 transition-colors"
              />
              <button
                onClick={handleApplyBatchSignatures}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-black rounded-lg cursor-pointer transition-colors shadow-xs"
                title="批量将出库人和接收人应用到今日所有出库记录中"
              >
                一键应用
              </button>
            </div>

            {/* 右侧：单据的导入和打印，以入库和出库色块逻辑分开 */}
            <div className="flex flex-wrap items-center gap-3">
              {/* 入库单板块：绿色系 */}
              <div className="flex items-center gap-1.5 bg-slate-50/80 p-1.5 rounded-xl border border-slate-200/60">
                <span className="text-[11px] text-slate-500 font-extrabold px-1">入库管理:</span>
                <button
                  onClick={handleExportInwardCsv}
                  disabled={dailyInwardItems.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-[13px] font-bold rounded-lg cursor-pointer transition-all font-sans"
                >
                  <Download size={12} />
                  <span>导出</span>
                </button>
                <button
                  onClick={() => triggerPrintDoc("in")}
                  disabled={dailyInwardItems.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100/70 border border-teal-100 disabled:opacity-40 text-teal-700 text-[13px] font-bold rounded-lg cursor-pointer transition-all"
                >
                  <Printer size={12} />
                  <span>打印入库单</span>
                </button>
              </div>

              {/* 出库单板块：蓝色系 */}
              <div className="flex items-center gap-1.5 bg-slate-50/80 p-1.5 rounded-xl border border-slate-200/60">
                <span className="text-[11px] text-slate-500 font-extrabold px-1">出库管理:</span>
                <button
                  onClick={handleExportOutwardCsv}
                  disabled={dailyOutwardItems.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-[13px] font-bold rounded-lg transition-all font-sans"
                >
                  <Download size={12} />
                  <span>导出</span>
                </button>
                <button
                  onClick={() => triggerPrintDoc("out")}
                  disabled={dailyOutwardItems.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-sky-50 hover:bg-sky-100/70 border border-sky-100 disabled:opacity-40 text-sky-700 text-[13px] font-bold rounded-lg cursor-pointer transition-all"
                >
                  <Printer size={12} />
                  <span>打印出库单</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
