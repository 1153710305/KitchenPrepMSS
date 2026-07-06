/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐采购细表的"单日聚焦卡片"视图：横向日期刻度盘选定某一天后，以卡片网格纵向展示该日所有食材的数量/单价/金额明细。
 */

import { PreparedItem } from "../../types/types.ts";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import type { ThemeStyle } from "../../hooks/useTableTheme.ts";

/**
 * @description TableGridFocusView 组件入参接口
 */
interface TableGridFocusViewProps {
  /** 当月包含的日期数组 (["1", "2", ..., "31"]) */
  days: string[];
  /** 经过筛选与台账对齐后的备餐明细项列表 */
  filteredItems: PreparedItem[];
  /** 每个日期(1-31号)在该类目下的总开销汇总 */
  dayTotals: Record<string, number>;
  /** 当前主题对应的完整样式类名映射 */
  activeTheme: ThemeStyle;
  /** 当前聚焦查看的日期 */
  focusDay: string;
  /** 切换聚焦日期的回调 */
  setFocusDay: (day: string) => void;
}

/**
 * @description 单日聚焦卡片视图组件
 */
export function TableGridFocusView({
  days,
  filteredItems,
  dayTotals,
  activeTheme,
  focusDay,
  setFocusDay
}: TableGridFocusViewProps) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs space-y-4">

      {/* 日期选择横轴 slider */}
      <div>
        <label className="text-[12px] font-bold text-gray-400 uppercase tracking-widest block mb-2.5">
          横向日历刻度盘 (聚焦今日并极速记账)：
        </label>
        <div className="flex gap-2 pb-3 overflow-x-auto scrollbar-thin">
          {days.map((day) => {
            const hasDataOnDay = dayTotals[day] > 0;
            const isSelected = focusDay === day;
            return (
              <button
                key={`focus-btn-${day}`}
                onClick={() => setFocusDay(day)}
                className={`px-3.5 py-2 shrink-0 rounded-xl text-[13px] font-semibold cursor-pointer transition-all border ${isSelected
                  ? `${activeTheme.primaryBg} text-white border-transparent shadow-md`
                  : hasDataOnDay
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : "bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100"
                  }`}
              >
                <div className="text-[11px] opacity-75 font-normal">周天</div>
                <div>{day}号</div>
                {hasDataOnDay && (
                  <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-1 ${isSelected ? "bg-white" : "bg-emerald-500"}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 当天聚焦记账盘 */}
      <div>
        <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <span className={`p-2 ${activeTheme.lightBg} ${activeTheme.primaryText} rounded-xl font-bold font-mono`}>
              {focusDay}号
            </span>
            <div>
              <h4 className="font-bold text-gray-800 text-[15px]">【{focusDay}号】耗粮记账明细</h4>
              <p className="text-[13px] text-gray-400">在该日期下，垂直修改所有原材料的价格与数量</p>
            </div>
          </div>


        </div>

        {/* 聚焦日卡片网络流 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const entry = item.dailyData[focusDay] || { quantity: 0, price: 0, amount: 0 };
            return (
              <div
                key={`focus-card-${item.id}`}
                className={`p-4 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50/20 to-white ${activeTheme.borderHover} transition-all flex flex-col justify-between group`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {(() => {
                      const dictItem = RawMaterialsDictService.getItems().find(d => d.name === item.name);
                      const displayName = dictItem ? dictItem.name : item.name;
                      const displayUnit = dictItem ? dictItem.unit : item.unit;
                      const displayRemark = dictItem?.remark || "";
                      return (
                        <>
                          <span className="text-[11px] text-gray-400 font-mono tracking-wider block">
                            原料项 / 单位：{displayUnit} {displayRemark && `(${displayRemark})`}
                          </span>
                          <h5 className="font-bold text-gray-800 text-[15px]">{displayName}</h5>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* 修改区 */}
                <div className="grid grid-cols-2 gap-3 mt-4 text-center">
                  <div className="bg-slate-50 p-2 rounded-lg">
                    <label className="text-[11px] text-slate-400 block mb-0.5 font-semibold">
                      备载数量 ({RawMaterialsDictService.getItems().find(d => d.name === item.name)?.unit || item.unit})
                    </label>
                    <span className="text-[13px] font-mono font-bold text-slate-700">{entry.quantity || 0}</span>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-lg">
                    <label className="text-[11px] text-slate-400 block mb-0.5 font-semibold">单价 (元)</label>
                    <span className="text-[13px] font-mono font-bold text-slate-700">¥{entry.price || 0}</span>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-gray-50 flex justify-between items-center text-[13px]">
                  <span className="text-gray-400">日结金额合计:</span>
                  <span className={`font-extrabold ${activeTheme.primaryText} font-mono`}>
                    ¥{entry.amount.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 今日总金额结算 */}
        <div className={`mt-4 p-3 ${activeTheme.lightBg} border border-slate-100 rounded-xl flex items-center justify-between text-[13px]`}>
          <span className="text-gray-500 font-medium">【{focusDay}号】单日大类累计消耗开支：</span>
          <span className={`text-lg font-extrabold ${activeTheme.primaryText} font-mono`}>
            ¥{dayTotals[focusDay].toFixed(2)} 元
          </span>
        </div>

      </div>

    </div>
  );
}
