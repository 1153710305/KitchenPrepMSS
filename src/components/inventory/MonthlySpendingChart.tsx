/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐采购细表的"当月采购花销趋势图"：以折线图形式展示当前受众、当前二级品类在本月每一天的采购金额走势，默认由外层按钮控制显示/隐藏。
 * 鼠标悬浮某一天的数据点时会弹出提示框显示当天具体的采购花销金额。
 */

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import type { ThemeStyle } from "../../hooks/useTableTheme.ts";

/**
 * @description MonthlySpendingChart 组件入参接口
 */
interface MonthlySpendingChartProps {
  /** 当月包含的日期数组 (["1", "2", ..., "31"]) */
  days: string[];
  /** 每个日期(1-31号)在该类目下的总开销汇总 */
  dayTotals: Record<string, number>;
  /** 当前受众人群展示名称 */
  groupLabel: string;
  /** 当前二级品类展示名称 */
  categoryLabel: string;
  /** 当前主题对应的完整样式类名映射 */
  activeTheme: ThemeStyle;
  /** 标题文案整体覆盖（不传时按"「受众」品类类 - 本月每日采购花销趋势"自动拼接，用于合计汇总表等无单一品类语境的场景） */
  titleOverride?: string;
}

/** 图表内绘图区域的像素尺寸（viewBox 坐标系） */
const CHART_WIDTH = 920;
const CHART_HEIGHT = 200;
const PADDING_LEFT = 48;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 28;

/** 悬浮提示框的固定尺寸（viewBox 坐标系） */
const TOOLTIP_WIDTH = 100;
const TOOLTIP_HEIGHT = 38;

/** 主题名到折线/填充色值的映射（SVG stroke/fill 需要真实颜色值，无法直接复用 Tailwind 类名） */
const THEME_COLOR_MAP: Record<string, string> = {
  "bg-sky-600": "#0284c7",
  "bg-emerald-600": "#059669",
  "bg-violet-600": "#7c3aed",
  "bg-slate-700": "#334155"
};

/**
 * @description 当月采购花销趋势折线图组件
 */
