/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertCircle } from "lucide-react";
import { Ledger, LedgerItem, FoodCategory } from "../ledgerTypes.ts";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { LedgerPrintStyle1 } from "./LedgerPrintStyle1.tsx";
import { LedgerPrintStyle2 } from "./LedgerPrintStyle2.tsx";

interface LedgerPrintPreviewOverlayProps {
  printPreviewStyle: "style1" | "style2";
  setPrintPreviewStyle: (val: null | "style1" | "style2") => void;
  activeLedger: Ledger | null;
  selectedDate: string;
  selectedPrintCategories: FoodCategory[];
  currentLedgerItems: LedgerItem[];
  activeItemId: string;
  ledgerItems: LedgerItem[];
  style2StartDate: string;
  style2EndDate: string;
  style2DatesArray: string[];
}

export function LedgerPrintPreviewOverlay({
  printPreviewStyle,
  setPrintPreviewStyle,
  activeLedger,
  selectedDate,
  selectedPrintCategories,
  currentLedgerItems,
  activeItemId,
  ledgerItems,
  style2StartDate,
  style2EndDate,
  style2DatesArray
}: LedgerPrintPreviewOverlayProps) {
  const isPrintStyle1 = printPreviewStyle === "style1";
  const dictItems = RawMaterialsDictService.getItems();

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-auto p-8 font-sans text-black leading-relaxed">
      {/* 顶部退出预览条 */}
      <div className="mb-6 flex justify-between items-center border-b border-gray-200 pb-4 print:hidden">
        <span className="text-sm text-gray-600 flex items-center gap-2">
          <AlertCircle size={16} className="text-amber-500" />
          <span className="font-bold">【打印预览模式】确认无误后请点击右侧“立即打印”，或按 Ctrl + P / Cmd + P 唤醒设备打印。</span>
        </span>
        <div className="flex gap-2">
          <button 
            onClick={() => window.print()}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded shadow cursor-pointer transition-all"
          >
            立即打印
          </button>
          <button 
            onClick={() => setPrintPreviewStyle(null)}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded shadow cursor-pointer transition-all"
          >
            返回系统
          </button>
        </div>
      </div>

      {isPrintStyle1 ? (
        <LedgerPrintStyle1
          activeLedger={activeLedger}
          selectedDate={selectedDate}
          selectedPrintCategories={selectedPrintCategories}
          currentLedgerItems={currentLedgerItems}
          dictItems={dictItems}
        />
      ) : (
        <LedgerPrintStyle2
          activeLedger={activeLedger}
          activeItemId={activeItemId}
          selectedDate={selectedDate}
          ledgerItems={ledgerItems}
          style2StartDate={style2StartDate}
          style2EndDate={style2EndDate}
          style2DatesArray={style2DatesArray}
        />
      )}
    </div>
  );
}
