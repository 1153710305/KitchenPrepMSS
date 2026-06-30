/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FoodCategory } from "./types.ts";
import { LogBroker } from "./utils.ts";
import { LedgerService } from "./ledgerStore.ts";
import { PrepReportService } from "./store.ts";
import { SyncHelper } from "./syncHelper.ts";

/**
 * @description 单个原料字典条目接口
 */
export interface RawMaterialDictItem {
  /** 原料品名，如 "土豆", "猪肉" */
  name: string;
  /** 所属的二级食材大品类 */
  category: FoodCategory;
  /** 默认计量单位，如 "斤", "袋", "箱" */
  unit: string;
  /** 原料备注（规格等），如 "25kg/袋" */
  remark?: string;
  /** 换算单位，如 "斤" */
  conversionUnit?: string;
  /** 换算比例，如 50 */
  conversionRatio?: number;
}

/** 本地 LocalStorage 缓存原料库的 Key */
const RAW_MATERIALS_DICT_KEY = "KITCHEN_RAW_MATERIALS_DICT_V1";

/**
 * @description 原料字典数据服务类，维护系统中可供选择的原料列表，支持后台增删改查
 */
export class RawMaterialsDictService {
  /** 内存中的原料字典列表 */
  private static items: RawMaterialDictItem[] = [];

  /**
   * @description 初始化原料字典。若缓存无数据，使用默认推荐种子数据填充
   * @returns 初始化的原料列表
   */
  public static initDict(): RawMaterialDictItem[] {
    try {
      const cached = localStorage.getItem(RAW_MATERIALS_DICT_KEY);
      if (cached) {
        this.items = JSON.parse(cached);
        LogBroker.publish("INFO", "RawMaterialsDictService", "已成功从物理缓存挂载原料字典数据。");
      } else {
        this.generateDefaultSeeds();
      }
    } catch (err) {
      LogBroker.publish("ERROR", "RawMaterialsDictService", "加载原料字典缓存遇到异常:", String(err));
      this.generateDefaultSeeds();
    }
    return this.items;
  }

