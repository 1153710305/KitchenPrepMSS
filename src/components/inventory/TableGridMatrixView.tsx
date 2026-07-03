/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐采购细表的"EXCEL 日历总矩阵"视图：以横向 31 天为列、纵向食材为行的大宽表形式展示每日数量/单价/金额，并在表底汇总每日与全月开销。
 */

import React from "react";
import { FoodCategory, PreparedItem } from "../../types/types.ts";
import { PrepReportService } from "../../services/store.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { getItemMonthlySummary } from "../../utils.ts";
import { Trash } from "lucide-react";
import type { ThemeStyle } from "../../hooks/useTableTheme.ts";

/**
 * @description TableGridMatrixView 组件入参接口
 */
interface TableGridMatrixViewProps {
  /** 当月包含的日期数组 (["1", "2", ..., "31"]) */
  days: string[];
  /** 经过筛选与台账对齐后的备餐明细项列表 */
  filteredItems: PreparedItem[];
  /** 每个日期(1-31号)在该类目下的总开销汇总 */
  dayTotals: Record<string, number>;
  /** 当前主题对应的完整样式类名映射 */
  activeTheme: ThemeStyle;
  /** 当前激活的食材二级分类 */
  selectedCategory: FoodCategory | null;
  /** 是否为只读模式（只读模式下隐藏删除按钮） */
  readOnly: boolean;
  /** 删除特定食材行的操作回调 */
  onDeleteItem: (itemId: string) => void;
}

/**
 * @description EXCEL 日历总矩阵大宽表视图组件
 */
