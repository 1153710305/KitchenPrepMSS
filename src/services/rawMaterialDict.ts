/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 原料大字典业务数据服务层（RawMaterialsDictService）：管理全局原料名称/单位/所属大类/换算比例等字典条目的增删改查，是备餐报表与台账系统共用的原料基础数据源。
 */

import { FoodCategory } from "../types/types.ts";
import { LogBroker } from "../utils.ts";
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
  /** 是否为系统默认生成的原料（默认数据仅允许编辑，不允许删除） */
  isDefault?: boolean;
}

/**
 * @description 原料字典数据服务类，维护系统中可供选择的原料列表，支持后台增删改查
 */
export class RawMaterialsDictService {
  /** 内存中的原料字典列表 */
  private static items: RawMaterialDictItem[] = [];

  /**
   * @description 初始化原料字典。若内存无数据，使用默认推荐种子数据填充
   * @returns 初始化的原料列表
   */
  public static initDict(): RawMaterialDictItem[] {
    return this.items;
  }

  /**
   * @description 供系统启动时统一由服务器加载数据并覆盖字典内存
   * @param serverDictItems 从服务器拉取回来的原料字典条目数组
   */
  public static initDictFromServer(serverDictItems?: RawMaterialDictItem[]): RawMaterialDictItem[] {
    if (serverDictItems && serverDictItems.length > 0) {
      const deduped = this.dedupeByName(serverDictItems);
      this.items = deduped;
      LogBroker.publish("INFO", "RawMaterialsDictService", "已成功从服务器同步载入原料字典数据");
      // 若服务器数据存在历史同名重复脏数据，待全局初始化解锁时回写服务器，避免下次加载再次触发（此刻系统尚处于初始化加载中，直接同步会被安全锁拦截丢弃）。
      // 去重可能涉及任意多个条目，无法精确描述"改了哪一条"，因此整批 replaceAll 覆盖回写，属于批量初始化场景而非用户增量编辑
      if (deduped.length !== serverDictItems.length) {
        SyncHelper.runWhenInitialized(() => {
          SyncHelper.queueChange({ entity: "rawMaterial", op: "replaceAll", data: this.items });
        });
      }
    } else {
      this.items = [];
      LogBroker.publish("WARN", "RawMaterialsDictService", "未收到有效的服务端字典数据，可能处于断网状态或服务异常。");
    }
    return this.items;
  }

  /**
   * @description 按原料名对字典条目去重（同名条目保留最后出现的一条，视为更晚写入的最新数据），避免历史脏数据导致列表渲染出现重复 key
   * @param items 待去重的原始条目数组
   * @returns 去重后的条目数组
   */
  private static dedupeByName(items: RawMaterialDictItem[]): RawMaterialDictItem[] {
    const map = new Map<string, RawMaterialDictItem>();
    let hasDuplicate = false;
    for (const item of items) {
      if (map.has(item.name)) {
        hasDuplicate = true;
      }
      map.set(item.name, item);
    }
    if (hasDuplicate) {
      LogBroker.publish("WARN", "RawMaterialsDictService", "检测到原料字典中存在同名重复条目，已自动去重");
    }
    return Array.from(map.values());
  }


