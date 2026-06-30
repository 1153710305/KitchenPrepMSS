/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Award } from "lucide-react";
import { LedgerItem, DailyStockRecord } from "../ledgerTypes.ts";
import { LEDGER_UI_TEXT } from "../ledgerConstants.ts";

interface LedgerStyle2FlowProps {
  activeItemId: string | null;
  ledgerItems: LedgerItem[];
  dateParts: { year: number; month: number };
  selectedDate: string;
  isRecordingMode: boolean;
  draftRecords: Record<string, DailyStockRecord>;
  daysArray: string[];
  dailyStockBalances: Record<string, number>;
  handleDraftCellChange: (itemId: string, fields: Partial<DailyStockRecord>) => void;
}

export function LedgerStyle2Flow({
  activeItemId,
  ledgerItems,
  dateParts,
  selectedDate,
  isRecordingMode,
  draftRecords,
  daysArray,
  dailyStockBalances,
  handleDraftCellChange
}: LedgerStyle2FlowProps) {
  if (!activeItemId) {
    return (
      <div className="text-center py-12 bg-white border border-slate-200 rounded-xl text-slate-400 italic">
        该台账暂无采购原料项目。请点击右上方“新增原料采购项”添加原料以开启流水台账。
      </div>
    );
  }

  const activeItem = ledgerItems.find((i) => i.id === activeItemId);
  if (!activeItem) return null;

  // 提取当月有记录的供应商与索证，做成表头绑定
  const currentMonthStr = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}`;
  const sampleRecord = Object.entries(activeItem.dailyRecords).find(
    ([d, rec]) => d.startsWith(currentMonthStr) && (rec.supplier || rec.certification)
  )?.[1] || { supplier: "", certification: "" };

  const draftRecord = draftRecords[activeItem.id];
  const recordForSelectedDate = activeItem.dailyRecords[selectedDate] || { supplier: "", certification: "" };
  const currentSupplier = isRecordingMode ? (draftRecord?.supplier ?? "") : (recordForSelectedDate.supplier ?? sampleRecord.supplier ?? "");
  const currentCertification = isRecordingMode ? (draftRecord?.certification ?? "") : (recordForSelectedDate.certification ?? sampleRecord.certification ?? "");

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
      {/* 样式二表头与经销商信息 */}
      <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <span className="text-[11px] font-bold text-slate-400 block uppercase">采购项目</span>
          <div className="text-sm font-black text-slate-800 mt-1 flex items-center gap-1.5">
            <Award size={15} className="text-emerald-600" />
            {activeItem.name} ({activeItem.unit})
          </div>
        </div>
        
        <div>
          <span className="text-[11px] font-bold text-slate-400 block uppercase">经销商/供货商</span>
          <input 
            type="text"
            value={currentSupplier}
            placeholder={isRecordingMode ? LEDGER_UI_TEXT.defaultSupplierPlaceholder : "未开启录入"}
            disabled={!isRecordingMode}
            onChange={(e) => {
              handleDraftCellChange(activeItem.id, { supplier: e.target.value });
            }}
            className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2.5 py-1 mt-1 rounded text-xs outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <span className="text-[11px] font-bold text-slate-400 block uppercase">索证索票情况</span>
          <input 
            type="text"
            value={currentCertification}
            placeholder={isRecordingMode ? LEDGER_UI_TEXT.defaultCertificationPlaceholder : "未开启录入"}
            disabled={!isRecordingMode}
            onChange={(e) => {
              handleDraftCellChange(activeItem.id, { certification: e.target.value });
            }}
            className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2.5 py-1 mt-1 rounded text-xs outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* 月度流水网格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs min-w-[1000px]">
          <thead>
            <tr className="bg-slate-100/50 text-slate-500 border-b border-slate-200 text-center font-bold">
              <th className="px-4 py-2.5 font-bold w-28">日期</th>
              <th className="px-3 py-2.5 font-bold bg-emerald-50/20 w-24">采购数量</th>
              <th className="px-3 py-2.5 font-bold w-24">采购员</th>
              <th className="px-3 py-2.5 font-bold w-28">生产日期</th>
              <th className="px-3 py-2.5 font-bold w-24">保质期</th>
              <th className="px-3 py-2.5 font-bold w-24">感官性状</th>
              <th className="px-3 py-2.5 font-bold w-24">检验员</th>
              <th className="px-3 py-2.5 font-bold bg-indigo-50/10 w-24">出库数量</th>
              <th className="px-3 py-2.5 font-bold bg-slate-100/80 w-28">当日库存</th>
              <th className="px-3 py-2.5 font-bold w-24">保管员</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-center">
            {daysArray.map((dayStr) => {
              const dayDateStr = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${dayStr}`;
              const record = activeItem.dailyRecords[dayDateStr] || {
                inQuantity: 0, outQuantity: 0, buyer: "", inspector: "", keeper: "",
                produceDate: "", shelfLife: "", sensoryProperty: ""
              };
              const balance = dailyStockBalances[dayDateStr] ?? activeItem.initialStock;

              const isRowEditable = isRecordingMode && dayDateStr === selectedDate;
              const dRec = draftRecords[activeItem.id];
              const recordToRender = isRowEditable ? (dRec || {
                inQuantity: 0, outQuantity: 0, buyer: "", inspector: "", keeper: "",
                produceDate: "", shelfLife: "", sensoryProperty: ""
              }) : record;

              return (
                <tr key={dayDateStr} className={`hover:bg-slate-50/50 ${dayDateStr === selectedDate ? "bg-amber-50/20" : ""}`}>
                  <td className="px-4 py-2 font-mono text-slate-500 font-bold flex items-center justify-center gap-1">
                    <span>{dayDateStr}</span>
                    {dayDateStr === selectedDate && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" title="当前选中同步日"></span>
                    )}
                  </td>
                  
                  {/* 采购数量 */}
                  <td className="px-2 py-1.5 bg-emerald-50/10">
                    <input 
                      type="number" step="any"
                      value={recordToRender.inQuantity || ""}
                      placeholder={isRowEditable ? "0" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { inQuantity: Number(e.target.value) })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                    />
                  </td>
                  
                  {/* 采购员 */}
                  <td className="px-2 py-1.5">
                    <input 
                      type="text"
                      value={recordToRender.buyer || ""}
                      placeholder={isRowEditable ? "填采购员" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { buyer: e.target.value })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                    />
                  </td>

                  {/* 生产日期 */}
                  <td className="px-2 py-1.5">
                    <input 
                      type="text"
                      value={recordToRender.produceDate || ""}
                      placeholder={isRowEditable ? "生产日期" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { produceDate: e.target.value })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none font-mono"
                    />
                  </td>

                  {/* 保质期 */}
                  <td className="px-2 py-1.5">
                    <input 
                      type="text"
                      value={recordToRender.shelfLife || ""}
                      placeholder={isRowEditable ? "如: 12个月" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { shelfLife: e.target.value })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                    />
                  </td>

                  {/* 感官性状 */}
                  <td className="px-2 py-1.5">
                    <input 
                      type="text"
                      value={recordToRender.sensoryProperty || ""}
                      placeholder={isRowEditable ? "合格" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { sensoryProperty: e.target.value })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                    />
                  </td>

                  {/* 检验员 */}
                  <td className="px-2 py-1.5">
                    <input 
                      type="text"
                      value={recordToRender.inspector || ""}
                      placeholder={isRowEditable ? "填检验员" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { inspector: e.target.value })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                    />
                  </td>

                  {/* 出库数量 */}
                  <td className="px-2 py-1.5 bg-indigo-50/5">
                    <input 
                      type="number" step="any"
                      value={recordToRender.outQuantity || ""}
                      placeholder={isRowEditable ? "0" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { outQuantity: Number(e.target.value) })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                    />
                  </td>

                  {/* 当日库存/结余 (公式累算) */}
                  <td className="px-3 py-1.5 bg-slate-100/50 font-mono font-black text-slate-800 text-right">
                    {balance}
                  </td>

                  {/* 保管员 */}
                  <td className="px-2 py-1.5">
                    <input 
                      type="text"
                      value={recordToRender.keeper || ""}
                      placeholder={isRowEditable ? "保管签字" : "锁定"}
                      disabled={!isRowEditable}
                      onChange={(e) => handleDraftCellChange(activeItem.id, { keeper: e.target.value })}
                      className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