  /**
   * @description 生成预置的默认推荐原料种子数据
   */
  private static generateDefaultSeeds(): void {
    this.items = [
      { name: "大米", category: FoodCategory.GRAIN_OIL, unit: "袋", remark: "25kg/袋", conversionUnit: "斤", conversionRatio: 50 },
      { name: "面粉", category: FoodCategory.GRAIN_OIL, unit: "袋", remark: "25kg/袋", conversionUnit: "斤", conversionRatio: 50 },
      { name: "大豆油", category: FoodCategory.GRAIN_OIL, unit: "箱", remark: "20L/箱", conversionUnit: "升", conversionRatio: 20 },
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "西红柿", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "猪肉", category: FoodCategory.MEAT, unit: "斤", remark: "冷鲜" },
      { name: "鸡肉", category: FoodCategory.MEAT, unit: "斤", remark: "冷冻" },
      { name: "盐", category: FoodCategory.SEASONING, unit: "袋", remark: "500g/袋", conversionUnit: "克", conversionRatio: 500 },
      { name: "酱油", category: FoodCategory.SEASONING, unit: "瓶", remark: "1.28L/瓶", conversionUnit: "升", conversionRatio: 1.28 },
      { name: "洗洁精", category: FoodCategory.LOW_CONSUMP, unit: "桶", remark: "5kg/桶", conversionUnit: "斤", conversionRatio: 10 },
      { name: "垃圾袋", category: FoodCategory.LOW_CONSUMP, unit: "包", remark: "100只/包" },
      { name: "苹果", category: FoodCategory.FRUIT, unit: "箱", remark: "10kg/箱", conversionUnit: "斤", conversionRatio: 20 },
      { name: "香蕉", category: FoodCategory.FRUIT, unit: "箱", remark: "9kg/箱", conversionUnit: "斤", conversionRatio: 18 }
    ];
    this.saveToStorage();
  }

  /**
   * @description 物理持久化保存到 LocalStorage
   */
  private static saveToStorage(): void {
    localStorage.setItem(RAW_MATERIALS_DICT_KEY, JSON.stringify(this.items));
  }

  /**
   * @description 获取当前原料字典的所有条目数组
   */
  public static getItems(): RawMaterialDictItem[] {
    if (this.items.length === 0) {
      this.initDict();
    }
    return this.items;
  }

  /**
   * @description 根据原料名获取对应的默认大类
   * @param name 原料名
   * @returns 食材二级大类
   */
  public static getCategoryForMaterial(name: string): FoodCategory | null {
    const found = this.getItems().find((item) => item.name === name);
    return found ? found.category : null;
  }

  /**
   * @description 根据原料名获取对应的默认计量单位
   * @param name 原料名
   * @returns 计量单位字串
   */
  public static getUnitForMaterial(name: string): string {
    const found = this.getItems().find((item) => item.name === name);
    return found ? found.unit : "斤";
  }

  /**
   * @description 添加原料到字典
   * @param name 原料品名
   * @param category 类别
   * @param unit 单位
   * @param remark 备注/规格说明
   * @param conversionUnit 换算单位
   * @param conversionRatio 换算比例
   */
  public static async addMaterial(
    name: string, 
    category: FoodCategory, 
    unit: string, 
    remark?: string, 
    conversionUnit?: string, 
    conversionRatio?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        reject(new Error("原料名称不能为空"));
        return;
      }
      if (this.items.some((item) => item.name === trimmedName)) {
        reject(new Error(`名为 "${trimmedName}" 的原料在字典中已存在`));
        return;
      }
      this.items.push({
        name: trimmedName,
        category,
        unit: unit.trim() || "斤",
        remark: remark?.trim() || "",
        conversionUnit: conversionUnit?.trim() || undefined,
        conversionRatio: conversionRatio || undefined
      });
      this.saveToStorage();
      LogBroker.publish("INFO", "RawMaterialsDictService", `【原料字典】新增原料「${trimmedName}」（类别: ${category}，单位: ${unit}，备注: ${remark}，换算单位: ${conversionUnit}，换算比例: ${conversionRatio}）`);
      resolve();
    });
  }

  /**
   * @description 更新原料字典条目并级联同步修改所有关联采购项与备餐项
   * @param oldName 原有名称
   * @param name 新名称
   * @param category 新大类
   * @param unit 新单位
   * @param remark 新备注/规格说明
   * @param conversionUnit 新换算单位
   * @param conversionRatio 新换算比例
   */
  public static async updateMaterial(
    oldName: string, 
    name: string, 
    category: FoodCategory, 
    unit: string, 
    remark?: string, 
    conversionUnit?: string, 
    conversionRatio?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        reject(new Error("原料名称不能为空"));
        return;
      }
      const index = this.items.findIndex((item) => item.name === oldName);
      if (index === -1) {
        reject(new Error("未找到原原料记录"));
        return;
      }
      // 检查重名 (排除自己)
      if (trimmedName !== oldName && this.items.some((item) => item.name === trimmedName)) {
        reject(new Error(`名为 "${trimmedName}" 的原料已存在`));
        return;
      }
      const finalRemark = remark?.trim() || "";
      this.items[index] = {
        name: trimmedName,
        category,
        unit: unit.trim() || "斤",
        remark: finalRemark,
        conversionUnit: conversionUnit?.trim() || undefined,
        conversionRatio: conversionRatio || undefined
      };
      this.saveToStorage();
      LogBroker.publish("INFO", "RawMaterialsDictService", `【原料字典】更新原料「${oldName}」为「${trimmedName}」（类别: ${category}，单位: ${unit}，备注: ${finalRemark}，换算单位: ${conversionUnit}，换算比例: ${conversionRatio}）`);
       
      // 级联同步更新台账与备餐中的所有旧原料项目参数，备注作为规格传入
      LedgerService.cascadeUpdateMaterial(oldName, trimmedName, unit.trim() || "斤", finalRemark);
      PrepReportService.cascadeUpdateMaterial(oldName, trimmedName, category, unit.trim() || "斤");

      // 同步推送到服务端存盘
      SyncHelper.triggerSyncToServer();
      resolve();
    });
  }

  /**
   * @description 从字典中删除原料
   * @param name 原料品名
   */
  public static async deleteMaterial(name: string): Promise<void> {
    return new Promise((resolve) => {
      this.items = this.items.filter((item) => item.name !== name);
      this.saveToStorage();
      LogBroker.publish("WARN", "RawMaterialsDictService", `【原料字典】移除了原料「${name}」`);
      
      // 级联物理删除关联采购原料项与备餐明细
      LedgerService.cascadeDeleteMaterial(name);
      PrepReportService.cascadeDeleteMaterial(name);

      // 同步推送到服务端存盘
      SyncHelper.triggerSyncToServer();
      resolve();
    });
  }
}
