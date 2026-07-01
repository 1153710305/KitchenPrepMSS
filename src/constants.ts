/// <reference types="vite/client" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FoodCategory, TargetGroup } from "./types.ts";

/**
 * @description 目标人群的中文字典映射
 */
export const TARGET_GROUP_LABELS: Record<TargetGroup, string> = {
  [TargetGroup.TEACHER]: "教师备餐",
  [TargetGroup.KID]: "幼儿备餐",
  [TargetGroup.LOW_GRADE]: "低年级备餐",
  [TargetGroup.HIGH_GRADE]: "高年级备餐"
};

/**
 * @description 食物品类的中文字典映射
 */
export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  [FoodCategory.VEGETABLE]: "蔬菜",
  [FoodCategory.GRAIN_OIL]: "粮油",
  [FoodCategory.SEASONING]: "调料",
  [FoodCategory.MEAT]: "肉类",
  [FoodCategory.LOW_CONSUMP]: "低耗品",
  [FoodCategory.FRUIT]: "水果"
};

/**
 * @description 每个基本品类默认的单位映射
 */
export const CATEGORY_DEFAULT_UNITS: Record<FoodCategory, string> = {
  [FoodCategory.VEGETABLE]: "斤",
  [FoodCategory.GRAIN_OIL]: "袋",
  [FoodCategory.SEASONING]: "瓶",
  [FoodCategory.MEAT]: "斤",
  [FoodCategory.LOW_CONSUMP]: "包",
  [FoodCategory.FRUIT]: "斤"
};

/**
 * @description 根据用户提供的图片表格，整理录入的常见食材和辅料名单作为各分类的预设种子数据
 */
export const PRESET_ITEMS_BY_CATEGORY: Record<FoodCategory, string[]> = {
  [FoodCategory.VEGETABLE]: [
    "土豆", "柿子", "黄瓜", "胡萝卜", "青椒", "葱", "蒜", "香菜", "豆芽",
    "大萝卜", "紫菜", "角瓜", "蒜苔", "白萝卜", "窝瓜", "白菜", "木耳",
    "菠菜", "圆葱", "甘蓝", "香菇", "茄子", "山药", "大豆腐", "芹菜",
    "油菜", "菜花", "干豆腐", "冬瓜"
  ],
  [FoodCategory.GRAIN_OIL]: [
    "大米", "面粉", "黑芝麻", "粉条", "酵母", "豆沙", "粉丝", "小米", "糯米", "大豆油"
  ],
  [FoodCategory.SEASONING]: [
    "香其酱", "烧烤料", "虾皮", "食用盐", "白砂糖", "鸡精", "酱油", "香醋", "十三香", "料酒"
  ],
  [FoodCategory.MEAT]: [
    "猪肉", "牛肉", "鸡肉", "排骨", "鸡蛋", "鱼肉", "虾仁"
  ],
  [FoodCategory.LOW_CONSUMP]: [
    "一次性餐盒", "垃圾袋", "洗洁精", "保鲜膜", "手套", "抹布", "消毒剂"
  ],
  [FoodCategory.FRUIT]: [
    "苹果", "香蕉", "西瓜", "橘子", "鸭梨", "哈密瓜", "小番茄"
  ]
};

/**
 * @description 管理配置后台的默认进入密码，支持从环境变量安全调入
 */
export const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "admin";

/**
 * @description 系统首页登录的验证密码，支持从环境变量安全调入
 */
export const LOGIN_PASSWORD = import.meta.env.VITE_LOGIN_PASSWORD || "guest";


/**
 * @description 界面通用的中文文本字面量硬编码，集中管理方便修改
 */
export const UI_TEXT = {
  systemTitle: "食堂备菜管理和统计系统",
  systemSubtitle: "智能高效的日度矩阵记账及膳食营养辅助决策面板",
  exportBtn: "导出月度数据 (JSON)",
  importBtn: "导入备份数据",
  exportCsvBtn: "导出当前表 (CSV)",
  clearBtn: "清空当月录入",
  resetBtn: "恢复出厂种子数据",
  saveSuccess: "月备餐数据已自动保存至本地缓存！",
  saveError: "自动保存数据时遇到异常，请检查存储空间。",
  importSuccess: "备份数据导入成功！系统已完成多维重绘。",
  importError: "导入的数据文件格式格式不正确，校验未通过。",
  clearConfirm: "您确定要清空当前所有备餐人员、所有星期的录入金额吗？该操作不可撤销。",
  itemAddBtn: "新增项",
  itemNamePlaceholder: "请输入原材料名称",
  actionCol: "操作",
  deleteTitle: "删除",
  itemUnit: "单位",
  totalLabel: "合计汇总",
  summaryName: "全品类预算合计汇总",
  quantityShort: "数量",
  priceShort: "单价",
  amountShort: "金额",
  totalQuantity: "月数量累计",
  totalAmount: "月金额累计",
  batchPriceBtn: "批量修改同列价格",
  batchPricePrompt: "请输入一个统一单价 (元)：",
  noDataMessage: "该品类暂无细分材料，请在左侧或上方点击“新增项”添加。",
  yearLabel: "年份",
  monthLabel: "月份",
  aiAssistantTitle: "AI 食堂精细化膳食与成本规划师",
  aiToggleClassic: "传统常规分析",
  aiToggleStream: "极速对话流式模式",
  aiAnalyzeBtn: "运行 AI 智能备菜审计与配餐预测",
  aiPromptHelper: "智能提示词方案",
  sysLogTitle: "管理端实时进程与性能监控日志",
  logClearBtn: "清空控制台日志"
};