  /**
   * @description 系统预置的默认推荐原料种子清单（不含 isDefault 标记），供生成种子数据与迁移历史数据共用同一份基准数据源，
   * 避免维护两份重复列表导致后续新增/调整种子原料时出现遗漏或不一致
   */
  public static getDefaultSeedList(): RawMaterialDictItem[] {
    return [
      // 蔬菜类 (VEGETABLE)
      { name: "土豆", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "柿子", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "黄瓜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "胡萝卜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "青椒", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "葱", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "蒜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "香菜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "豆芽", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "大萝卜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "紫菜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "角瓜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "蒜苔", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "白萝卜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "窝瓜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "黑芝麻", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "粉条", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "酵母", category: FoodCategory.VEGETABLE, unit: "袋", remark: "" },
      { name: "豆沙", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "白菜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "木耳", category: FoodCategory.VEGETABLE, unit: "斤", remark: "干货" },
      { name: "菠菜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "圆葱", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "香其酱", category: FoodCategory.VEGETABLE, unit: "袋", remark: "90g/袋" },
      { name: "烧烤料", category: FoodCategory.VEGETABLE, unit: "斤", remark: "" },
      { name: "甘蓝", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "香菇", category: FoodCategory.VEGETABLE, unit: "斤", remark: "鲜香菇" },
      { name: "粉丝", category: FoodCategory.VEGETABLE, unit: "袋", remark: "袋装" },
      { name: "茄子", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "虾皮", category: FoodCategory.VEGETABLE, unit: "斤", remark: "袋装" },
      { name: "山药", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "大豆腐", category: FoodCategory.VEGETABLE, unit: "刀", remark: "" },
      { name: "芹菜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "油菜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "菜花", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "干豆腐", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },
      { name: "冬瓜", category: FoodCategory.VEGETABLE, unit: "斤", remark: "散装" },

      // 粮油类 (GRAIN_OIL)
      { name: "大米", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "" },
      { name: "豆油", category: FoodCategory.GRAIN_OIL, unit: "桶", remark: "", "conversionUnit": "桶" },
      { name: "面粉", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "" },
      { name: "黑米", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "散装" },
      { name: "黄米", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "散装" },
      { name: "燕麦", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "袋装" },
      { name: "小碴子", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "散装" },
      { name: "小米", category: FoodCategory.GRAIN_OIL, unit: "斤", remark: "散装" },
      { name: "挂面", category: FoodCategory.GRAIN_OIL, unit: "包", remark: "袋装" },

      // 调料类 (SEASONING)
      { name: "盐", category: FoodCategory.SEASONING, unit: "袋", remark: "" },
      { name: "味素", category: FoodCategory.SEASONING, unit: "袋", remark: "袋装" },
      { name: "鸡精", category: FoodCategory.SEASONING, unit: "袋", remark: "袋装" },
      { name: "淀粉", category: FoodCategory.SEASONING, unit: "斤", remark: "" },
      { name: "酱油", category: FoodCategory.SEASONING, unit: "桶", remark: "1.28L/桶" },
      { name: "老抽", category: FoodCategory.SEASONING, unit: "桶", remark: "1.28L/桶" },
      { name: "白糖", category: FoodCategory.SEASONING, unit: "斤", remark: "" },
      { name: "十三香", category: FoodCategory.SEASONING, unit: "盒", remark: "盒装" },
      { name: "花椒", category: FoodCategory.SEASONING, unit: "斤", remark: "" },
      { name: "大料", category: FoodCategory.SEASONING, unit: "斤", remark: "" },

      // 肉类 (MEAT)
      { name: "精肉", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "牛肉", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "鸡腿肉", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "鸡翅根", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "精五花", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "羊肉片", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "鸡蛋", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "火腿肠", category: FoodCategory.MEAT, unit: "捆", remark: "" },
      { name: "排骨", category: FoodCategory.MEAT, unit: "斤", remark: "冷鲜" },
      { name: "大虾", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "鱼丸", category: FoodCategory.MEAT, unit: "斤", remark: "" },
      { name: "巴沙鱼", category: FoodCategory.MEAT, unit: "斤", remark: "" },

      // 低耗品 (LOW_CONSUMP)
      { name: "中袋", category: FoodCategory.LOW_CONSUMP, unit: "捆", remark: "" },
      { name: "大黑袋", category: FoodCategory.LOW_CONSUMP, unit: "捆", remark: "" },
      { name: "一次性手套", category: FoodCategory.LOW_CONSUMP, unit: "袋", remark: "" },
      // 水果 (FRUIT)
      { name: "沃柑", category: FoodCategory.FRUIT, unit: "斤", remark: "" },
      { name: "香梨", category: FoodCategory.FRUIT, unit: "箱", remark: "10kg/箱", "conversionUnit": "斤", "conversionRatio": 20 },
      { name: "西瓜", category: FoodCategory.FRUIT, unit: "斤", remark: "散装" },
      { name: "苹果", category: FoodCategory.FRUIT, unit: "斤", remark: "", "conversionUnit": "斤", "conversionRatio": 20 },
      { name: "沙白瓜", category: FoodCategory.FRUIT, unit: "斤", remark: "散装" },
      { name: "香蕉", category: FoodCategory.FRUIT, unit: "斤", remark: "" }
    ];
  }

  /**
   * @description 供心跳轮询静默更新内存中的原料字典列表，防止 LocalStorage 覆写
   */
  public static setRawMaterialsDictInMemory(items: RawMaterialDictItem[]): void {
    // 心跳轮询数据同样做防呆去重，避免历史脏数据在轮询覆盖时持续产生重复 key（此路径不回写服务器，避免高频心跳触发多余保存）
    this.items = this.dedupeByName(items);
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
      const newItem: RawMaterialDictItem = {
        name: trimmedName,
        category,
        unit: unit.trim() || "斤",
        remark: remark?.trim() || "",
        conversionUnit: conversionUnit?.trim() || undefined,
        conversionRatio: conversionRatio || undefined
      };
      this.items.push(newItem);
      SyncHelper.queueChange({ entity: "rawMaterial", op: "upsert", key: trimmedName, data: newItem });
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
      const updatedItem: RawMaterialDictItem = {
        name: trimmedName,
        category,
        unit: unit.trim() || "斤",
        remark: finalRemark,
        conversionUnit: conversionUnit?.trim() || undefined,
        conversionRatio: conversionRatio || undefined,
        // 保留原有的默认数据标记，确保系统默认原料被编辑（含改名）后依然不可删除
        isDefault: this.items[index].isDefault
      };
      this.items[index] = updatedItem;
      // name 本身是后端表的主键，改名时需要把旧主键一并带上，供后端删除旧行、避免留下重复条目
      SyncHelper.queueChange({
        entity: "rawMaterial", op: "upsert", key: trimmedName, data: updatedItem,
        previousKey: trimmedName !== oldName ? oldName : undefined
      });
      LogBroker.publish("INFO", "RawMaterialsDictService", `【原料字典】更新原料「${oldName}」为「${trimmedName}」（类别: ${category}，单位: ${unit}，备注: ${finalRemark}，换算单位: ${conversionUnit}，换算比例: ${conversionRatio}）`);

      // 级联同步更新台账与备餐中的所有旧原料项目参数，备注作为规格传入（各自会通过 queueChange 描述自己的增量变更）
      LedgerService.cascadeUpdateMaterial(oldName, trimmedName, unit.trim() || "斤", finalRemark);
      PrepReportService.cascadeUpdateMaterial(oldName, trimmedName, category, unit.trim() || "斤");
      resolve();
    });
  }

  /**
   * @description 从字典中删除原料（系统默认生成的原料不允许删除，仅允许编辑）
   * @param name 原料品名
   */
  public static async deleteMaterial(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = this.items.find((item) => item.name === name);
      if (target?.isDefault) {
        reject(new Error(`「${name}」是系统默认原料，不允许删除，如需调整可编辑其属性`));
        return;
      }
      this.items = this.items.filter((item) => item.name !== name);
      SyncHelper.queueChange({ entity: "rawMaterial", op: "delete", key: name });
      LogBroker.publish("WARN", "RawMaterialsDictService", `【原料字典】移除了原料「${name}」`);

      // 级联物理删除关联采购原料项与备餐明细（各自会通过 queueChange 描述自己的增量变更）
      LedgerService.cascadeDeleteMaterial(name);
      PrepReportService.cascadeDeleteMaterial(name);
      resolve();
    });
  }
}
