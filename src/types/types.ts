/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐系统相关的基础类型定义：目标受众人群与食材大类标识符、备餐明细条目接口（现由 TableGrid 等
 * 展示视图从台账 LedgerItem 数据实时派生渲染，不再对应任何持久化实体）、动态人群/大类配置、系统日志接口等。
 */

/**
 * @description 备餐目标受众人群标识符
 */
export type TargetGroup = string;

/**
 * @description 食品与辅料主要分类标识符
 */
export type FoodCategory = string;

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
  /** 是否为系统默认生成的一级受众（默认数据仅允许编辑，不允许删除） */
  isDefault?: boolean;
}

/**
 * @description 动态二级食材大类配置，支持后台增删改查
 */
export interface DynamicCategory {
  /** 唯一标识键，如 VEGETABLE, MEAT 等 */
  key: string;
  /** 界面显示分类名称，如 蔬菜, 肉类 */
  label: string;
  /** 是否为系统默认生成的二级品类（默认数据仅允许编辑，不允许删除） */
  isDefault?: boolean;
}

