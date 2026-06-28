/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DailyEntry, PreparedItem, SystemLog } from "./types.ts";

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
 * @description 计算单条备菜行内指定天数的金额
 * @param quantity 备菜数量
 * @param price 单价 (元)
 * @returns 计算后的实收金额，精度保留 2 位小数
 */
export function calculateEntryAmount(quantity: number, price: number): number {
  if (isNaN(quantity) || quantity < 0) quantity = 0;
  if (isNaN(price) || price < 0) price = 0;
  return Math.round(quantity * price * 100) / 100;
}

/**
 * @description 获取某一行备菜明细行当月的所有天数的总数量与总金额
 * @param item 细分品类备菜实体
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
 * @description 统一的数据安全性校验，防止导入恶意篡改的代码或JSON格式
 * @param rawJsonData 导入的纯文本 JSON 字符数据
 * @returns 验证通过的合格数组或者抛出错误
 */
export function validateImportedReport(rawJsonData: string): any {
  const parsed = JSON.parse(rawJsonData);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("导入的数据必须是有效的 JSON 对象。");
  }
  
  // 验证必填字段
  if (Array.isArray(parsed)) {
    // 如果是旧报表数组格式，检验每一项
    parsed.forEach((item, index) => {
      if (!item.id || !item.name || !item.category || !item.targetGroup) {
        throw new Error(`数组索引 ${index} 处的备菜条目缺少核心必填字段。`);
      }
    });
  } else if (parsed.reports || parsed.items) {
    LogBroker.publish("INFO", "validateImportedReport", "验证带复合结构月度备份包");
  } else {
    throw new Error("JSON数据结构不合规，无法识别的归档指纹。");
  }
  return parsed;
}

/**
 * @description 将指定品类的细分备菜矩阵导出为标准的 Excel 可兼容 CSV 文本格式
 * @param items 该类目的备菜行列表
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

/**
 * @description 按照餐卡人群将所有的表格汇总导出为标准的 Excel 可兼容 CSV 文本格式
 * @param reports 全月所有人群的报表数组
 * @param days 当前月份的所有天数 (如 1号 到 31号)
 * @param activeGroups 当前活跃的动态人群分组列表
 * @param activeCategories 当前活跃的动态食材大类列表
 * @returns 包含所有餐位、所有食材大类、所有天数数量单价金额的 CSV 纯文本
 */
export function convertAllGroupsToCsv(
  reports: any[],
  days: string[],
  activeGroups: any[],
  activeCategories: any[]
): string {
  // UTF-8 BOM，防止 Excel 打开中文乱码
  let csvContent = "\uFEFF";
  
  // 第一行表头：基础信息与对应的每一天号数
  const header1 = ["餐卡人群", "食材大类", "细分项目名称", "单位"];
  days.forEach((day) => {
    header1.push(`${day}号`, "", ""); // 每个日期占三个单元格：数量、单价、金额
  });
  header1.push("全月累加数量", "全月总金额(元)");
  csvContent += header1.map((col) => `"${col}"`).join(",") + "\n";
  
  // 第二行表头：具体属性列指示
  const header2 = ["", "", "", ""];
  days.forEach(() => {
    header2.push("数量", "单价", "金额(元)");
  });
  header2.push("数量", "金额(元)");
  csvContent += header2.map((col) => `"${col}"`).join(",") + "\n";
  
  // 按照活跃的人设客群 + 食材大类 逐级排序填充内容行
  activeGroups.forEach((group) => {
    const report = reports.find((r) => r.targetGroup === group.key);
    if (!report) return;

    activeCategories.forEach((cat) => {
      const catItems = report.items.filter((item) => item.category === cat.key);
      
      catItems.forEach((item) => {
        const row = [
          group.label, // 餐卡人群
          cat.label,   // 食材大类
          item.name,   // 食材名称
          item.unit    // 单位
        ];
        
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
    });
  });
  
  return csvContent;
}

