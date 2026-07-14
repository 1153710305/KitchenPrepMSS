/// <reference types="vite/client" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐系统专属的常量字典：一二级人群/食材大类的中文名映射、默认单位、预设食材种子数据、登录与管理员密码（来自环境变量）以及界面通用中文文案集中管理。
 */




/**
 * @description 管理配置后台的默认进入密码，支持从环境变量安全调入
 */
export const ADMIN_PASSWORD = (typeof process !== "undefined" ? process.env.VITE_ADMIN_PASSWORD : (import.meta as any).env?.VITE_ADMIN_PASSWORD) || "admin";

/**
 * @description 系统首页登录的验证密码，支持从环境变量安全调入
 */
export const LOGIN_PASSWORD = (typeof process !== "undefined" ? process.env.VITE_LOGIN_PASSWORD : (import.meta as any).env?.VITE_LOGIN_PASSWORD) || "guest";


/**
 * @description 界面通用的中文文本字面量硬编码，集中管理方便修改。
 * [V2 架构演进] 备餐记账主表格改为台账数据的只读派生展示后，原来服务于"可编辑表格"功能
 * （导入导出JSON、清空录入、批量调价、独立新增项按钮等）的文案已随对应功能一并删除，
 * 此处只保留展示层仍在实际使用的三个字段。
 */
export const UI_TEXT = {
  saveSuccess: "月备餐数据已自动保存至本地缓存！",
  summaryName: "全品类预算合计汇总",
  noDataMessage: "该品类暂无细分材料，请在左侧「原料购销台账」中录入对应原料的出入库数据。"
};
