/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ledger, LedgerItem, DailyStockRecord } from "./ledgerTypes.ts";
import { DEFAULT_LEDGER_NAMES, PRESET_LEDGER_MATERIALS } from "./ledgerConstants.ts";
import { LogBroker } from "./utils.ts";
import { SyncHelper } from "./syncHelper.ts";
import { PrepReportService } from "./store.ts";
import { RawMaterialsDictService } from "./rawMaterialDict.ts";
import { FoodCategory } from "./types.ts";

/** 本地 LocalStorage 缓存台账列表的 Key */
const LEDGERS_LIST_KEY = "KITCHEN_LEDGERS_LIST_V2";
/** 本地 LocalStorage 缓存采购项目原料列表的 Key */
const LEDGER_ITEMS_KEY = "KITCHEN_LEDGER_ITEMS_V2";
/** 模拟接口响应延迟 */
const LEDGER_API_LATENCY = 100;

/** 
 * @description 台账状态变动侦听回调 
 */
export type LedgerChangeListener = (ledgers: Ledger[], items: LedgerItem[]) => void;

/**
 * @description 原料购销台账系统的本地服务层类，支持前后端分离的无耦合接口设计
 */
export class LedgerService {
  /** 内存中的台账列表 */
  private static ledgers: Ledger[] = [];
  /** 内存中的原料项目列表 */
  private static ledgerItems: LedgerItem[] = [];
  /** 状态变动侦听器列表 */
  private static changeListeners: LedgerChangeListener[] = [];