export function TableGridMatrixView({
  days,
  filteredItems,
  dayTotals,
  activeTheme,
  selectedCategory,
  readOnly,
  onDeleteItem
}: TableGridMatrixViewProps) {
  return (
    // 允许用户手动向右拖拽右下角把整张细表拉宽，避免默认宽度下单元格挤在一起看不清；min-width 保证不会被拖得比容器还窄
    <div className="resize-x overflow-auto" style={{ minWidth: "100%" }}>
      <p className="text-[11px] text-gray-400 mb-1.5 select-none">提示：可拖动表格右下角 ⤡ 手动调整宽度，方便查看密集的每日数据</p>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
        <table className="w-full border-collapse text-left text-[13px] text-gray-500">
          <thead className="bg-gray-50/75 text-gray-600 text-[12px] font-semibold">
            {/* 一级头: 日期编号号 */}
            <tr>
              <th className="p-3 border-b border-r border-slate-400 sticky left-0 bg-gray-50 min-w-[124px] z-20">日期/品类</th>
              {days.map((day) => (
                <th
                  key={`col-day-${day}`}
                  colSpan={3}
                  className={`px-2 py-1.5 text-center border-b border-r border-slate-400 ${activeTheme.lightBg} ${activeTheme.primaryText}`}
                >
                  <div className="flex items-center justify-center">
                    <span>{day}号</span>
                  </div>
                </th>
              ))}
              <th colSpan={2} className="p-3 text-center border-b border-slate-400 bg-indigo-100 text-indigo-900 font-extrabold">全月累加</th>
            </tr>

            {/* 二级头: [数量/单价/金额] 三胞胎 */}
            <tr className="bg-slate-100 text-[11px] text-slate-700 font-bold border-b border-slate-400">
              <th className="p-2.5 border-b border-r border-slate-400 sticky left-0 bg-slate-100 z-20">食材细分项目</th>
              {days.map((day) => (
                <React.Fragment key={`sub-dt-${day}`}>
                  <th className="px-1 py-1 text-center border-b border-r border-slate-400 font-semibold bg-slate-100/70 text-slate-800">数量</th>
                  <th className="px-1 py-1 text-center border-b border-r border-slate-400 font-semibold bg-slate-100/50 text-slate-800">单价</th>
                  <th className={`px-1 py-1 text-center border-b border-r border-slate-400 font-black ${activeTheme.primaryText} ${activeTheme.lightBg}`}>金额</th>
                </React.Fragment>
              ))}
              <th className="p-2 text-center border-b border-r border-slate-400 font-bold bg-slate-100 text-slate-800">月总用量</th>
              <th className="p-2 text-center border-b border-r border-slate-400 font-black text-indigo-900 bg-indigo-100">月总开销</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-400">
            {filteredItems.map((item) => {
              const monthlySummary = getItemMonthlySummary(item, days);
              return (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors border-b border-slate-400">

                  {/* 粘性冷冻首列：细分菜名，高负荷滑动不丢失行上下文 */}
                  <td className="p-3 sticky left-0 bg-white border-r-2 border-slate-400 z-10 font-extrabold text-slate-900 flex justify-between items-center group/cell min-w-[150px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                    <span className="truncate max-w-[110px] text-[13px] font-bold" title={item.name}>
                      {(() => {
                        const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                        const displayName = dictItem ? dictItem.name : item.name;
                        const displayUnit = dictItem ? dictItem.unit : item.unit;
                        const displayRemark = dictItem?.remark || "";
                        return (
                          <>
                            <span className="text-slate-900 text-[13px] font-black">{displayName}</span>
                            <span className="text-[11px] font-bold text-slate-600 block mt-0.5">
                              单位: {displayUnit} {displayRemark && `(${displayRemark})`}
                            </span>
                          </>
                        );
                      })()}
                    </span>

                    {/* 悬浮删除原料项按钮（只读模式下隐藏，防止在餐位分组页误删） */}
                    {!readOnly && (
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        className="opacity-0 group-hover/cell:opacity-100 p-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg cursor-pointer transition-all shrink-0 ml-1.5"
                        title="删除此原料行"
                      >
                        <Trash size={12} />
                      </button>
                    )}
                  </td>

                  {/* 渲染31天每日录入小卡格 */}
                  {days.map((day) => {
                    const entry = item.dailyData[day] || { quantity: 0, price: 0, amount: 0 };
                    return (
                      <React.Fragment key={`cell-${item.id}-${day}`}>
                        <td className="p-1.5 border-b border-r border-slate-400 text-center font-mono text-[13px] font-semibold text-slate-900 bg-white">
                          {entry.quantity || 0}
                        </td>
                        <td className="p-1.5 border-b border-r border-slate-400 text-center font-mono text-[13px] font-semibold text-slate-900 bg-slate-50">
                          ¥{entry.price || 0}
                        </td>
                        <td className={`p-1.5 border-b border-r border-slate-400 text-center text-[13px] font-black font-mono ${activeTheme.primaryText} ${activeTheme.lightBg}`}>
                          {entry.amount > 0 ? `¥${entry.amount}` : "0"}
                        </td>
                      </React.Fragment>
                    );
                  })}

                  {/* 全月累加列 */}
                  <td className="p-2.5 border-r border-slate-400 text-center font-black font-mono text-[13px] text-slate-900 bg-slate-100/60">
                    {monthlySummary.totalQty} {item.unit}
                  </td>
                  <td className="p-2.5 text-center font-black font-mono text-[13px] text-indigo-950 bg-indigo-100/50">
                    ¥{monthlySummary.totalCost}
                  </td>

                </tr>
              );
            })}

            {/* 表底累加汇总：各单日大类整体耗资 */}
            <tr className="bg-slate-200 font-extrabold text-slate-900 border-t-2 border-slate-400">
              <td className="p-3 sticky left-0 bg-slate-200 text-slate-900 border-r border-slate-400 font-black shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)] text-[13px]">
                【{PrepReportService.getActiveCategories().find(c => c.key === selectedCategory)?.label || selectedCategory}】每日开支合计
              </td>
              {days.map((day) => (
                <React.Fragment key={`tot-cell-${day}`}>
                  <td colSpan={2} className="px-1 py-3 text-[11px] text-slate-500 text-center font-bold uppercase">合计金额:</td>
                  <td className={`px-1 py-3 text-center text-[13px] font-black border-r border-slate-400 ${activeTheme.accentText} ${activeTheme.accentBg} font-mono`}>
                    ¥{dayTotals[day]}
                  </td>
                </React.Fragment>
              ))}
              <th colSpan={2} className="p-3 text-center text-indigo-950 bg-indigo-200/50 font-black text-[13px]">
                ¥{Math.round(Object.values(dayTotals).reduce((s, v) => s + v, 0) * 100) / 100}
              </th>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
