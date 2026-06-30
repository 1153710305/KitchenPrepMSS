/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FoodCategory, Ledger, LedgerItem } from "../ledgerTypes.ts";
import { FOOD_CATEGORY_LABELS } from "../constants.ts";

interface LedgerPrintStyle1Props {
  /** 当前选中的台账 */
  activeLedger: Ledger | null;
  /** 选定的日期 */
  selectedDate: string;
  /** 勾选的分类 */
  selectedPrintCategories: FoodCategory[];
  /** 当前台账的全部原料项 */
  currentLedgerItems: LedgerItem[];
  /** 从字典服务获取的所有原料项目快照 */
  dictItems: any[];
}

/**
 * @description 【图一】购销总表打印预览模板组件
 */
export function LedgerPrintStyle1({
  activeLedger,
  selectedDate,
  selectedPrintCategories,
  currentLedgerItems,
  dictItems
}: LedgerPrintStyle1Props) {
  // 根据用户勾选的二级分类过滤打印原料
  const toPrintItems = currentLedgerItems.filter((item) => {
    const dictItem = dictItems.find(d => d.name === item.name);
    return dictItem && selectedPrintCategories.includes(dictItem.category);
  });

  return (
    <div>
      {/* 大标题 */}
      <div className="text-center mb-0">
        <h2 className="text-xl font-black tracking-widest py-3 border border-black border-b-0 inline-block w-full">
          {activeLedger?.name}食堂食品原材料购销台账
        </h2>
      </div>

      {/* 主表格 */}
      <table className="w-full border-collapse border border-black text-[11px] text-center" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "14%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>

        <thead>
          <tr className="font-bold bg-gray-50">
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">食品原材料名称</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">数量</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">食品索证</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">感官性状</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">供货商<br/>及地址</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">采购时间</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">采购员</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">检验员</th>
            <th colSpan={2} className="border border-black px-1 py-1 align-middle">出入库时间</th>
            <th rowSpan={2} className="border border-black px-1 py-2 align-middle">保管员</th>
          </tr>
          <tr className="font-bold bg-gray-50">
            <th className="border border-black px-1 py-1 align-middle">入库</th>
            <th className="border border-black px-1 py-1 align-middle">出库</th>
          </tr>
        </thead>

        <tbody>
          {toPrintItems.length === 0 ? (
            <tr>
              <td colSpan={11} className="border border-black py-10 text-gray-400 italic text-xs">
                当前选定分类下无任何原料明细记录
              </td>
            </tr>
          ) : (
            toPrintItems.map((item) => {
              const record = item.dailyRecords[selectedDate] || {
                inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0,
                certification: "", sensoryProperty: "", supplier: "",
                purchaseDate: "", buyer: "", inspector: "", keeper: "", outDate: ""
              };

              return (
                <tr key={item.id} style={{ height: "28px" }}>
                  <td className="border border-black px-1 py-1 text-left font-bold">{item.name}</td>
                  <td className="border border-black px-1 py-1 font-mono">
                    {record.inQuantity > 0 ? record.inQuantity : ""}
                  </td>
                  <td className="border border-black px-1 py-1">{record.certification || ""}</td>
                  <td className="border border-black px-1 py-1">{record.sensoryProperty || ""}</td>
                  <td className="border border-black px-1 py-1 text-left">{record.supplier || ""}</td>
                  <td className="border border-black px-1 py-1 font-mono text-[10px]">
                    {record.inQuantity > 0 ? (record.purchaseDate || selectedDate) : ""}
                  </td>
                  <td className="border border-black px-1 py-1">{record.buyer || ""}</td>
                  <td className="border border-black px-1 py-1">{record.inspector || ""}</td>
                  <td className="border border-black px-1 py-1 font-mono text-[10px]">
                    {record.inQuantity > 0 ? (record.purchaseDate || selectedDate) : ""}
                  </td>
                  <td className="border border-black px-1 py-1 font-mono text-[10px]">
                    {record.outQuantity > 0 ? (record.outDate || selectedDate) : ""}
                  </td>
                  <td className="border border-black px-1 py-1">{record.keeper || ""}</td>
                </tr>
              );
            })
          )}

          {/* 补充空行（最少 15 行） */}
          {(() => {
            const filledCount = toPrintItems.length;
            const emptyRows = Math.max(0, 15 - filledCount);
            return Array.from({ length: emptyRows }).map((_, i) => (
              <tr key={`empty-${i}`} style={{ height: "28px" }}>
                {Array.from({ length: 11 }).map((_, j) => (
                  <td key={j} className="border border-black"></td>
                ))}
              </tr>
            ));
          })()}
        </tbody>
      </table>

      {/* 底部签字栏 */}
      <div className="flex justify-between text-xs mt-4 px-1 print:mt-6">
        <span>主管审核：____________________</span>
        <span>打印日期：{selectedDate}</span>
      </div>
    </div>
  );
}