  /**
   * @description 订阅台账与原料的状态变更
   * @param listener 侦听器回调函数
   * @returns 取消订阅的卸载函数
   */
  public static subscribe(listener: LedgerChangeListener): () => void {
    this.changeListeners.push(listener);
    // 订阅时立即分发一次当前数据，确保订阅者同步状态
    listener([...this.ledgers], [...this.ledgerItems]);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  /**
   * @description 触发并分发变更通知到所有的订阅者，并自动将数据同步存入 LocalStorage
   */
  private static notifyListeners(): void {
    this.saveToStorage();
    this.changeListeners.forEach((listener) => {
      try {
        listener([...this.ledgers], [...this.ledgerItems]);
      } catch (err) {
        LogBroker.publish("ERROR", "LedgerService", "分发台账数据变动通知失败:", String(err));
      }
    });
  }

  /**
   * @description 将数据物理落盘保存到 LocalStorage 中
   */
  private static saveToStorage(): void {
    try {
      localStorage.setItem(LEDGERS_LIST_KEY, JSON.stringify(this.ledgers));
      localStorage.setItem(LEDGER_ITEMS_KEY, JSON.stringify(this.ledgerItems));
      // 异步同步至后端存储
      SyncHelper.triggerSyncToServer();
    } catch (err) {
      LogBroker.publish("ERROR", "LedgerService", "数据落盘LocalStorage遇到异常，请检查物理存储空间。", String(err));
    }
  }

  /**
   * @description 启动并自检缓存。若没有，则自动生成四个默认种子台账，并导入默认采购原料项目
   */
  public static async initLedgerStore(): Promise<{ ledgers: Ledger[]; items: LedgerItem[] }> {
    try {
      // 优先从后端拉取最新同步数据落盘
      await SyncHelper.loadFromServer();
    } catch (err) {
      LogBroker.publish("WARN", "LedgerService", "同步服务器数据失败，降级使用本地缓存: " + String(err));
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          const cachedLedgers = localStorage.getItem(LEDGERS_LIST_KEY);
          const cachedItems = localStorage.getItem(LEDGER_ITEMS_KEY);

          if (cachedLedgers && cachedItems) {
            this.ledgers = JSON.parse(cachedLedgers);
            this.ledgerItems = JSON.parse(cachedItems);
            LogBroker.publish("INFO", "LedgerService", "成功从物理缓存重新挂载原料购销台账及原料项目明细");
          } else {
            this.generateSeeds();
          }
          resolve({ ledgers: this.ledgers, items: this.ledgerItems });
        } catch (err) {
          LogBroker.publish("ERROR", "LedgerService", "启动阶段自检台账缓存遇到异常:", String(err));
          this.generateSeeds();
          resolve({ ledgers: this.ledgers, items: this.ledgerItems });
        }
      }, LEDGER_API_LATENCY);
    });
  }

  private static generateSeeds(): void {
    LogBroker.publish("INFO", "LedgerService", "台账物理缓存缺失，正在合成第一款初始种子台账和预设采购项...");
    
    const alignedGroups = [
      { key: "KID", name: "幼儿备餐" },
      { key: "STUDENT", name: "在校生备餐" },
      { key: "TEACHER", name: "教师备餐" }
    ];

    const initialLedgers: Ledger[] = alignedGroups.map((group) => ({
      id: group.key,
      name: group.name,
      createdAt: new Date().toISOString()
    }));

    const initialItems: LedgerItem[] = [];

    initialLedgers.forEach((ledger) => {
      PRESET_LEDGER_MATERIALS.forEach((material, matIndex) => {
        // 创建该采购项默认的空记录明细
        const dailyRecords: Record<string, DailyStockRecord> = {};
        
        initialItems.push({
          id: `ledger_item_${ledger.id}_${matIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          ledgerId: ledger.id,
          name: material.name,
          unit: material.unit,
          spec: material.spec,
          initialStock: material.initialStock,
          currentStock: material.initialStock, // 初始化时当前库存等于初始库存
          dailyRecords
        });
      });
    });

    this.ledgers = initialLedgers;
    this.ledgerItems = initialItems;
    this.saveToStorage();
    LogBroker.publish("INFO", "LedgerService", `成功对齐合成四大默认台账「教师备餐、幼儿备餐、低年级备餐、高年级备餐」，每个台账下预载 ${PRESET_LEDGER_MATERIALS.length} 项初始原料。`);
  }

  /**
   * @description 获取所有的台账列表
   */
  public static getLedgers(): Ledger[] {
    return this.ledgers;
  }

  /**
   * @description 新增一本购销台账，并自动生成一组推荐的原料种子采购项目
   * @param name 台账名称
   */
  public static async addLedger(name: string): Promise<Ledger> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!name.trim()) {
          reject(new Error("台账名称不能为空"));
          return;
        }

        const normalizedName = name.trim();
        if (this.ledgers.some((l) => l.name === normalizedName)) {
          reject(new Error(`名称为 "${normalizedName}" 的台账已存在`));
          return;
        }

        const newId = `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const newLedger: Ledger = {
          id: newId,
          name: normalizedName,
          createdAt: new Date().toISOString()
        };

        // 自动克隆种子原料到这个新台账中
        const newItems: LedgerItem[] = PRESET_LEDGER_MATERIALS.map((material, index) => ({
          id: `ledger_item_${newLedger.id}_${index}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          ledgerId: newLedger.id,
          name: material.name,
          unit: material.unit,
          spec: material.spec,
          initialStock: material.initialStock,
          currentStock: material.initialStock,
          dailyRecords: {}
        }));

        this.ledgers = [...this.ledgers, newLedger];
        this.ledgerItems = [...this.ledgerItems, ...newItems];

        this.notifyListeners();
        LogBroker.publish("INFO", "LedgerService", `【新增台账】成功新增台账「${normalizedName}」，并关联导入 ${PRESET_LEDGER_MATERIALS.length} 项初始采购原料`);
        
        // 双向同步：通知备餐系统添加人群
        PrepReportService.syncGroupFromLedger(newId, normalizedName);
        
        resolve(newLedger);
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 重命名某本台账名称
   * @param id 台账ID
   * @param name 新的台账名字
   */
  public static async updateLedger(id: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!name.trim()) {
          reject(new Error("台账名称不能为空"));
          return;
        }

        const ledgerIndex = this.ledgers.findIndex((l) => l.id === id);
        if (ledgerIndex === -1) {
          reject(new Error("找不到该台账"));
          return;
        }

        const oldName = this.ledgers[ledgerIndex].name;
        const normalizedName = name.trim();

        // 校验重名 (排除自己)
        if (this.ledgers.some((l) => l.name === normalizedName && l.id !== id)) {
          reject(new Error(`名称为 "${normalizedName}" 的台账已存在`));
          return;
        }

        const updatedLedgers = [...this.ledgers];
        updatedLedgers[ledgerIndex] = {
          ...updatedLedgers[ledgerIndex],
          name: normalizedName
        };

        this.ledgers = updatedLedgers;
        this.notifyListeners();
        LogBroker.publish("INFO", "LedgerService", `【修改台账】成功将台账「${oldName}」更名为「${normalizedName}」`);
        
        // 双向同步：通知备餐系统修改人群
        PrepReportService.syncGroupFromLedger(id, normalizedName);
        
        resolve();
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 物理彻底删除某本台账，同步级联删除其下的所有原料采购项目和出入库账单
   * @param id 台账ID
   */
  public static async deleteLedger(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const ledger = this.ledgers.find((l) => l.id === id);
        if (!ledger) {
          reject(new Error("找不到待删除的台账"));
          return;
        }

        // 不可变方式过滤清理
        this.ledgers = this.ledgers.filter((l) => l.id !== id);
        this.ledgerItems = this.ledgerItems.filter((item) => item.ledgerId !== id);

        this.notifyListeners();
        LogBroker.publish("WARN", "LedgerService", `【删除台账】物理清空了台账「${ledger.name}」以及其下的所有原料出入库及库存账单`);
        
        // 双向同步：通知备餐系统移出人群
        PrepReportService.syncDeleteGroupFromLedger(id);
        
        resolve();
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 从餐位分组同步新增/修改台账
   */
  public static syncLedgerFromGroup(id: string, name: string): void {
    const existing = this.ledgers.find((l) => l.id === id);
    if (existing) {
      if (existing.name !== name) {
        existing.name = name;
        this.notifyListeners();
      }
    } else {
      const newLedger: Ledger = {
        id,
        name,
        createdAt: new Date().toISOString()
      };
      
      const newItems: LedgerItem[] = PRESET_LEDGER_MATERIALS.map((material, index) => ({
        id: `ledger_item_${newLedger.id}_${index}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        ledgerId: newLedger.id,
        name: material.name,
        unit: material.unit,
        spec: material.spec,
        initialStock: material.initialStock,
        currentStock: material.initialStock,
        dailyRecords: {}
      }));
      
      this.ledgers = [...this.ledgers, newLedger];
      this.ledgerItems = [...this.ledgerItems, ...newItems];
      this.notifyListeners();
    }
  }

  /**
   * @description 从餐位分组同步物理删除台账
   */
  public static syncDeleteLedgerFromGroup(id: string): void {
    const upperId = id.toUpperCase();
    const ledger = this.ledgers.find((l) => l.id.toUpperCase() === upperId);
    if (ledger) {
      this.ledgers = this.ledgers.filter((l) => l.id.toUpperCase() !== upperId);
      this.ledgerItems = this.ledgerItems.filter((item) => item.ledgerId.toUpperCase() !== upperId);
      this.notifyListeners();
      LogBroker.publish("WARN", "LedgerService", `从备餐分组同步物理移除了台账: ${id}`);
    }
  }

  /**
   * @description 为某个台账新增采购项目（原料明细）
   * @param ledgerId 台账ID
   * @param name 原料名称
   * @param unit 单位
   * @param spec 规格/描述
   * @param initialStock 初始库存
   */
  public static async addLedgerItem(
    ledgerId: string,
    name: string,
    unit: string,
    spec: string,
    initialStock: number
  ): Promise<LedgerItem> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!name.trim()) {
          reject(new Error("原料名称不能为空"));
          return;
        }
        if (!this.ledgers.some((l) => l.id === ledgerId)) {
          reject(new Error("关联的台账不存在"));
          return;
        }

        // 避免同一本台账内原料重名
        const isDuplicate = this.ledgerItems.some((item) => item.ledgerId === ledgerId && item.name === name.trim());
        if (isDuplicate) {
          reject(new Error(`该台账内已有名为 "${name.trim()}" 的采购项目原料`));
          return;
        }

        const newItem: LedgerItem = {
          id: `ledger_item_${ledgerId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          ledgerId,
          name: name.trim(),
          unit: unit.trim() || "斤",
          spec: spec.trim() || "常规",
          initialStock: Math.max(0, initialStock),
          currentStock: Math.max(0, initialStock), // 新建时当前库存等于初始库存
          dailyRecords: {}
        };

        this.ledgerItems = [...this.ledgerItems, newItem];
        this.notifyListeners();
        LogBroker.publish("INFO", "LedgerService", `【新增原料】在台账中成功添加采购项原料「${newItem.name}」（规格：${newItem.spec}，初始库存：${newItem.initialStock}）`);
        resolve(newItem);
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 修改某项采购项目（原料）的基本信息
   * @param id 原料项目ID
   * @param name 原料名字
   * @param unit 单位
   * @param spec 规格描述
   * @param initialStock 初始库存 (修改初始库存会触发当前库存重新核算)
   */
  public static async updateLedgerItem(
    id: string,
    name: string,
    unit: string,
    spec: string,
    initialStock: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const itemIndex = this.ledgerItems.findIndex((item) => item.id === id);
        if (itemIndex === -1) {
          reject(new Error("找不到该采购原料项目"));
          return;
        }

        const oldItem = this.ledgerItems[itemIndex];
        const normalizedName = name.trim();

        // 校验同台账内重名
        const isDuplicate = this.ledgerItems.some(
          (item) => item.ledgerId === oldItem.ledgerId && item.name === normalizedName && item.id !== id
        );
        if (isDuplicate) {
          reject(new Error(`台账内已有名为 "${normalizedName}" 的原料`));
          return;
        }

        const updatedItem = {
          ...oldItem,
          name: normalizedName,
          unit: unit.trim() || "斤",
          spec: spec.trim() || "常规",
          initialStock: Math.max(0, initialStock)
        };

        // 重新计算该原料的实时当前库存
        let sumIn = 0;
        let sumOut = 0;
        Object.values(updatedItem.dailyRecords).forEach((record) => {
          sumIn += record.inQuantity || 0;
          sumOut += record.outQuantity || 0;
        });
        updatedItem.currentStock = updatedItem.initialStock + sumIn - sumOut;

        const updatedItems = [...this.ledgerItems];
        updatedItems[itemIndex] = updatedItem;
        this.ledgerItems = updatedItems;

        this.notifyListeners();
        LogBroker.publish("INFO", "LedgerService", `【修改原料】成功修改采购原料「${oldItem.name}」的配置参数，并重新同步折算库存。`);
        resolve();
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 彻底物理删除某项采购项目（原料）
   * @param id 原料项目ID
   */
  public static async deleteLedgerItem(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const item = this.ledgerItems.find((i) => i.id === id);
        if (!item) {
          reject(new Error("找不到要删除的原料项目"));
          return;
        }

        this.ledgerItems = this.ledgerItems.filter((i) => i.id !== id);
        this.notifyListeners();
        LogBroker.publish("WARN", "LedgerService", `【删除原料】物理清除了采购项原料「${item.name}」的所有库存出入库明细记录`);
        resolve();
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 录入/更新指定原料在指定日期的部分出入库或台账字段，采用 Partial 合并技术实现顺畅的 onBlur 自动保存，并自动重算库存
   * @param itemId 原料ID
   * @param dateStr 选中的日期 (格式如 "YYYY-MM-DD")
   * @param fields 可选合并的属性集合 (Partial<DailyStockRecord>)
   */
  public static async updateDailyRecord(
    itemId: string,
    dateStr: string,
    fields: Partial<DailyStockRecord>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const itemIndex = this.ledgerItems.findIndex((item) => item.id === itemId);
        if (itemIndex === -1) {
          reject(new Error("找不到对应的采购原料项目"));
          return;
        }

        const item = this.ledgerItems[itemIndex];
        
        // 深度复制并克隆 dailyRecords 属性
        const updatedDailyRecords = { ...item.dailyRecords };
        
        // 初始化或获取原有记录
        const oldRecord: DailyStockRecord = updatedDailyRecords[dateStr] || {
          inQuantity: 0,
          inPrice: 0,
          inAmount: 0,
          outQuantity: 0,
          note: ""
        };

        // 进行浅合并
        const mergedRecord: DailyStockRecord = {
          ...oldRecord,
          ...fields
        };

        // 对数值安全过滤并重算入库金额
        mergedRecord.inQuantity = Math.max(0, mergedRecord.inQuantity ?? 0);
        mergedRecord.inPrice = Math.max(0, mergedRecord.inPrice ?? 0);
        mergedRecord.inAmount = Math.round(mergedRecord.inQuantity * mergedRecord.inPrice * 100) / 100;
        mergedRecord.outQuantity = Math.max(0, mergedRecord.outQuantity ?? 0);
        
        if (mergedRecord.note !== undefined) {
          mergedRecord.note = mergedRecord.note.trim();
        }

        // 清理空记录以节省空间
        const hasData = 
          mergedRecord.inQuantity > 0 || 
          mergedRecord.inPrice > 0 || 
          mergedRecord.outQuantity > 0 || 
          (mergedRecord.note && mergedRecord.note.trim()) ||
          (mergedRecord.certification && mergedRecord.certification.trim()) ||
          (mergedRecord.sensoryProperty && mergedRecord.sensoryProperty.trim()) ||
          (mergedRecord.supplier && mergedRecord.supplier.trim()) ||
          (mergedRecord.buyer && mergedRecord.buyer.trim()) ||
          (mergedRecord.inspector && mergedRecord.inspector.trim()) ||
          (mergedRecord.keeper && mergedRecord.keeper.trim()) ||
          (mergedRecord.produceDate && mergedRecord.produceDate.trim()) ||
          (mergedRecord.shelfLife && mergedRecord.shelfLife.trim()) ||
          (mergedRecord.outHandler && mergedRecord.outHandler.trim()) ||
          (mergedRecord.outRecipient && mergedRecord.outRecipient.trim());

        if (!hasData) {
          delete updatedDailyRecords[dateStr];
        } else {
          updatedDailyRecords[dateStr] = mergedRecord;
        }

        // 重新累加该原料所有历史时间的入库与出库数量，重新核算出物理库存
        let sumIn = 0;
        let sumOut = 0;
        Object.values(updatedDailyRecords).forEach((record) => {
          sumIn += record.inQuantity || 0;
          sumOut += record.outQuantity || 0;
        });

        const newCurrentStock = item.initialStock + sumIn - sumOut;

        const updatedItem: LedgerItem = {
          ...item,
          dailyRecords: updatedDailyRecords,
          currentStock: Math.round(newCurrentStock * 100) / 100
        };

        const updatedItems = [...this.ledgerItems];
        updatedItems[itemIndex] = updatedItem;
        this.ledgerItems = updatedItems;

        this.notifyListeners();

        // 当用户手动录入入库数据或入库单价时，单向自动同步至备餐月度报表
        if (fields.inQuantity !== undefined || fields.inPrice !== undefined) {
          const inQty = mergedRecord.inQuantity ?? 0;
          const inPr = mergedRecord.inPrice ?? 0;

          // 从原料库字典中根据原料名称查询二级分类和默认单位
          const category = RawMaterialsDictService.getCategoryForMaterial(item.name) || FoodCategory.VEGETABLE;
          const unit = item.unit || "斤";

          // 从 YYYY-MM-DD 提取年、月、日
          const [yearStr, monthStr, dayStr] = dateStr.split("-");
          const year = parseInt(yearStr || "2026");
          const month = parseInt(monthStr || "06");
          const day = parseInt(dayStr || "01").toString(); // 去除前导0

          PrepReportService.syncFromLedger(
            item.ledgerId, // 即 targetGroup
            year,
            month,
            day,
            item.name,
            category,
            unit,
            inQty,
            inPr
          );
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * @description 彻底恢复出厂设置：销毁全部台账缓存并回归种子大厅
   */
  public static async factoryResetLedger(): Promise<{ ledgers: Ledger[]; items: LedgerItem[] }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        localStorage.removeItem(LEDGERS_LIST_KEY);
        localStorage.removeItem(LEDGER_ITEMS_KEY);
        this.generateSeeds();
        resolve({ ledgers: this.ledgers, items: this.ledgerItems });
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 物理彻底清空整个购销台账的数据
   */
  public static async clearAllLedgerData(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.ledgers = [];
        this.ledgerItems = [];
        this.notifyListeners();
        LogBroker.publish("WARN", "LedgerService", "已手动清空全部购销台账和库存数据");
        resolve();
      }, LEDGER_API_LATENCY);
    });
  }
}
