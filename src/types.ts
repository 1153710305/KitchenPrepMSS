/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐目标受众人群枚举
 */
export enum TargetGroup {
  /** 教师 */
  TEACHER = "TEACHER",
  /** 幼儿 */
  KID = "KID",
  /** 低年级学生 */
  LOW_GRADE = "LOW_GRADE",
  /** 高年级学生 */
  HIGH_GRADE = "HIGH_GRADE"
}

/**
 * @description 食品与辅料主要分类枚举
 */
export enum FoodCategory {
  /** 蔬菜类 */
  VEGETABLE = "VEGETABLE",
  /** 粮油类 */
  GRAIN_OIL = "GRAIN_OIL",
  /** 调料类 */
  SEASONING = "SEASONING",
  /** 肉类 */
  MEAT = "MEAT",
  /** 低耗品（一次性用品、纸巾等） */
  LOW_CONSUMP = "LOW_CONSUMP",
  /** 水果类 */
  FRUIT = "FRUIT"
}

/**
 * @description 每日具体配餐录入项
 */
export interface DailyEntry {
  /** 备餐数量 */
  quantity: number;
  /** 单价 (元) */
  price: number;
  /** 总金额 (元)，数量 * 单价的动态计算值 */
  amount: number;
}

/**
 * @description 细分菜品或原料条目接口
 */
export interface PreparedItem {
  /** 唯一标识符 */
  id: string;
  /** 原料细分品类名称 (例如: 土豆, 西红柿) */
  name: string;
  /** 所属主品类 (例如: 蔬菜, 肉类) */
  category: FoodCategory;
  /** 适用受众人群分类 (例如: 幼儿, 教师) */
  targetGroup: TargetGroup;
  /** 包装或计量单位 (例如: 斤, 公斤, 升, 箱) */
  unit: string;
  /** 1号到31号的日明细记录，以天数 "1" 到 "31" 作为 Key */
  dailyData: Record<string, DailyEntry>;
  /** 备注说明 */
  note?: string;
}

/**
 * @description 某一受众群体的月度完整报表
 */
export interface GroupMonthlyReport {
  /** 目标人群类型 */
  targetGroup: TargetGroup;
  /** 年度 */
  year: number;
  /** 月度 (1-12) */
  month: number;
  /** 细分备餐明细行列表 */
  items: PreparedItem[];
  /** 每日就餐人数 (1号到31号日度数据)，以天数 "1" 到 "31" 作为 Key */
  dailyHeadcount?: Record<string, number>;
}

/**
 * @description 统一系统性能/操作日志接口，方便开发排查和用户了解状态
 */
export interface SystemLog {
  /** 唯一日志ID */
  id: string;
  /** 日期时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: "INFO" | "WARN" | "ERROR";
  /** 模块名称 */
  module: string;
  /** 日志简单消息描述 */
  message: string;
  /** 详细调试上下文或报错堆栈 */
  details?: string;
}


/**
 * @description 动态一级人群配置，支持后台增删改查
 */
export interface DynamicGroup {
  /** 唯一标识键，如 TEACHER, KID 等 */
  key: string;
  /** 界面显示名称，如 教师备餐 */
  label: string;
  /** 展现用表情符号，如 🏫, 👶 等 */
  emoji: string;
}

/**
 * @description 动态二级食材大类配置，支持后台增删改查
 */
export interface DynamicCategory {
  /** 唯一标识键，如 VEGETABLE, MEAT 等 */
  key: string;
  /** 界面显示分类名称，如 蔬菜, 肉类 */
  label: string;
}

