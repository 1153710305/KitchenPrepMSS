/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 全项目通用的日期计算、拼音模糊匹配、备餐月度汇总统计、CSV 导出及系统日志广播（LogBroker）等基础工具函数集合。
 */

import { PreparedItem, SystemLog } from "./types/types.ts";

/**
 * @description 获取选定月份的第1天到月末的天数数组
 * @param year 年份 (例如: 2026)
 * @param month 月份 (1-12)
 * @returns 包含天数索引字符串的数组，如 ["1", "2", ..., "31"]
 */
export function getDaysInMonth(year: number, month: number): string[] {
  // 利用 Date 溢出机制自动计算当月天数
  const totalDays = new Date(year, month, 0).getDate();
  const days: string[] = [];
  for (let i = 1; i <= totalDays; i++) {
    days.push(String(i));
  }
  return days;
}

/**
 * @description 获取两个日期之间的所有日期字符串数组 (格式: YYYY-MM-DD)
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @returns 包含这区间所有日期的数组
 */
export function getDatesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  if (!startDate || !endDate) return dates;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return dates;

  const current = new Date(start);
  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

import { pinyin } from "pinyin-pro";

/**
 * @description 判断目标中文文本是否匹配查询关键词（支持拼音首字母缩写、全拼模糊以及中文原文）
 * @param targetText 中文目标文本，如 "大米"
 * @param querySearch 查找关键词，如 "dm" 或 "dami" 或 "大米"
 * @returns 是否匹配
 */
export function matchPinyin(targetText: string, querySearch: string): boolean {
  const query = querySearch.trim().toLowerCase();
  if (!query) return true;

  const text = targetText.trim().toLowerCase();
  if (text.includes(query)) return true;

  try {
    // 获取无音调全拼，如 "da mi"
    const fullPinyin = pinyin(text, { toneType: "none" }).toLowerCase().replace(/\s+/g, "");
    if (fullPinyin.includes(query)) return true;

    // 获取拼音首字母，如 "dm"
    const firstLetters = pinyin(text, { pattern: "first", toneType: "none" }).toLowerCase().replace(/\s+/g, "");
    if (firstLetters.includes(query)) return true;
  } catch (err) {
    // 降级防呆
    return text.includes(query);
  }

  return false;
}

/**
 * @description 获取某一行备餐明细行当月的所有天数的总数量与总金额
 * @param item 细分品类备餐实体
 * @param days 当月包含的所有天数
 * @returns 包含总数量(totalQty) 和总金额(totalCost) 两个统计属性的对象
 */
export function getItemMonthlySummary(
  item: PreparedItem,
  days: string[]
): { totalQty: number; totalCost: number } {
  let totalQty = 0;
  let totalCost = 0;
  days.forEach((day) => {
    const entry = item.dailyData[day];
    if (entry) {
      totalQty += entry.quantity || 0;
      totalCost += entry.amount || 0;
    }
  });
  return {
    totalQty: Math.round(totalQty * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100
  };
}

/**
 * @description 将系统状态信息或操作异常记录写入性能监视日志
 * @param level 日志级别 (INFO | WARN | ERROR)
 * @param module 触发日志的函数或组件名称
 * @param message 描述内容
 * @param details 额外异常详情或错误堆栈
 * @returns 组装好的完整 SystemLog 对象
 */
export function createSystemLog(
  level: "INFO" | "WARN" | "ERROR",
  module: string,
  message: string,
  details?: string
): SystemLog {
  const log: SystemLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    details
  };

  // 同时输出在浏览器的控制台，方便排查
  if (level === "ERROR") {
    console.error(`[${log.timestamp}] [${module}] ${message}`, details || "");
  } else if (level === "WARN") {
    console.warn(`[${log.timestamp}] [${module}] ${message}`);
  } else {
    console.log(`[${log.timestamp}] [${module}] ${message}`);
  }

  return log;
}

/**
 * @description 双向绑定的全功能系统日志发布拦截器
 */
export class LogBroker {
  private static listeners: ((log: SystemLog) => void)[] = [];

  /**
   * @description 注册一个新的系统日志订阅者
   * @param listener 回调函数
   */
  public static subscribe(listener: (log: SystemLog) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * @description 触发并向所有注册组件推送新日志条目
   * @param level 日志等级
   * @param module 来源模块
   * @param message 日志消息
   * @param details 堆栈细节 
   */
  public static publish(
    level: "INFO" | "WARN" | "ERROR",
    module: string,
    message: string,
    details?: string
  ): void {
    const log = createSystemLog(level, module, message, details);

    // 异步将日志上传至后端写入本地文件
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, category: module, message: details ? `${message} (详情: ${details})` : message })
    }).catch(err => {
      // 捕获可能出现的网络或配置错误，防止日志本身报错阻塞业务
      console.warn("[LogBroker] 无法上传日志至后端持久化:", err);
    });

    this.listeners.forEach((listener) => {
      try {
        listener(log);
      } catch (err) {
        console.error("推送信道异常:", err);
      }
    });
  }
}

/**
 * @description 将指定品类的细分备餐矩阵导出为标准的 Excel 可兼容 CSV 文本格式
 * @param items 该类目的备餐行列表
 * @param days 当前月份的所有天数 (如 1号 到 31号)
 * @param categoryLabel 品类中文名称
 * @returns 导出用的 CSV 纯文本
 */
export function convertItemsToCsv(
  items: PreparedItem[],
  days: string[],
  categoryLabel: string
): string {
  // UTF-8 BOM，防止 Excel 打开中文乱码
  let csvContent = "\uFEFF";

  // 第一行头：品类与对应天
  const header1 = ["品类/日期"];
  days.forEach((day) => {
    header1.push(`${day}号`, "", ""); // 占三个格子
  });
  header1.push("总数量", "总金额");
  csvContent += header1.map((col) => `"${col}"`).join(",") + "\n";

  // 第二行头：数量、单价、金额
  const header2 = ["细分项目名称"];
  days.forEach(() => {
    header2.push("数量", "单价", "金额(元)");
  });
  header2.push("月累加", "月总金额(元)");
  csvContent += header2.map((col) => `"${col}"`).join(",") + "\n";

  // 填充正文内容行
  items.forEach((item) => {
    const row = [`${item.name} (${item.unit})`];
    let rowQtySum = 0;
    let rowCostSum = 0;

    days.forEach((day) => {
      const entry = item.dailyData[day] || { quantity: 0, price: 0, amount: 0 };
      row.push(
        String(entry.quantity || 0),
        String(entry.price || 0),
        String(entry.amount || 0)
      );
      rowQtySum += entry.quantity || 0;
      rowCostSum += entry.amount || 0;
    });

    row.push(
      String(Math.round(rowQtySum * 100) / 100),
      String(Math.round(rowCostSum * 100) / 100)
    );
    csvContent += row.map((col) => `"${col.replace(/"/g, '""')}"`).join(",") + "\n";
  });

  return csvContent;
}
