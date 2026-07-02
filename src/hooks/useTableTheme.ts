/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 封装备餐采购细表主题样式切换的自定义 Hook：管理当前选定主题（含 LocalStorage 持久化）并提供四套预设主题的样式类名映射。
 */

import { useState } from "react";
import { LogBroker } from "../utils.ts";

/**
 * @description 二级分组采购细表的主题样式属性定义
 */
export interface ThemeStyle {
  /** 主题主背景（如 bg-sky-500） */
  primaryBg: string;
  /** 主题主文字颜色（如 text-sky-700） */
  primaryText: string;
  /** 主题浅色背景（如 bg-sky-50/50） */
  lightBg: string;
  /** 卡片悬停边框颜色（如 hover:border-sky-300） */
  borderHover: string;
  /** 日历天数等徽章背景（如 bg-sky-500 text-white） */
  badgeClass: string;
  /** 金额等高亮强调文字颜色（如 text-sky-800） */
  accentText: string;
  /** 合计等高亮强调背景颜色（如 bg-sky-100/50） */
  accentBg: string;
  /** 激活态按钮背景类名 */
  btnActive: string;
}

/**
 * @description 支持的主题标识
 */
export type TableThemeKey = "sky" | "emerald" | "purple" | "charcoal";

/**
 * @description 预设精美的四套细表主题样式映射表
 */
export const THEME_MAP: Record<TableThemeKey, ThemeStyle> = {
  sky: {
    primaryBg: "bg-sky-600",
    primaryText: "text-sky-900",
    lightBg: "bg-sky-100/60",
    borderHover: "hover:border-sky-400",
    badgeClass: "bg-sky-600 text-white shadow-sky-50",
    accentText: "text-sky-950 font-black",
    accentBg: "bg-sky-200/50",
    btnActive: "bg-sky-600 text-white font-bold"
  },
  emerald: {
    primaryBg: "bg-emerald-600",
    primaryText: "text-emerald-900",
    lightBg: "bg-emerald-100/60",
    borderHover: "hover:border-emerald-400",
    badgeClass: "bg-emerald-600 text-white shadow-emerald-50",
    accentText: "text-emerald-950 font-black",
    accentBg: "bg-emerald-200/50",
    btnActive: "bg-emerald-600 text-white font-bold"
  },
  purple: {
    primaryBg: "bg-violet-600",
    primaryText: "text-violet-900",
    lightBg: "bg-violet-100/60",
    borderHover: "hover:border-violet-400",
    badgeClass: "bg-violet-600 text-white shadow-violet-50",
    accentText: "text-violet-950 font-black",
    accentBg: "bg-violet-200/50",
    btnActive: "bg-violet-600 text-white font-bold"
  },
  charcoal: {
    primaryBg: "bg-slate-700",
    primaryText: "text-slate-900",
    lightBg: "bg-slate-150",
    borderHover: "hover:border-slate-500",
    badgeClass: "bg-slate-700 text-white shadow-slate-50",
    accentText: "text-slate-950 font-black",
    accentBg: "bg-slate-200",
    btnActive: "bg-slate-700 text-white font-bold"
  }
};

/**
 * @description useTableTheme 返回值接口
 */
export interface UseTableThemeResult {
  /** 当前选定的主题标识 */
  theme: TableThemeKey;
  /** 当前主题对应的完整样式类名映射 */
  activeTheme: ThemeStyle;
  /** 切换主题并持久化到 LocalStorage */
  handleThemeChange: (newTheme: TableThemeKey) => void;
}

/**
 * @description 管理备餐采购细表主题切换与持久化的自定义 Hook
 */
export function useTableTheme(): UseTableThemeResult {
  // 主题样式管理，默认翡翠绿 "emerald"
  const [theme, setTheme] = useState<TableThemeKey>(() => {
    return (localStorage.getItem("prep_table_theme") as TableThemeKey) || "emerald";
  });

  const activeTheme = THEME_MAP[theme] || THEME_MAP.emerald;

  const handleThemeChange = (newTheme: TableThemeKey) => {
    setTheme(newTheme);
    localStorage.setItem("prep_table_theme", newTheme);
    LogBroker.publish("INFO", "TableGrid", `用户切换了备餐明细表格的主题样式为：${newTheme === "sky" ? "天空蓝" : newTheme === "emerald" ? "翡翠绿" : newTheme === "purple" ? "丁香紫" : "典雅暗灰"}`);
  };

  return { theme, activeTheme, handleThemeChange };
}
