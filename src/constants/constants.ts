/// <reference types="vite/client" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐系统专属的常量字典：一二级人群/食材大类的中文名映射、默认单位、预设食材种子数据、登录与管理员密码（来自环境变量）以及界面通用中文文案集中管理。
 */

import { FoodCategory } from "../types/types.ts";



/**
 * @description 管理配置后台的默认进入密码，支持从环境变量安全调入
 */
export const ADMIN_PASSWORD = (typeof process !== "undefined" ? process.env.VITE_ADMIN_PASSWORD : (import.meta as any).env?.VITE_ADMIN_PASSWORD) || "admin";

/**
 * @description 系统首页登录的验证密码，支持从环境变量安全调入
 */
export const LOGIN_PASSWORD = (typeof process !== "undefined" ? process.env.VITE_LOGIN_PASSWORD : (import.meta as any).env?.VITE_LOGIN_PASSWORD) || "guest";


/**
 * @description 界面通用的中文文本字面量硬编码，集中管理方便修改
 */
export const UI_TEXT = {
  systemTitle: "食堂备餐管理和统计系统",
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
  sysLogTitle: "管理端实时进程与性能监控日志",
  logClearBtn: "清空控制台日志"
};
