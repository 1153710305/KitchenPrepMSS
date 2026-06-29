/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 原料购销台账系统专属的常量字典、预设中文文本及默认种子数据
 */

/**
 * @description 默认初始化的四大台账名称配置
 */
export const DEFAULT_LEDGER_NAMES: string[] = ["幼儿", "教师", "幼儿晚餐", "在校生"];

/**
 * @description 预设采购项目的原料大类，在新建原料项目时提供下拉种子推荐
 */
export interface PresetMaterial {
  /** 原料名称 */
  name: string;
  /** 计量单位 */
  unit: string;
  /** 规格描述 */
  spec: string;
  /** 初始库存 */
  initialStock: number;
}

/**
 * @description 种子原料数组
 */
export const PRESET_LEDGER_MATERIALS: PresetMaterial[] = [
  { name: "大米", unit: "袋", spec: "25kg/袋", initialStock: 10 },
  { name: "面粉", unit: "袋", spec: "25kg/袋", initialStock: 5 },
  { name: "大豆油", unit: "箱", spec: "5L*4瓶/箱", initialStock: 8 },
  { name: "猪肉", unit: "斤", spec: "新鲜后腿肉", initialStock: 20 },
  { name: "鸡蛋", unit: "箱", spec: "360枚/箱", initialStock: 2 },
  { name: "大豆腐", unit: "斤", spec: "嫩豆腐", initialStock: 15 },
  { name: "土豆", unit: "斤", spec: "黄沙土豆", initialStock: 50 },
  { name: "西红柿", unit: "斤", spec: "沙地西红柿", initialStock: 40 },
  { name: "食用盐", unit: "包", spec: "400g/包", initialStock: 30 },
  { name: "洗洁精", unit: "瓶", spec: "1.5L/瓶", initialStock: 6 }
];

/**
 * @description 台账系统表头汉化定义
 */
export interface LedgerHeadersText {
  /** 食品原材料名称 */
  materialName: string;
  /** 今日入库数 */
  inQuantity: string;
  /** 今日出库数 */
  outQuantity: string;
  /** 食品索证 */
  certification: string;
  /** 感官性状 */
  sensoryProperty: string;
  /** 供货商及地址 / 经销商 */
  supplier: string;
  /** 采购时间 */
  purchaseDate: string;
  /** 采购员 */
  buyer: string;
  /** 检验员 */
  inspector: string;
  /** 保管员 */
  keeper: string;
  /** 生产日期 */
  produceDate: string;
  /** 保质期 */
  shelfLife: string;
  /** 出库人 */
  outHandler: string;
  /** 接收人 */
  outRecipient: string;
  /** 当日库存/结余 */
  dailyStock: string;
}

/**
 * @description 表头汉化映射字典
 */
export const LEDGER_HEADERS: LedgerHeadersText = {
  materialName: "食品原材料名称",
  inQuantity: "采购入库数量",
  outQuantity: "出库数量",
  certification: "食品索证",
  sensoryProperty: "感官性状",
  supplier: "供货商及地址",
  purchaseDate: "采购时间",
  buyer: "采购员",
  inspector: "检验员",
  keeper: "保管员",
  produceDate: "生产日期",
  shelfLife: "保质期",
  outHandler: "出库人/发料人",
  outRecipient: "接收人/领料人",
  dailyStock: "当日结余库存"
};

/**
 * @description 台账系统界面的中文字面量配置接口
 */
export interface LedgerUiTextType {
  /** 模块标题 */
  moduleTitle: string;
  /** 模块副标题 */
  moduleSubtitle: string;
  /** 台账选择列表头部 */
  listTitle: string;
  /** 新增台账按钮 */
  addLedgerBtn: string;
  /** 新建台账占位符 */
  newLedgerPlaceholder: string;
  /** 导出入库单按钮 */
  exportInBtn: string;
  /** 导出出库单按钮 */
  exportOutBtn: string;
  /** 打印入库单按钮 */
  printInBtn: string;
  /** 打印出库单按钮 */
  printOutBtn: string;
  /** 保存同步按钮 */
  syncSaveBtn: string;
  /** 新增原料项目按钮 */
  addMaterialBtn: string;
  /** 自动同步成功提示 */
  autoSaveSuccess: string;
  /** 物理删除台账二次确认 */
  deleteLedgerConfirm: string;
  /** 物理删除原料二次确认 */
  deleteMaterialConfirm: string;
  /** 样式选择标签 */
  styleLabel: string;
  /** 样式一名称 */
  styleOneName: string;
  /** 样式二名称 */
  styleTwoName: string;
  /** 样式二中经销商输入框默认占位文字 */
  defaultSupplierPlaceholder: string;
  /** 样式二中索证索票输入框默认占位文字 */
  defaultCertificationPlaceholder: string;
}

/**
 * @description 界面通用的中文字符串字典
 */
export const LEDGER_UI_TEXT: LedgerUiTextType = {
  moduleTitle: "原料购销及仓储库存台账系统",
  moduleSubtitle: "支持按日录入今日出入库、自动重算实时物理库存与打印导出",
  listTitle: "系统台账名录",
  addLedgerBtn: "新增台账",
  newLedgerPlaceholder: "请输入新台账名称",
  exportInBtn: "导出当日入库单 (CSV)",
  exportOutBtn: "导出当日出库单 (CSV)",
  printInBtn: "打印入库单",
  printOutBtn: "打印出库单",
  syncSaveBtn: "保存当日出入库数据",
  addMaterialBtn: "新增原料采购项",
  autoSaveSuccess: "台账今日数据已实时计算并自动同步保存！",
  deleteLedgerConfirm: "您确定要永久删除该台账吗？删除后，该台账关联的所有原料及历史所有的出入库、库存明细将彻底消失，此操作不可撤销！",
  deleteMaterialConfirm: "您确定要从本台账中永久移除此原料吗？它的历史出入库记录将被清洗，无法恢复！",
  styleLabel: "呈现样式：",
  styleOneName: "样式一：食品原材料购销总表 (日清单模式)",
  styleTwoName: "样式二：单原料日出入库流水账 (月卡片模式)",
  defaultSupplierPlaceholder: "如: 宾县鑫百达百货超市",
  defaultCertificationPlaceholder: "已索要检验报告与发票"
};
