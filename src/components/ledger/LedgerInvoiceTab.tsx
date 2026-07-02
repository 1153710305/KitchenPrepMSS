/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 台账"当日出入库单归集"Tab：按当前选定日期汇总展示所有有出入库变动的原料清单，便于统一核对当日采购与出库记录。
 */

import { DailyStockRecord } from "../../types/ledgerTypes.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";

/**
 * @description 当日出入库单组件入参接口
 */
interface LedgerInvoiceTabProps {
  /** 当日有入库行为的原料采购项列表 */
  dailyInwardItems: Array<{
    /** 原料项目ID */
    id: string;
    /** 原料名称 */
    name: string;
    /** 原料规格 */
    spec: string;
    /** 计量单位 */
    unit: string;
    /** 当日收支明细记录 */
    record: DailyStockRecord;
  }>;
  /** 当日有出库行为的原料列表 */
  dailyOutwardItems: Array<{
    /** 原料项目ID */
    id: string;
    /** 原料名称 */
    name: string;
    /** 原料规格 */
    spec: string;
    /** 计量单位 */
    unit: string;
    /** 当日收支明细记录 */
    record: DailyStockRecord;
  }>;
  /** 当日总入库金额 */
  dailyInTotalAmount: number;
}

export function LedgerInvoiceTab({
  dailyInwardItems,
  dailyOutwardItems,
  dailyInTotalAmount
}: LedgerInvoiceTabProps) {
  return (
    <div className="space-y-6">
      
      {/* 今日入库单 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="border-b border-slate-100 pb-3 mb-4 flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            当日入库明细单 (有入库行为)
          </h3>
          <span className="text-[11px] font-mono text-slate-500 font-bold">
            入库金额合计：<span className="text-xs text-red-600 font-black">¥{dailyInTotalAmount.toFixed(2)}</span>
          </span>
        </div>

        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-center">
              <th className="px-3 py-2 w-12 font-bold">序号</th>
              <th className="px-3 py-2 text-left font-bold">原料名称</th>
              <th className="px-3 py-2 text-left font-bold">规格描述</th>
              <th className="px-2 py-2 w-16 font-bold">单位</th>
              <th className="px-3 py-2 w-24 font-bold">今日入库数</th>
              <th className="px-3 py-2 w-24 font-bold">入库单价</th>
              <th className="px-3 py-2 w-28 font-bold">入库总金额</th>
              <th className="px-3 py-2 w-24 font-bold">出库发料人</th>
              <th className="px-3 py-2 w-24 font-bold">接收领料人</th>
              <th className="px-3 py-2 w-20 font-bold">食品索证</th>
              <th className="px-3 py-2 w-20 font-bold">感官性状</th>
              <th className="px-3 py-2 text-left">备注说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 text-center">
            {dailyInwardItems.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center py-6 text-slate-400 italic">
                  今日该台账暂无任何原料入库记录数据。
                </td>
              </tr>
            ) : (
              dailyInwardItems.map((item, index) => (
                <tr key={item.id} className="hover:bg-slate-50/30">
                  <td className="px-3 py-2 font-mono text-slate-400">{index + 1}</td>
                  <td className="px-3 py-2 font-bold text-slate-800 text-left">
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      return dictItem ? dictItem.name : item.name;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-left">
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      return (dictItem?.remark) || item.spec || "-";
                    })()}
                  </td>
                  <td className="px-2 py-2 text-slate-500">
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      return dictItem ? dictItem.unit : item.unit;
                    })()}
                  </td>
                  <td className="px-3 py-2 font-mono font-bold text-slate-800">{item.record.inQuantity}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">¥{item.record.inPrice.toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald-800">¥{item.record.inAmount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.outHandler || item.record.buyer || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.outRecipient || item.record.inspector || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.certification || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.sensoryProperty || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 text-left">{item.record.note || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 今日出库单 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="border-b border-slate-100 pb-3 mb-4">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
            当日出库明细单 (有领用出库行为)
          </h3>
        </div>

        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-center">
              <th className="px-3 py-2 w-12 font-bold">序号</th>
              <th className="px-3 py-2 text-left font-bold">原料名称</th>
              <th className="px-3 py-2 text-left font-bold">规格描述</th>
              <th className="px-2 py-2 w-16 font-bold">单位</th>
              <th className="px-3 py-2 w-24 font-bold">今日出库数</th>
              <th className="px-3 py-2 w-28 font-bold">发料出库人</th>
              <th className="px-3 py-2 w-28 font-bold">领用接收人</th>
              <th className="px-3 py-2 w-20 font-bold">食品索证</th>
              <th className="px-3 py-2 w-20 font-bold">感官性状</th>
              <th className="px-3 py-2 text-left">领用去处/备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 text-center">
            {dailyOutwardItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-6 text-slate-400 italic">
                  今日该台账暂无任何原料领用出库记录。
                </td>
              </tr>
            ) : (
              dailyOutwardItems.map((item, index) => (
                <tr key={item.id} className="hover:bg-slate-50/30">
                  <td className="px-3 py-2 font-mono text-slate-400">{index + 1}</td>
                  <td className="px-3 py-2 font-bold text-slate-800 text-left">
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      return dictItem ? dictItem.name : item.name;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-left">
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      return (dictItem?.remark) || item.spec || "-";
                    })()}
                  </td>
                  <td className="px-2 py-2 text-slate-500">
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      return dictItem ? dictItem.unit : item.unit;
                    })()}
                  </td>
                  <td className="px-3 py-2 font-mono font-bold text-slate-800">{item.record.outQuantity}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.outHandler || ""}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.outRecipient || ""}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.certification || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{item.record.sensoryProperty || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 text-left">{item.record.note || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
