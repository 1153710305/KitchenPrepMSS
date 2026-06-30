/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ledger, LedgerItem } from "../ledgerTypes.ts";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { AlertCircle } from "lucide-react";

interface LedgerPrintDocProps {
  /** 打印单据类型: "in" | "out" */
  printDocType: "in" | "out";
  /** 当前选定台账 */
  activeLedger: Ledger | null;
  /** 选定日期 */
  selectedDate: string;
  /** 当日有入库变动明细 */
  dailyInwardItems: any[];
  /** 当日有出库变动明细 */
  dailyOutwardItems: any[];
  /** 今日总入库金额 */
  dailyInTotalAmount: number;
  /** 关闭预览回调 */
  onClose: () => void;
}

/**
 * @description 老版本当日入库单/出库单物理凭证的纯净打印模板组件
 */
export function LedgerPrintDoc({
  printDocType,
  activeLedger,
  selectedDate,
  dailyInwardItems,
  dailyOutwardItems,
  dailyInTotalAmount,
  onClose
}: LedgerPrintDocProps) {
  const isPrintIn = printDocType === "in";
  const printItems = isPrintIn ? dailyInwardItems : dailyOutwardItems;

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-auto p-8 font-sans text-black leading-relaxed">
      {/* 顶部退出预览条 */}
      <div className="mb-6 flex justify-between items-center border-b border-gray-200 pb-4 print:hidden">
        <span className="text-sm text-gray-500 flex items-center gap-1.5">
          <AlertCircle size={16} />
          温馨提示：下方为打印纸质效果预览，请按 Ctrl + P / Cmd + P 确认打印。
        </span>
        <button 
          onClick={onClose}
          className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded cursor-pointer transition-all"
        >
          返回台账主页
        </button>
      </div>

      {/* 凭证大标题 */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-black tracking-widest border-b-2 border-black pb-2 inline-block">
          {activeLedger?.name}台账 —— 原料{isPrintIn ? "入库" : "出库"}单
        </h2>
        <div className="flex justify-between text-xs mt-3 px-1">
          <span>日期：<strong className="underline">{selectedDate}</strong></span>
          <span>台账类别：<strong className="underline">{activeLedger?.name}</strong></span>
          <span>单据编号：<strong className="underline font-mono">NO.{selectedDate.replace(/-/g, "")}{isPrintIn ? "01" : "02"}</strong></span>
        </div>
      </div>

      {/* 凭证明细表格 */}
      <table className="w-full text-left border-collapse border border-black text-xs mb-8">
        <thead>
          <tr className="bg-gray-100 text-center">
            <th className="border border-black px-2 py-2.5 w-12 font-bold">序号</th>
            <th className="border border-black px-3 py-2.5 font-bold">食品原材料品名</th>
            <th className="border border-black px-3 py-2.5 font-bold">规格描述</th>
            <th className="border border-black px-2 py-2.5 w-16 font-bold">单位</th>
            <th className="border border-black px-3 py-2.5 w-24 font-bold">{isPrintIn ? "今日入库数" : "今日出库数"}</th>
            {isPrintIn && (
              <>
                <th className="border border-black px-3 py-2.5 w-24 font-bold">单价(元)</th>
                <th className="border border-black px-3 py-2.5 w-28 font-bold">金额(元)</th>
              </>
            )}
            <th className="border border-black px-3 py-2.5 w-24 font-bold">发料出库人</th>
            <th className="border border-black px-3 py-2.5 w-24 font-bold">接收领料人</th>
            <th className="border border-black px-3 py-2.5 w-20 font-bold">食品索证</th>
            <th className="border border-black px-3 py-2.5 w-20 font-bold">感官性状</th>
            <th className="border border-black px-3 py-2.5 font-bold">备注说明/去处</th>
          </tr>
        </thead>
        <tbody>
          {printItems.length === 0 ? (
            <tr>
              <td colSpan={isPrintIn ? 11 : 9} className="border border-black text-center py-6 text-gray-500 italic">
                今日无{isPrintIn ? "入库" : "出库"}数据记录
              </td>
            </tr>
          ) : (
            printItems.map((item, index) => (
              <tr key={item.id} className="hover:bg-gray-50 text-center">
                <td className="border border-black px-2 py-2 font-mono">{index + 1}</td>
                <td className="border border-black px-3 py-2 text-left font-bold">
                  {(() => {
                    const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                    return dictItem ? dictItem.name : item.name;
                  })()}
                </td>
                <td className="border border-black px-3 py-2 text-left">
                  {(() => {
                    const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                    return (dictItem?.remark) || item.spec || "-";
                  })()}
                </td>
                <td className="border border-black px-2 py-2">
                  {(() => {
                    const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                    return dictItem ? dictItem.unit : item.unit;
                  })()}
                </td>
                <td className="border border-black px-3 py-2 text-right font-mono font-bold">
                  {isPrintIn ? item.record.inQuantity : item.record.outQuantity}
                </td>
                {isPrintIn && (
                  <>
                    <td className="border border-black px-3 py-2 text-right font-mono">¥{item.record.inPrice.toFixed(2)}</td>
                    <td className="border border-black px-3 py-2 text-right font-mono font-bold">¥{item.record.inAmount.toFixed(2)}</td>
                  </>
                )}
                <td className="border border-black px-3 py-2">{item.record.outHandler || item.record.buyer || "-"}</td>
                <td className="border border-black px-3 py-2">{item.record.outRecipient || item.record.inspector || "-"}</td>
                <td className="border border-black px-3 py-2">{item.record.certification || "-"}</td>
                <td className="border border-black px-3 py-2">{item.record.sensoryProperty || "-"}</td>
                <td className="border border-black px-3 py-2 text-left">{item.record.note || "-"}</td>
              </tr>
            ))
          )}
          
          {/* 入库单合计行 */}
          {isPrintIn && printItems.length > 0 && (
            <tr className="bg-gray-50">
              <td colSpan={5} className="border border-black px-3 py-2.5 font-bold text-center">合计金额 (大写)：{new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(dailyInTotalAmount)}</td>
              <td colSpan={1} className="border border-black px-3 py-2.5 font-bold text-right">小写合计:</td>
              <td className="border border-black px-3 py-2.5 text-right font-mono font-black text-sm text-red-600">
                ¥{dailyInTotalAmount.toFixed(2)}
              </td>
              <td colSpan={4} className="border border-black px-3 py-2"></td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 凭证签章栏 */}
      <div className="grid grid-cols-3 gap-4 text-xs mt-12 px-2">
        <div>
          <span>主管审核签字：____________________</span>
        </div>
        <div className="text-center">
          <span>出库发料人签字：____________________</span>
        </div>
        <div className="text-right">
          <span>接收领料人签字：____________________</span>
        </div>
      </div>
    </div>
  );
}
