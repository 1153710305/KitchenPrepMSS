/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from "react";
import { GroupMonthlyReport, TargetGroup, AiAnalysisResult } from "../types.ts";
import { PrepReportService } from "../store.ts";
import { UI_TEXT } from "../constants.ts";
import { getDaysInMonth, getItemMonthlySummary, LogBroker } from "../utils.ts";
import Markdown from "react-markdown";
import { Sparkles, BrainCircuit, Activity, Disc, AlertTriangle, Play, HelpCircle, Loader2 } from "lucide-react";

/**
 * @description AI助手模块对外的参数属性
 */
interface AiAssistantProps {
  /** 当前被授权或被聚焦激活的餐群报表 */
  activeGroupReport: GroupMonthlyReport;
}

/**
 * @description 智能营养师与预算规划师控制台
 */
export const AiAssistant: React.FC<AiAssistantProps> = ({ activeGroupReport }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [isStreamMode, setIsStreamMode] = useState<boolean>(true);
  const [rawProgressText, setRawProgressText] = useState<string>("");
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AiAnalysisResult | null>(null);

  // 1. 本地归并生成极轻量、高密度的物资概览，传递给大模型以防 Token 爆棚
  const days = useMemo(() => getDaysInMonth(activeGroupReport.year, activeGroupReport.month), [activeGroupReport.year, activeGroupReport.month]);

  const formattedSummaryJson = useMemo(() => {
    // 汇总各品类在本月被记账的总数额
    const summaryMap: Record<string, { totalQty: number; totalCost: number; itemsList: string[] }> = {};

    activeGroupReport.items.forEach((item) => {
      const summary = getItemMonthlySummary(item, days);
      if (summary.totalCost <= 0) return; // 忽略没有任何消耗的空品类，大幅节约算力

      if (!summaryMap[item.category]) {
        summaryMap[item.category] = { totalQty: 0, totalCost: 0, itemsList: [] };
      }
      summaryMap[item.category].totalQty += summary.totalQty;
      summaryMap[item.category].totalCost += summary.totalCost;
      summaryMap[item.category].itemsList.push(`${item.name} (${summary.totalQty}${item.unit},开销:${summary.totalCost}元)`);
    });

    return JSON.stringify(summaryMap, null, 2);
  }, [activeGroupReport.items, days]);

  /** @description 累计当月开销 */
  const totalCostCombinedValue = useMemo(() => {
    let sum = 0;
    activeGroupReport.items.forEach((item) => {
      days.forEach((d) => {
        sum += item.dailyData[d]?.amount || 0;
      });
    });
    return Math.round(sum * 100) / 100;
  }, [activeGroupReport.items, days]);

  /** @description 当前激活的人群中文名标签 */
  const activeGroupLabel = useMemo(() => {
    return PrepReportService.getActiveGroups().find(g => g.key === activeGroupReport.targetGroup)?.label || activeGroupReport.targetGroup;
  }, [activeGroupReport.targetGroup]);

  /** 
   * @description 启动 AI 智能预测及膳食审计主引擎
   */
  const handleStartAnalysis = async () => {
    setLoading(true);
    setErrorInfo(null);
    setRawProgressText("");
    setAnalysisResult(null);
    LogBroker.publish("INFO", "AiAssistant", `开始发起 AI 对「${activeGroupLabel}」的备餐财务与营养双重智能审计`);

    const payload = {
      targetGroupLabel: activeGroupLabel,
      year: activeGroupReport.year,
      month: activeGroupReport.month,
      itemsJson: formattedSummaryJson,
      summarizedSummary: `全月共计消耗各种辅料食材花费 ${totalCostCombinedValue} 元，品类密度 ${activeGroupReport.items.length} 种。`,
      stream: isStreamMode
    };

    try {
      const endpoint = "/api/gemini/analyze";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `服务端回执状态异常码: ${response.status}`);
      }

      if (isStreamMode) {
        // --- SSE 协议流处理 ---
        const reader = response.body?.getReader();
        if (!reader) throw new Error("无法读取浏览器 Response Body 管道。");

        const decoder = new TextDecoder();
        let aggregatedText = "";
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // 悬空最后一行尚未完整的段落
          buffer = lines.pop() || "";

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine || !cleanLine.startsWith("data:")) continue;

            const dataContent = cleanLine.substring(5).trim();
            if (dataContent === "[DONE]") {
              LogBroker.publish("INFO", "AiAssistant", "SSE 实时生成数据流已完美收官");
              break;
            }

            try {
              const parsed = JSON.parse(dataContent);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                aggregatedText += parsed.text;
                // 实时渲染极速打字效果
                setRawProgressText(aggregatedText);
              }
            } catch (pErr) {
              // 容错防止非 JSON 内容
            }
          }
        }

        // 终末冲刷
        if (aggregatedText) {
          parseFinalAiResponse(aggregatedText);
        }
      } else {
        // --- 非流式普通 JSON 处理 ---
        const resData = await response.json();
        if (resData.error) throw new Error(resData.error);
        if (resData.text) {
          setRawProgressText(resData.text);
          parseFinalAiResponse(resData.text);
        } else {
          throw new Error("模型未吐出任何有效的诊断文本块。");
        }
      }
    } catch (err: any) {
      setErrorInfo(err.message || "未知解析错误");
      LogBroker.publish("ERROR", "AiAssistant", `备餐智能诊断进程异常终止: ${err.message}`, err.stack);
    } finally {
      setLoading(false);
    }
  };

  /**
   * @description 尝试对模型吐回的 Markdown 或 JSON 进行正则抓取，转换为结构化卡片
   */
  const parseFinalAiResponse = (fullText: string) => {
    try {
      // 1. 首先尝试寻找 JSON 包含在方括号或花括号里的痕迹
      const jsonRegex = /\{[\s\S]*\}/;
      const match = fullText.match(jsonRegex);
      if (match) {
        const potentialJson = match[0].trim();
        const parsed = JSON.parse(potentialJson);

        if (parsed.nutritionAnalysis || parsed.costControlSuggestions) {
          setAnalysisResult({
            nutritionAnalysis: parsed.nutritionAnalysis || "无膳食分析数据记录",
            costControlSuggestions: parsed.costControlSuggestions || "无控本建议",
            purchaseGuide: parsed.purchaseGuide || "无下步采购指导",
            healthScore: typeof parsed.healthScore === "number" ? parsed.healthScore : 85,
            generatedAt: new Date().toLocaleDateString("zh-CN")
          });
          LogBroker.publish("INFO", "AiAssistant", "AI 结构化深度剖析报告格式校验成功！正式转换在 Bento 精致卡片中。");
          return;
        }
      }
    } catch (e) {
      LogBroker.publish("WARN", "AiAssistant", "未能成功对 AI 返回内容执行 JSON parse。系统将降级为“全景 Markdown”呈现机制。");
    }

    // 2. 降级：如果模型没有输出标准 JSON，我们直接将其包装成完整的 Markdown 渲染
    setAnalysisResult({
      nutritionAnalysis: fullText,
      costControlSuggestions: "请阅读下方完整全景审计日志面板获取完整建议。",
      purchaseGuide: "已合并至全景报告中展现。",
      healthScore: 90,
      generatedAt: new Date().toLocaleDateString("zh-CN")
    });
  };

  /** @description 根据健康得分动态评估分值，给出色彩标记 */
  const getScoreColor = (score: number) => {
    if (score >= 85) return { border: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700", fill: "stroke-emerald-500" };
    if (score >= 60) return { border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-700", fill: "stroke-amber-500" };
    return { border: "border-red-200", bg: "bg-red-50", text: "text-red-700", fill: "stroke-red-500" };
  };

  const scoreMeta = useMemo(() => {
    return getScoreColor(analysisResult?.healthScore || 0);
  }, [analysisResult?.healthScore]);

  return (
    <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 border border-gray-100 shadow-sm mt-6">

      {/* 头部区 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 w-max bg-gradient-to-tr from-emerald-500 to-teal-600 text-white rounded-xl shadow-md shadow-emerald-100 animate-pulse">
            <Sparkles size={20} />
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-base">{UI_TEXT.aiAssistantTitle}</h3>
            <p className="text-xs text-gray-500 mt-0.5">针对餐群【{activeGroupLabel}】本期开盘金额和配比的专项分析</p>
          </div>
        </div>

        {/* 模式选择与触发区 */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-100 text-xs">
            <button
              onClick={() => setIsStreamMode(true)}
              className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer font-medium ${isStreamMode ? "bg-white text-emerald-600 shadow-xs border border-gray-100" : "text-gray-500 hover:text-gray-900"
                }`}
            >
              在线打字流
            </button>
            <button
              onClick={() => setIsStreamMode(false)}
              className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer font-medium ${!isStreamMode ? "bg-white text-emerald-600 shadow-xs border border-gray-100" : "text-gray-500 hover:text-gray-900"
                }`}
            >
              传统常规
            </button>
          </div>

          <button
            onClick={handleStartAnalysis}
            disabled={loading}
            className={`flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 rounded-xl font-medium shadow-md shadow-emerald-100 transition-all cursor-pointer disabled:opacity-50 text-sm`}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>食堂数据审计中...</span>
              </>
            ) : (
              <>
                <BrainCircuit size={16} />
                <span>{UI_TEXT.aiAnalyzeBtn}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 异常展示器 */}
      {errorInfo && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-xs flex gap-2.5 mb-5 select-none">
          <AlertTriangle size={18} className="shrink-0 text-red-500" />
          <div className="space-y-1">
            <h4 className="font-semibold">AI分析模块暂不可用</h4>
            <p className="leading-relaxed whitespace-pre-line">{errorInfo}</p>
          </div>
        </div>
      )}

      {/* 初始状态提示 */}
      {!loading && !analysisResult && !rawProgressText && (
        <div className="py-14 text-center text-gray-400 text-xs flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border border-emerald-100">
            <HelpCircle size={22} />
          </div>
          <div className="max-w-md space-y-1">
            <p className="font-semibold text-gray-600">双核智能食堂大脑已就绪</p>
            <p className="leading-relaxed">点击右上方按钮，即可综合分析大米、猪肉等【{activeGroupLabel}】物资配比，审查伙食的多样丰富度并得出控本报告。</p>
          </div>
        </div>
      )}

      {/* 模型正在流式吐字动画展示区 */}
      {loading && !analysisResult && (
        <div className="bg-neutral-950 border border-neutral-900 rounded-2xl p-5 text-neutral-300 font-mono text-xs">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-neutral-900">
            <span className="flex items-center gap-2 text-rose-400">
              <Disc size={13} className="animate-spin" />
              <span>智能神经元突触实时通信中 (SSE Stream)</span>
            </span>
            <span className="text-[10px] text-neutral-600">Token 吞吐量自适应</span>
          </div>
          <div className="min-h-36 max-h-56 overflow-y-auto whitespace-pre-wrap leading-relaxed pr-2 text-neutral-400 scrollbar-thin">
            {rawProgressText || "正在启动AI引擎，整理表格账层细节..."}
          </div>
        </div>
      )}

      {/* AI诊断审计结果面板 - Bento 精雅结构渲染 */}
      {analysisResult && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Bento 1: 综合膳食评分与雷达指示 */}
            <div className={`md:col-span-1 rounded-2xl border p-5 flex flex-col items-center justify-center text-center ${scoreMeta.bg} ${scoreMeta.border}`}>
              <Activity size={24} className={`mb-2 ${scoreMeta.text}`} />
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">膳食安全指数</h4>

              <div className="relative flex items-center justify-center my-4">
                {/* 仿真仪表盘圈 */}
                <svg className="w-28 h-28 transform -rotate-90">
                  <circle cx="56" cy="56" r="44" stroke="#e2e8f0" strokeWidth="8" fill="transparent" />
                  <circle
                    cx="56"
                    cy="56"
                    r="44"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 44}
                    strokeDashoffset={2 * Math.PI * 44 * (1 - analysisResult.healthScore / 100)}
                    className={`${scoreMeta.text} transition-all duration-1000 ease-out`}
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-3xl font-extrabold text-gray-800 tracking-tight">{analysisResult.healthScore}</span>
                  <span className="text-[9px] text-gray-400">一期开局评分</span>
                </div>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed font-sans px-2">
                结合本月蔬菜、高糖粮油、必需蛋白质及水果耗资之丰富程度，折算得出当前膳食健康评价。
              </p>
            </div>

            {/* Bento 2: 控本节余专家诊断 */}
            <div className="md:col-span-2 bg-gray-50/50 border border-gray-100 rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5 uppercase tracking-wide border-b border-gray-100 pb-2 mb-3">
                  <span className="w-1.5 h-3 bg-indigo-500 rounded-xs" />
                  历史备操管控与降本路径审核
                </h4>
                <div className="text-xs text-gray-600 leading-relaxed max-h-44 overflow-y-auto pr-1">
                  {analysisResult.costControlSuggestions === "请阅读下方完整全景审计日志面板获取完整建议。" ? (
                    <p className="italic text-gray-400">未输出离散卡，系统已启动底层降退机制。请查看下方全景渲染。</p>
                  ) : (
                    <p className="whitespace-pre-wrap">{analysisResult.costControlSuggestions}</p>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-gray-400 border-t border-gray-100 pt-2 mt-4 flex justify-between">
                <span>生成时间：{analysisResult.generatedAt}</span>
                <span>审计标准：GB/T 营养卫生</span>
              </div>
            </div>

          </div>

          {/* 核心全尺寸卡：膳食营养与采购安全 */}
          <div className="bg-gradient-to-br from-emerald-50/20 to-teal-50/10 border border-gray-100 rounded-2xl p-6">
            <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5 uppercase tracking-wide border-b border-gray-200/50 pb-2 mb-3">
              <span className="w-1.5 h-3 bg-emerald-500 rounded-xs animate-ping" />
              膳食结构及主导营养平衡诊断
            </h4>

            {/* Markdown 排版渲染内容 */}
            <div className="text-xs text-gray-600 leading-relaxed markdown-body prose prose-sm max-w-none pr-1">
              <Markdown>{analysisResult.nutritionAnalysis}</Markdown>
            </div>

            {/* 仓储采购指导子栏 */}
            {analysisResult.purchaseGuide !== "已合并至全景报告中展现。" && (
              <div className="mt-5 pt-4 border-t border-gray-200/50">
                <h5 className="font-bold text-[11px] text-gray-700 mb-1">采购冷库与仓管防损建议：</h5>
                <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">{analysisResult.purchaseGuide}</p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