export function MonthlySpendingChart({ days, dayTotals, groupLabel, categoryLabel, activeTheme, titleOverride }: MonthlySpendingChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const values = days.map((d) => dayTotals[d] || 0);
  const maxValue = Math.max(...values, 0);
  // 顶部留白：最大值的 15%，避免折线紧贴图表上边缘；最大值为 0 时兜底给 1，避免除以 0
  const yAxisMax = maxValue > 0 ? maxValue * 1.15 : 1;
  const monthTotal = Math.round(values.reduce((sum, v) => sum + v, 0) * 100) / 100;
  const lineColor = THEME_COLOR_MAP[activeTheme.primaryBg] || "#059669";

  const plotWidth = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  /** 把第 idx 天(0-based)换算为图表 x 像素坐标 */
  const xForIndex = (idx: number) => PADDING_LEFT + (days.length <= 1 ? 0 : (idx / (days.length - 1)) * plotWidth);
  /** 把某个金额换算为图表 y 像素坐标（数值越大越靠上） */
  const yForValue = (val: number) => PADDING_TOP + plotHeight - (val / yAxisMax) * plotHeight;

  const linePoints = values.map((v, idx) => `${xForIndex(idx)},${yForValue(v)}`).join(" ");
  const areaPoints = `${xForIndex(0)},${yForValue(0)} ${linePoints} ${xForIndex(values.length - 1)},${yForValue(0)}`;

  // Y 轴取 4 条水平参考网格线（含 0 与最大值）
  const gridLineCount = 4;
  const gridLines = Array.from({ length: gridLineCount + 1 }, (_, i) => (yAxisMax / gridLineCount) * i);

  /** 当前悬浮点的坐标与数值，供高亮点、参考虚线、提示框共用 */
  const hovered = hoveredIndex !== null
    ? { x: xForIndex(hoveredIndex), y: yForValue(values[hoveredIndex]), day: days[hoveredIndex], value: values[hoveredIndex] }
    : null;

  /** 提示框水平位置：以悬浮点为中心，并夹取在绘图区域内避免溢出图表左右边缘 */
  const tooltipX = hovered
    ? Math.min(Math.max(hovered.x - TOOLTIP_WIDTH / 2, PADDING_LEFT), CHART_WIDTH - PADDING_RIGHT - TOOLTIP_WIDTH)
    : 0;
  /** 提示框纵向位置：默认显示在数据点正上方；若数据点太靠近图表顶部（金额较高）则翻转显示到下方，避免被裁切 */
  const tooltipAbove = hovered ? hovered.y - PADDING_TOP > TOOLTIP_HEIGHT + 8 : true;
  const tooltipY = hovered ? (tooltipAbove ? hovered.y - TOOLTIP_HEIGHT - 10 : hovered.y + 10) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`p-2 rounded-xl ${activeTheme.lightBg} ${activeTheme.primaryText}`}>
            <TrendingUp size={16} />
          </span>
          <div>
            <h4 className="text-[13px] font-bold text-gray-700">
              {titleOverride || `「${groupLabel}」${categoryLabel}类 - 本月每日采购花销趋势`}
            </h4>
            <p className="text-[11px] text-gray-400 mt-0.5">横向日期：1号 至 {days.length}号 (月末)</p>
          </div>
        </div>
        <span className={`text-[12px] font-bold px-2.5 py-1 rounded-lg shrink-0 ${activeTheme.lightBg} ${activeTheme.primaryText}`}>
          本月累计: ¥{monthTotal.toLocaleString()}
        </span>
      </div>

      {maxValue === 0 ? (
        <div className="py-10 text-center text-gray-400 text-[13px] italic">本月该品类暂无任何采购花销记录</div>
      ) : (
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full" style={{ maxHeight: "220px" }}>
          {/* 水平网格线与 Y 轴金额刻度 */}
          {gridLines.map((val, i) => {
            const y = yForValue(val);
            return (
              <g key={i}>
                <line x1={PADDING_LEFT} y1={y} x2={CHART_WIDTH - PADDING_RIGHT} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                <text x={PADDING_LEFT - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">
                  ¥{Math.round(val)}
                </text>
              </g>
            );
          })}

          {/* 折线下方的渐变填充区域 */}
          <polygon points={areaPoints} fill={lineColor} fillOpacity={0.08} />

          {/* 折线本身 */}
          <polyline points={linePoints} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* 悬浮参考竖线：从数据点垂直连到 X 轴，方便对齐日期刻度 */}
          {hovered && (
            <line
              x1={hovered.x} y1={PADDING_TOP} x2={hovered.x} y2={CHART_HEIGHT - PADDING_BOTTOM}
              stroke={lineColor} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.4}
            />
          )}

          {/* 每日数据点：可见小圆点 + 悬浮更容易命中的透明大圆点热区 */}
          {values.map((v, idx) => {
            const cx = xForIndex(idx);
            const cy = yForValue(v);
            const isHovered = hoveredIndex === idx;
            return (
              <g key={idx}>
                <circle cx={cx} cy={cy} r={isHovered ? 4 : 2.5} fill={lineColor} stroke="#fff" strokeWidth={isHovered ? 1.5 : 0} />
                <circle
                  cx={cx} cy={cy} r={10} fill="transparent"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex((prev) => (prev === idx ? null : prev))}
                  style={{ cursor: "pointer" }}
                >
                  <title>{days[idx]}号: ¥{v.toFixed(2)}</title>
                </circle>
              </g>
            );
          })}

          {/* X 轴日期刻度：为避免拥挤，每 5 天标注一次，首尾始终标注 */}
          {days.map((day, idx) => {
            const shouldLabel = idx === 0 || idx === days.length - 1 || (idx + 1) % 5 === 0;
            if (!shouldLabel) return null;
            return (
              <text key={day} x={xForIndex(idx)} y={CHART_HEIGHT - PADDING_BOTTOM + 16} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {day}号
              </text>
            );
          })}

          {/* 悬浮提示框：显示当天具体的采购花销金额，随鼠标悬浮的数据点动态定位 */}
          {hovered && (
            <g style={{ pointerEvents: "none" }}>
              <rect x={tooltipX} y={tooltipY} width={TOOLTIP_WIDTH} height={TOOLTIP_HEIGHT} rx={6} fill="#1e293b" />
              <text x={tooltipX + TOOLTIP_WIDTH / 2} y={tooltipY + 15} textAnchor="middle" fontSize={10} fill="#94a3b8">
                {hovered.day}号
              </text>
              <text x={tooltipX + TOOLTIP_WIDTH / 2} y={tooltipY + 29} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#ffffff">
                ¥{hovered.value.toFixed(2)}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
