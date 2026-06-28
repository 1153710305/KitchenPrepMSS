/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { GroupMonthlyReport, DynamicGroup, TargetGroup } from "../types.ts";
import { PrepReportService } from "../store.ts";
import { LogBroker, getDaysInMonth } from "../utils.ts";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { Users, TrendingUp, ChevronDown, ChevronUp, RefreshCw, Check, Calculator } from "lucide-react";

/**
 * @description 每日就餐人数与人均餐费面板输入属性接口
 */
interface HeadcountPanelProps {
  /** 当前月度多客群报表数组 */
  reports: GroupMonthlyReport[];
  /** 当前激活的人群Key */
  activeGroup: string;
  /** 动态从底层存储库嗅探的一级人群分组 */
  activeGroupsList: DynamicGroup[];
  /** 每日人数更新回调 */
  onHeadcountUpdate: (groupKey: string, day: string, headcount: number) => void;
  /** 是否为管理员模式 */
  isAdminMode: boolean;
}

/**
 * @description 每日就餐人数录入与全客群人均餐费分析折线图组件
 */
export const HeadcountPanel: React.FC<HeadcountPanelProps> = ({
  reports,
  activeGroup,
  activeGroupsList,
  onHeadcountUpdate,
  isAdminMode
}) => {
  // 1. 展开/折叠状态，默认展开以便于用户感知
  const [isOpen, setIsOpen] = useState<boolean>(true);

  /**
   * @description 内部当前正在选择录入就餐人数的一级受众人群唯一 Key
   */
  const [currentEditorGroup, setCurrentEditorGroup] = useState<string>(
    activeGroup === "ANALYTICS" ? (activeGroupsList[0]?.key || "TEACHER") : activeGroup
  );

  /**
   * @description 监听外部传参 activeGroup 的物理更替，当外部切换至特定人群页时同步内部值
   */
  useEffect(() => {
    if (activeGroup !== "ANALYTICS") {
      setCurrentEditorGroup(activeGroup);
    }
  }, [activeGroup]);

  // 2. 当前选中人群的完整报表
  const currentReport = useMemo(() => {
    return reports.find((r) => r.targetGroup === currentEditorGroup as TargetGroup);
  }, [reports, currentEditorGroup]);

  // 3. 当前选定报表所在月份的天数
  const days = useMemo(() => {
    if (!currentReport) {
      const now = new Date();
      return getDaysInMonth(now.getFullYear(), now.getMonth() + 1);
    }
    return getDaysInMonth(currentReport.year, currentReport.month);
  }, [currentReport]);

  // 4. 高性能修改跟踪 Ref，用于在 input 失去焦点 (onBlur) 时记录变动日志，避免打字时的实时输入卡顿
  const editTrackerRef = useRef<{
    /** 当前记录的日期天数，如 "1" 到 "31" */
    day: string;
    /** 修改前原生的就餐人数 */
    initialValue: number;
  } | null>(null);

  // 5. 本地临时状态，支持输入框实时受控，避免父组件全量重绘导致打字延迟
  const [localHeadcounts, setLocalHeadcounts] = useState<Record<string, string>>({});

  // 监听当前报告或组变更，同步本地输入框值
  useEffect(() => {
    if (currentReport) {
      const initialCounts: Record<string, string> = {};
      days.forEach((day) => {
        const count = currentReport.dailyHeadcount?.[day];
        initialCounts[day] = count !== undefined ? String(count) : "50";
      });
      setLocalHeadcounts(initialCounts);
    }
  }, [currentReport, days]);

  /**
   * @description 目标人群的中文显名转换
   * @param groupKey 人群的 Key
   */
  const getGroupLabel = (groupKey: string) => {
    const g = activeGroupsList.find((item) => item.key === groupKey);
    return g ? g.label : groupKey;
  };

  /**
   * @description 人数输入框聚焦记录初始值
   * @param day 具体的几号
   * @param value 聚焦时的当前人数数值
   */
  const handleInputFocus = (day: string, value: number) => {
    editTrackerRef.current = {
      day,
      initialValue: value
    };
  };

  /**
   * @description 人数输入框修改
   * @param day 具体的几号
   * @param value 键盘敲击输入的字符串内容
   */
  const handleInputChange = (day: string, value: string) => {
    setLocalHeadcounts((prev) => ({
      ...prev,
      [day]: value
    }));
  };

  /**
   * @description 人数输入框失去焦点，进行持久化与审计日志记录
   * @param day 具体的几号
   * @param currentValueStr 失去焦点时的输入字符串内容
   */
  const handleInputBlur = (day: string, currentValueStr: string) => {
    const tracker = editTrackerRef.current;
    if (tracker && tracker.day === day) {
      const numericValue = parseInt(currentValueStr, 10);
      const sanitized = isNaN(numericValue) || numericValue < 1 ? 1 : numericValue;

      // 如果发生了实质性的数字变更
      if (tracker.initialValue !== sanitized) {
        onHeadcountUpdate(currentEditorGroup, day, sanitized);

        // 审计操作人角色
        const operator = isAdminMode ? "系统管理员" : "普通记账员";
        const groupLabel = getGroupLabel(currentEditorGroup);

        // 计算当前受众该天变动前后的人均餐费差额
        let totalDailyCost = 0;
        if (currentReport) {
          currentReport.items.forEach((item) => {
            totalDailyCost += item.dailyData[day]?.amount || 0;
          });
        }
        const oldPerCapita = Math.round((totalDailyCost / tracker.initialValue) * 100) / 100;
        const newPerCapita = Math.round((totalDailyCost / sanitized) * 100) / 100;

        LogBroker.publish(
          "INFO",
          "HeadcountPanel",
          `【修改就餐人数】操作员 [${operator}] 修改了「${groupLabel}」在 [${day}号] 的就餐人数：从 [${tracker.initialValue} 人] 变更为 [${sanitized} 人]，该日备餐人均餐费由 [¥${oldPerCapita}] 调整为 [¥${newPerCapita}] (单日大类总额: ¥${totalDailyCost.toFixed(2)})。`
        );
      }
    }
    editTrackerRef.current = null;
  };

  // 6. 核心报表分析：计算所有客群 31 天的每日人均餐费，构建折线图数据集
  const perCapitaChartData = useMemo(() => {
    if (reports.length === 0 || days.length === 0) return [];

    return days.map((day) => {
      const dataPoint: Record<string, any> = {
        name: `${day}号`
      };

      // 循环计算每个客群在这一天的人均餐费
      activeGroupsList.forEach((group) => {
        const report = reports.find((r) => r.targetGroup === group.key as TargetGroup);
        if (!report) {
          dataPoint[group.label] = 0;
          return;
        }

        // 1. 汇总该客群在这一天的所有耗粮金额合计
        let dailyTotalCost = 0;
        report.items.forEach((item) => {
          dailyTotalCost += item.dailyData[day]?.amount || 0;
        });

        // 2. 读取或补足默认就餐人数
        const headcount = report.dailyHeadcount?.[day] !== undefined ? report.dailyHeadcount[day] : 50;

        // 3. 计算人均餐费（元/人）
        const perCapita = headcount > 0 ? dailyTotalCost / headcount : 0;
        dataPoint[group.label] = Math.round(perCapita * 100) / 100;
        
        // 留存额外数据字段方便自定义 tooltip 渲染
        dataPoint[`${group.label}_总开销`] = dailyTotalCost;
        dataPoint[`${group.label}_人数`] = headcount;
      });

      return dataPoint;
    });
  }, [reports, days, activeGroupsList]);

  // 7. 多彩折线色板设计，为不同的一级人群匹配其专属色彩
  const groupColors: Record<string, string> = {
    TEACHER: "#0ea5e9",   // 教师备餐: 蔚蓝
    KID: "#10b981",       // 幼儿备餐: 翠绿
    LOW_GRADE: "#f59e0b", // 低年级备餐: 暖橙
    HIGH_GRADE: "#8b5cf6" // 高年级备餐: 雅紫
  };

  const getLineColor = (key: string, index: number) => {
    if (groupColors[key]) return groupColors[key];
    const defaultColors = ["#ec4899", "#14b8a6", "#ef4444", "#3b82f6"];
    return defaultColors[index % defaultColors.length];
  };

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300">
      {/* 模块头部栏 */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="px-6 py-4 flex items-center justify-between border-b border-gray-50 bg-gradient-to-r from-slate-50 to-white cursor-pointer select-none hover:bg-slate-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
            <Users size={18} />
          </span>
          <div>
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
              每日就餐人数录入 & 人均餐费多维度分析
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] rounded-full font-bold">
                独立入口页
              </span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              卡片网格化人数录入管理，全局级联全人群人均餐费对比曲线
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400 font-medium">点击{isOpen ? "折叠面板" : "展开编辑"}</span>
          <button className="text-gray-400 hover:text-gray-600">
            {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* 核心内容区 */}
      {isOpen && (
        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* 左侧 (5格): 就餐人数日历录入网格 (Calendar-Style High Density Layout) */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              
              {/* 人群微切换器控制条 */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-500 block">
                  🎯 选择要录入人数的受众人群
                </span>
                <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
                  {activeGroupsList.map((g) => {
                    const isActive = currentEditorGroup === g.key;
                    return (
                      <button
                        key={`tab-selector-${g.key}`}
                        type="button"
                        onClick={() => {
                          setCurrentEditorGroup(g.key);
                          LogBroker.publish("INFO", "HeadcountPanel", `在多维分析页切换当前编辑的人数分组: ${g.label}`);
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          isActive
                            ? "bg-white text-emerald-700 shadow-xs"
                            : "text-slate-500 hover:text-slate-700 hover:bg-white/40"
                        }`}
                      >
                        <span className="text-sm">{g.emoji}</span>
                        <span>{g.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse"></span>
                  👥 每日就餐人数输入 (<span className="text-sky-600 font-extrabold">{getGroupLabel(currentEditorGroup)}</span>)
                </span>
                <span className="text-[10px] text-gray-400">核算单位（人）</span>
              </div>

              {/* 日历卡片密集排布网格 */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 max-h-[220px] overflow-y-auto scrollbar-thin p-1 bg-slate-50/50 rounded-xl border border-slate-100">
                {days.map((day) => {
                  const val = localHeadcounts[day] || "";
                  const numVal = parseInt(val, 10);
                  const isZero = isNaN(numVal) || numVal <= 0;
                  return (
                    <div 
                      key={`hc-cell-${day}`}
                      className={`p-1 rounded-lg border transition-all flex flex-col justify-between ${
                        isZero 
                          ? "bg-rose-50/30 border-rose-100/60" 
                          : "bg-white border-slate-100 hover:border-sky-300 hover:shadow-xs focus-within:ring-1 focus-within:ring-sky-500"
                      }`}
                    >
                      <div className="flex justify-between items-center text-[9px] font-mono font-bold text-slate-400 mb-0.5">
                        <span>{day}号</span>
                        {!isZero && <Check size={8} className="text-emerald-500" />}
                      </div>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={val}
                        placeholder="50"
                        onFocus={() => handleInputFocus(day, numVal || 50)}
                        onChange={(e) => handleInputChange(day, e.target.value)}
                        onBlur={() => handleInputBlur(day, val)}
                        className="w-full bg-transparent border-0 text-center font-mono font-bold text-xs text-slate-700 focus:outline-none p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 操作提示底角 */}
            <div className="p-3 bg-sky-50/50 border border-sky-100/50 rounded-xl flex items-start gap-2 text-[11px] text-sky-800 leading-relaxed">
              <Calculator size={14} className="text-sky-600 shrink-0 mt-0.5" />
              <p>
                <strong>实时均摊公式：</strong>人均餐费 = 当天后厨采购总额 ÷ 就餐人数。修改人数并失去焦点后，右侧餐费走势将实时无卡顿重绘。
              </p>
            </div>
          </div>

          {/* 右侧 (7格): 全人群人均餐费比对折线图 (Comparative Trend Line Chart) */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-emerald-500" />
                  📈 各就餐受众人群每日人均餐费比对走势图 (元/人)
                </span>
                <span className="text-[10px] text-gray-400">1号 至 {days.length}号 月度全景</span>
              </div>

              {/* 折线图绘制舞台 */}
              <div className="h-[250px] w-full text-[10px] font-mono mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={perCapitaChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e293b", borderRadius: "12px", border: "none", color: "#fff", fontSize: "11px" }}
                      itemStyle={{ padding: "1px 0" }}
                      formatter={(value: any, name: string, props: any) => {
                        const label = name;
                        const dataRow = props.payload;
                        const total = dataRow[`${label}_总开销`] || 0;
                        const qty = dataRow[`${label}_人数`] || 50;
                        return [
                          <div key={name} className="space-y-0.5">
                            <span className="font-bold text-sky-300">¥{value} 元/人</span>
                            <span className="text-[9px] text-slate-400 block">(总开销: ¥{total.toFixed(1)} | 就餐: {qty}人)</span>
                          </div>,
                          label
                        ];
                      }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
                    
                    {/* 动态绘制折线，保证添加、删除人群后，图例与色彩不崩塌 */}
                    {activeGroupsList.map((group, idx) => (
                      <Line
                        key={group.key}
                        type="monotone"
                        dataKey={group.label}
                        stroke={getLineColor(group.key, idx)}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 说明 */}
            <div className="text-[10px] text-slate-400 mt-2 text-right">
              * 提示：鼠标悬停在图表拐点上，可一并穿透查看该日该人群的「后厨总开销」和「精准就餐人数」。
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
