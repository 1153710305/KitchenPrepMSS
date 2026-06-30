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
      { name: "大米", category: FoodCategory.GRAIN_OIL, unit: "袋" },
      { name: "面粉", category: FoodCategory.GRAIN_OIL, unit: "袋" },
      { name: "大豆油", category: FoodCategory.GRAIN_OIL, unit: "箱" },
      { name: "猪肉", category: FoodCategory.MEAT, unit: "斤" },
      { name: "牛肉", category: FoodCategory.MEAT, unit: "斤" },
      { name: "鸡蛋", category: FoodCategory.MEAT, unit: "箱" },
      { name: "大豆腐", category: FoodCategory.VEGETABLE, unit: "斤" },
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤" },
      { name: "西红柿", category: FoodCategory.VEGETABLE, unit: "斤" },
      { name: "菠菜", category: FoodCategory.VEGETABLE, unit: "斤" },
      { name: "食用盐", category: FoodCategory.SEASONING, unit: "包" },
      { name: "洗洁精", category: FoodCategory.LOW_CONSUMP, unit: "瓶" },
      { name: "苹果", category: FoodCategory.FRUIT, unit: "斤" },
      { name: "香蕉", category: FoodCategory.FRUIT, unit: "斤" }
    ];
    this.saveToStorage();
    LogBroker.publish("INFO", "RawMaterialsDictService", "原料字典物理缓存缺失，已预载默认原料种子。");
  }

  /**
   * @description 将原料字典物理落盘保存到 LocalStorage 中
   */
  private static saveToStorage(): void {
    try {
      localStorage.setItem(RAW_MATERIALS_DICT_KEY, JSON.stringify(this.items));
    } catch (err) {
      LogBroker.publish("ERROR", "RawMaterialsDictService", "原料字典落盘失败:", String(err));
    }
  }

  /**
   * @description 获取当前所有的原料字典条目列表
   * @returns 原料条目数组
   */
  public static getItems(): RawMaterialDictItem[] {
    if (this.items.length === 0) {
      this.initDict();
    }
    return this.items;
  }

  /**
   * @description 查询某一原料所属大类
   * @param name 原料品名
   * @returns 匹配的二级大品类，找不到返回 null
   */
  public static getCategoryForMaterial(name: string): FoodCategory | null {
    const found = this.getItems().find((item) => item.name === name);
    return found ? found.category : null;
  }

  /**
   * @description 校验并获取原料对应的默认单位
   * @param name 原料品名
   * @returns 默认单位，找不到返回 "斤"
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
   */
  public static async addMaterial(name: string, category: FoodCategory, unit: string): Promise<void> {
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
        unit: unit.trim() || "斤"
      });
      this.saveToStorage();
      LogBroker.publish("INFO", "RawMaterialsDictService", `【原料字典】新增原料「${trimmedName}」（类别: ${category}，单位: ${unit}）`);
      resolve();
    });
  }

  /**
   * @description 更新原料字典条目
   * @param oldName 原有名称
   * @param name 新名称
   * @param category 新大类
   * @param unit 新单位
   */
  public static async updateMaterial(oldName: string, name: string, category: FoodCategory, unit: string): Promise<void> {
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
      this.items[index] = {
        name: trimmedName,
        category,
        unit: unit.trim() || "斤"
      };
      this.saveToStorage();
      LogBroker.publish("INFO", "RawMaterialsDictService", `【原料字典】更新原料「${oldName}」为「${trimmedName}」（类别: ${category}，单位: ${unit}）`);
      
      // 级联同步更新台账与备餐中的所有旧原料项目参数
      LedgerService.cascadeUpdateMaterial(oldName, trimmedName, unit.trim() || "斤");
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
