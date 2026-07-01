/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from "react";
import { GroupMonthlyReport, FoodCategory } from "../types.ts";
import { PrepReportService } from "../store.ts";
import { UI_TEXT } from "../constants.ts";
import { getDaysInMonth, getItemMonthlySummary } from "../utils.ts";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  Legend
} from "recharts";
import { TrendingUp, DollarSign, PieChart, ShoppingBag, ArrowUpRight, Award } from "lucide-react";

/**
 * @description 成本统计面板输入属性接口
 */
interface StatisticsPanelProps {
  /** 当前选定受众的月度账目报表 */
  report: GroupMonthlyReport;
  /** 选定的品类 (用于高亮或筛选单大类，设置为 null 则统计该人群所有品类累加) */
  selectedCategory: FoodCategory | null;
  /** 是否展示日开支走势曲线 */
  showTrend?: boolean;
  /** 是否展示食堂配量各品类资金占比 */
  showPie?: boolean;
  /** 是否展示重点监控高成本主材 */
  showMonitor?: boolean;
}

/**
 * @description 成本和膳食结构智能分析统计图标组件
 */
export const StatisticsPanel: React.FC<StatisticsPanelProps> = ({
  report,
  selectedCategory,
  showTrend = true,
  showPie = true,
  showMonitor = true
}) => {
  const days = useMemo(() => getDaysInMonth(report.year, report.month), [report.year, report.month]);

  /** @description 当前选定大品类中文标签 */
  const selectedCatLabel = useMemo(() => {
    if (!selectedCategory) return "";
    return PrepReportService.getActiveCategories().find(c => c.key === selectedCategory)?.label || selectedCategory;
  }, [selectedCategory]);

  // 1. 各品类开销汇总计算（动态构建以支持后台增删改查）
  const categoryStats = useMemo(() => {
    const activeCats = PrepReportService.getActiveCategories();
    const stats: Record<string, { category: string; label: string; amount: number; qty: number }> = {};
    activeCats.forEach((cat) => {
      stats[cat.key] = { category: cat.key, label: cat.label, amount: 0, qty: 0 };
    });

    report.items.forEach((item) => {
      const summary = getItemMonthlySummary(item, days);
      if (stats[item.category]) {
        stats[item.category].amount += summary.totalCost;
        stats[item.category].qty += summary.totalQty;
      }
    });

    return Object.values(stats);
  }, [report.items, days]);

  /** @description 月总开销计提 */
  const totalMonthlySpend = useMemo(() => {
    return Math.round(categoryStats.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  }, [categoryStats]);

  // 2. 31天每日金额开销流水，用于渲染趋势面积图
  const dailySpendData = useMemo(() => {
    return days.map((day) => {
      let costSum = 0;
      report.items.forEach((item) => {
        // 如果用户锁定了某一个品类，则趋势图仅渲染该大类的日走势
        if (selectedCategory && item.category !== selectedCategory) return;

        const entry = item.dailyData[day];
        if (entry) {
          costSum += entry.amount || 0;
        }
      });
      return {
        name: `${day}号`,
        "备餐开支": Math.round(costSum * 100) / 100
      };
    });
  }, [report.items, days, selectedCategory]);

  // 3. 排序高消耗主材，抓取前 5 位开销大头
  const topExpItems = useMemo(() => {
    const activeCats = PrepReportService.getActiveCategories();
    return report.items
      .map((item) => {
        const sum = getItemMonthlySummary(item, days);
        const catLabel = activeCats.find(c => c.key === item.category)?.label || item.category;
        return {
          id: item.id,
          name: item.name,
          category: catLabel,
          unit: item.unit,
          totalQty: sum.totalQty,
          totalCost: sum.totalCost
        };
      })
      .filter((v) => v.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 5);
  }, [report.items, days]);

  /** @description 颜色板色值设计，传递温润、品质、富有韵律的高端视觉 */
  const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  // 动态计算在显示模块变化下的 grid 网格列宽分配
  const hasCharts = showTrend || showPie;

  return (
    <div className="space-y-6">
      {hasCharts && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 2格宽: 核心财务趋势看板 */}
          {showTrend && (
            <div className={`${showPie ? "lg:col-span-2" : "lg:col-span-3"} bg-white/80 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between`}>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="p-2 bg-sky-50 text-sky-600 rounded-xl">
                      <TrendingUp size={18} />
                    </span>
                    <div>
                      <h3 className="font-semibold text-gray-800 text-sm">{selectedCategory ? `${selectedCatLabel}大类 - 日开支走势` : "全月备餐开支日耗曲线"}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">横向日期：1号 至 {days.length}号 (月末)</p>
                    </div>
                  </div>
                  {selectedCategory && (
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs rounded-full font-medium">
                      局部模式
                    </span>
                  )}
                </div>

                <div className="h-64 mt-4 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailySpendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.00} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", borderRadius: "12px", border: "none", color: "#fff" }}
                        itemStyle={{ color: "#38bdf8" }}
                      />
                      <Area type="monotone" dataKey="备餐开支" stroke="#0ea5e9" strokeWidth={2.5} fillOpacity={1} fill="url(#colorSpend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 核心卡底：信息汇总区块 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 mt-4 border-t border-gray-100">
                <div>
                  <span className="text-[11px] text-gray-400 block">月备餐总预算开销</span>
                  <span className="text-lg font-bold text-gray-800 flex items-center gap-0.5 mt-0.5">
                    <DollarSign size={16} className="text-green-500" />
                    {totalMonthlySpend.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-gray-400 block">备餐细分大类总数</span>
                  <span className="text-lg font-bold text-gray-800 flex items-center gap-1.5 mt-0.5">
                    <ShoppingBag size={15} className="text-sky-500" />
                    {report.items.length} 个项目
                  </span>
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[11px] text-gray-400 block">单日备餐平均耗资</span>
                  <span className="text-lg font-bold text-sky-700 flex items-center gap-0.5 mt-0.5">
                    ¥{(Math.round((totalMonthlySpend / days.length) * 100) / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 1格宽: 品类配比分布及痛点 */}
          {showPie && (
            <div className={`${showTrend ? "lg:col-span-1" : "lg:col-span-3"} bg-white/80 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between`}>
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <PieChart size={18} />
                  </span>
                  <div>
                    <h3 className="font-semibold text-gray-800 text-sm">食堂配量各品类资金占比</h3>
                    <p className="text-xs text-gray-400 mt-0.5">膳食均衡与采购能耗配比评估</p>
                  </div>
                </div>

                <div className="h-56 mt-2 text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryStats} layout="vertical" margin={{ left: -10, right: 10, top: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" stroke="#94a3b8" hide />
                      <YAxis dataKey="label" type="category" stroke="#475569" tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", borderRadius: "12px", border: "none", color: "#fff" }}
                        formatter={(value: any) => [`${value} 元`, "金额"]}
                      />
                      <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={16}>
                        {categoryStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 辅料能耗明细说明表 */}
              <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center text-[10px] text-gray-400 font-semibold uppercase tracking-wider pb-1">
                  <span>食材大类</span>
                  <span>月消耗金额 (元)</span>
                  <span>占比</span>
                </div>
                {categoryStats.map((stat, idx) => {
                  const percent = totalMonthlySpend > 0 ? ((stat.amount / totalMonthlySpend) * 100).toFixed(1) : "0.0";
                  return (
                    <div key={stat.category} className="flex justify-between items-center text-xs">
                      <span className="flex items-center gap-1.5 text-gray-600">
                        <span className="w-2.5 h-2.5 rounded-full block border" style={{ backgroundColor: COLORS[idx % COLORS.length], borderColor: "rgba(255,255,255,0.2)" }} />
                        {stat.label}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-gray-700">¥{stat.amount.toFixed(1)}</span>
                        <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{percent}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3栏网底：高开销排名前五重点审计项目，符合“性能与用户体验最优先” */}
      {showMonitor && (
        <div className="bg-white/80 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                <Award size={18} />
              </span>
              <div>
                <h3 className="font-semibold text-gray-800 text-sm">重点监控：高成本食材/配料 Top 5</h3>
                <p className="text-xs text-gray-400 mt-0.5">本月度消耗金额最高的五个原材料细分类目</p>
              </div>
            </div>
            <ArrowUpRight size={18} className="text-gray-300" />
          </div>

          {topExpItems.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-xs italic">
              本月尚无记录产生，表格为空。请完成数量及单价录入。
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              {topExpItems.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50/50 to-white hover:border-sky-200 transition-all shadow-xs relative overflow-hidden"
                >
                  {/* 浮动名次 */}
                  <span className="absolute right-2 -bottom-2 text-4xl font-extrabold font-mono text-gray-100/75 select-none">
                    #{idx + 1}
                  </span>

                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-500 mb-1 bg-rose-50 px-2 py-0.5 rounded-full w-max">
                    {item.category}
                  </div>
                  <h4 className="font-bold text-gray-800 text-sm truncate">{item.name}</h4>
                  <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                    <div className="flex justify-between">
                      <span>月消耗量:</span>
                      <span className="font-medium text-gray-700">{item.totalQty} {item.unit}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-50 pt-1 mt-1 text-gray-700 font-semibold">
                      <span>总开销:</span>
                      <span className="text-sky-600">¥{item.totalCost.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
