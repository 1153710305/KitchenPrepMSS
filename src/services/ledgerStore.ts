/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 原料购销台账业务数据服务层（LedgerService）：管理台账列表与采购原料项目、每日出入库流水记录的增删改查、台账常用人员/供货商字典配置，并与备餐报表服务（PrepReportService）联动同步。
 */

import { Ledger, LedgerItem, DailyStockRecord } from "../types/ledgerTypes.ts";
import { LogBroker } from "../utils.ts";
import { SyncHelper } from "./syncHelper.ts";
import { PrepReportService } from "./store.ts";
import { RawMaterialsDictService } from "./rawMaterialDict.ts";
import { FoodCategory } from "../types/types.ts";

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
   * @description 台账录入常用辅助人员与供货商字典配置，包含供货商、采购员、检验员、保管员、出库人、接收人，
   * 以及可由管理员在后台自定义的"感官性状""保质期"下拉候选项
   */
  private static helperDict = {
    suppliers: ["合作基地直供", "宏发粮油批发", "绿野蔬菜配送", "科尔沁肉业"],
    buyers: ["张采购", "李采购", "陈采购"],
    inspectors: ["王检验", "赵检验", "孙检验"],
    keepers: ["李保管", "钱保管", "周保管"],
    outHandlers: ["吴发料", "郑发料", "冯发料"],
    outRecipients: ["赵领料", "孙领料", "马领料"],
    sensoryOptions: [
      "包装完整", "米粒饱满", "新鲜", "有光泽", "味正", "颜色好",
      "肉鲜", "新鲜光滑", "鲜", "嫩", "绿", "色泽鲜亮", "形状饱满",
      "光泽度好", "颜色鲜艳", "合格", "不合格"
    ],
    shelfLifeOptions: ["2天", "15天", "1个月", "3个月", "6个月", "1年", "一年以上", "保质期较短"]
  };

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
   * @description 触发并分发变更通知到所有的订阅者（阶段三起不再兼任同步职责——每个具体的 mutation 方法
   * 完成内存状态变更后自行调用 SyncHelper.queueChange() 显式描述这次变了什么，此处只做本地监听者分发）
   */
  private static notifyListeners(): void {
    this.changeListeners.forEach((listener) => {
      try {
        listener([...this.ledgers], [...this.ledgerItems]);
      } catch (err) {
        LogBroker.publish("ERROR", "LedgerService", "分发台账数据变动通知失败:", String(err));
      }
    });
  }

  /**
   * @description 获取当前台账录入人员与供货商字典配置列表
   */
  public static getHelperDict() {
    return this.helperDict;
  }

  /**
   * @description 更新当前台账录入人员与供货商字典配置列表并广播同步
   */
  public static updateHelperDict(dict: typeof LedgerService.helperDict) {
    this.helperDict = dict;
    this.notifyListeners();
    // 8 个候选项类别均为管理员低频维护的整数组配置，逐个以整组替换的方式同步，不做逐值增量
    (Object.keys(dict) as Array<keyof typeof dict>).forEach((category) => {
      SyncHelper.queueChange({ entity: "ledgerHelperOptions", op: "replace", key: category, data: dict[category] });
    });
  }

  /**
   * @description 启动并自检缓存。若没有，则自动生成四个默认种子台账，并导入默认采购原料项目
   */
  /**
   * @description 启动并自检缓存。完全从服务器同步获取数据，不使用本地缓存
   */
  public static async initLedgerStore(): Promise<{ ledgers: Ledger[]; items: LedgerItem[] }> {
    let serverData: any = null;
    try {
      // 优先从后端拉取最新同步数据
      serverData = await SyncHelper.loadFromServer();
    } catch (err) {
      LogBroker.publish("WARN", "LedgerService", "同步服务器数据失败: " + String(err));
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          if (serverData && serverData.ledgers && serverData.ledgerItems) {
            this.ledgers = serverData.ledgers;
            this.ledgerItems = serverData.ledgerItems;
            if (serverData.ledgerHelperDict) {
              // 与默认字典浅合并，兼容旧版本存量数据里尚未包含 sensoryOptions/shelfLifeOptions 两个新字段的情况
              this.helperDict = { ...this.helperDict, ...serverData.ledgerHelperDict };
            }
            LogBroker.publish("INFO", "LedgerService", "成功从服务器同步载入原料购销台账及原料项目明细");
          } else {
            // 服务器上无台账数据，降级初始化演示台账
            this.generateSeeds();
          }
          resolve({ ledgers: this.ledgers, items: this.ledgerItems });
        } catch (err) {
          LogBroker.publish("ERROR", "LedgerService", "启动加载数据发生异常:", String(err));
          resolve({ ledgers: [], items: [] });
        }
      }, LEDGER_API_LATENCY);
    });
  }

  private static generateSeeds(): void {
    LogBroker.publish("INFO", "LedgerService", "台账物理缓存缺失，正在合成第一款初始种子台账...");

    const alignedGroups = [
      { key: "KID", name: "幼儿" },
      { key: "STUDENT", name: "在校生" },
      { key: "TEACHER", name: "教师" }
    ];

    const initialLedgers: Ledger[] = alignedGroups.map((group) => ({
      id: group.key,
      name: group.name,
      createdAt: new Date().toISOString()
    }));

    // 首次启动时，清空台账的初始原料数据，设为空，不自动载入、盐等默认记录，满足“清空首次启动时的台账的初始数据”
    const initialItems: LedgerItem[] = [];

    this.ledgers = initialLedgers;
    this.ledgerItems = initialItems;
    // 批量种子数据生成场景，整批 replaceAll 覆盖，而非强行拆成逐条 upsert 枚举
    SyncHelper.queueChange({ entity: "ledger", op: "replaceAll", data: initialLedgers });
    SyncHelper.queueChange({ entity: "ledgerItem", op: "replaceAll", data: initialItems });
    LogBroker.publish("INFO", "LedgerService", "成功合成三大初始空模板台账（幼儿、在校生、教师），等待管理员于后台添加并录入原料数据。");
  }

  /**
   * @description 获取所有的台账列表
   */
  public static getLedgers(): Ledger[] {
    return this.ledgers;
  }

  /**
   * @description 获取所有采购原料项目列表
   */
  public static getLedgerItems(): LedgerItem[] {
    return this.ledgerItems;
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
        SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: id, data: updatedLedgers[ledgerIndex] });
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
        const removedItems = this.ledgerItems.filter((item) => item.ledgerId === id);
        this.ledgers = this.ledgers.filter((l) => l.id !== id);
        this.ledgerItems = this.ledgerItems.filter((item) => item.ledgerId !== id);

        this.notifyListeners();
        SyncHelper.queueChange({ entity: "ledger", op: "delete", key: id });
        // 后端 ledgerItem 删除的级联只清理该原料项自己的逐日流水，不会自动推断"属于同一台账的其它原料项也要删"，
        // 因此这里需要为每个被级联删除的原料项各自 queue 一个 delete op
        removedItems.forEach((item) => {
          SyncHelper.queueChange({ entity: "ledgerItem", op: "delete", key: item.id });
        });
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
        SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: id, data: existing });
      }
    } else {
      const newLedger: Ledger = {
        id,
        name,
        createdAt: new Date().toISOString()
      };

      // 新建一级人群对应台账时，不要有默认采购原料项目，直接设为空，满足“不要有默认记录，不要显示任何原料”
      const newItems: LedgerItem[] = [];

      this.ledgers = [...this.ledgers, newLedger];
      this.ledgerItems = [...this.ledgerItems, ...newItems];
      this.notifyListeners();
      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: id, data: newLedger });
    }
  }

  /**
   * @description 从餐位分组同步物理删除台账
   */
  public static syncDeleteLedgerFromGroup(id: string): void {
    const upperId = id.toUpperCase();
    const ledger = this.ledgers.find((l) => l.id.toUpperCase() === upperId);
    if (ledger) {
      const removedItems = this.ledgerItems.filter((item) => item.ledgerId.toUpperCase() === upperId);
      this.ledgers = this.ledgers.filter((l) => l.id.toUpperCase() !== upperId);
      this.ledgerItems = this.ledgerItems.filter((item) => item.ledgerId.toUpperCase() !== upperId);
      this.notifyListeners();
      SyncHelper.queueChange({ entity: "ledger", op: "delete", key: ledger.id });
      removedItems.forEach((item) => {
        SyncHelper.queueChange({ entity: "ledgerItem", op: "delete", key: item.id });
      });
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
        SyncHelper.queueChange({ entity: "ledgerItem", op: "upsert", key: newItem.id, data: newItem });
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
        SyncHelper.queueChange({ entity: "ledgerItem", op: "upsert", key: updatedItem.id, data: updatedItem });
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
        SyncHelper.queueChange({ entity: "ledgerItem", op: "delete", key: id });
        LogBroker.publish("WARN", "LedgerService", `【删除原料】物理清除了采购项原料「${item.name}」的所有库存出入库明细记录`);
        resolve();
      }, LEDGER_API_LATENCY);
    });
  }

  /**
   * @description 通过台账ID、原料品名及日期主键，更新写入台账指定日期的入库指标数据，用于反向数据绑定
   * @param ledgerId 台账ID
   * @param itemName 原料名称
   * @param dateStr 日期 (格式 "YYYY-MM-DD")
   * @param fields 入库记录参数
   */
  public static async updateDailyRecordByKey(
    ledgerId: string,
    itemName: string,
    dateStr: string,
    fields: Partial<DailyStockRecord>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const item = this.ledgerItems.find((i) => i.ledgerId === ledgerId && i.name === itemName);
        if (!item) {
          reject(new Error(`未在台账 [${ledgerId}] 中找到名为 [${itemName}] 的采购项目`));
          return;
        }
        this.updateDailyRecord(item.id, dateStr, fields)
          .then(() => resolve())
          .catch((err) => reject(err));
      } catch (err) {
        reject(err);
      }
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

        // 对数值安全过滤并重算入库金额：非负数校验，同时兜底非法数字（如 NaN）不会绕过 Math.max 的负数拦截
        mergedRecord.inQuantity = Number.isFinite(mergedRecord.inQuantity) ? Math.max(0, mergedRecord.inQuantity!) : 0;
        mergedRecord.inPrice = Number.isFinite(mergedRecord.inPrice) ? Math.max(0, mergedRecord.inPrice!) : 0;
        mergedRecord.inAmount = Math.round(mergedRecord.inQuantity * mergedRecord.inPrice * 100) / 100;
        mergedRecord.outQuantity = Number.isFinite(mergedRecord.outQuantity) ? Math.max(0, mergedRecord.outQuantity!) : 0;

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
        // 只增量同步这一天的流水记录本身，而不是整个 dailyRecords 对象；currentStock 属于骨架字段，另发一个 ledgerItem op
        if (!hasData) {
          SyncHelper.queueChange({ entity: "ledgerItemDailyRecord", op: "delete", key: { itemId, date: dateStr } });
        } else {
          SyncHelper.queueChange({ entity: "ledgerItemDailyRecord", op: "upsert", key: { itemId, date: dateStr }, data: mergedRecord });
        }
        SyncHelper.queueChange({ entity: "ledgerItem", op: "upsert", key: updatedItem.id, data: updatedItem });

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
   * @description 当从后台原料大底库修改了原料属性时，级联同步更新所有关联的已存台账采购原料项目参数
   * @param newSpec 新规格描述（原料字典的备注字段），可选——不传时保留台账原料项目原有的规格不变
   */
  public static cascadeUpdateMaterial(oldName: string, newName: string, newUnit: string, newSpec?: string): void {
    let changed = false;
    const changedItems: LedgerItem[] = [];
    this.ledgerItems = this.ledgerItems.map((item) => {
      if (item.name === oldName) {
        changed = true;
        const updated = {
          ...item,
          name: newName,
          unit: newUnit,
          spec: newSpec !== undefined ? newSpec : item.spec
        };
        changedItems.push(updated);
        return updated;
      }
      return item;
    });
    if (changed) {
      this.notifyListeners();
      changedItems.forEach((item) => {
        SyncHelper.queueChange({ entity: "ledgerItem", op: "upsert", key: item.id, data: item });
      });
    }
  }

  /**
   * @description 当从后台原料大底库删除了原料时，级联同步删除所有关联的已存台账采购项
   */
  public static cascadeDeleteMaterial(name: string): void {
    const removedItems = this.ledgerItems.filter((item) => item.name === name);
    if (removedItems.length > 0) {
      this.ledgerItems = this.ledgerItems.filter((item) => item.name !== name);
      this.notifyListeners();
      removedItems.forEach((item) => {
        SyncHelper.queueChange({ entity: "ledgerItem", op: "delete", key: item.id });
      });
    }
  }

  /**
   * @description 供心跳轮询静默更新内存中的台账列表，防止 LocalStorage 覆写
   */
  public static setLedgersInMemory(l: Ledger[]): void {
    this.ledgers = l;
  }

  /**
   * @description 供心跳轮询静默更新内存中的台账条目明细
   */
  public static setLedgerItemsInMemory(i: LedgerItem[]): void {
    this.ledgerItems = i;
  }

  /**
   * @description 强制广播分发最新的台账数据变动
   */
  public static forceNotify(): void {
    // 强制通知时我们需要调用 notifyListeners 且避免同步到后端
    this.changeListeners.forEach((listener) => {
      try {
        listener([...this.ledgers], [...this.ledgerItems]);
      } catch (err) {
        LogBroker.publish("ERROR", "LedgerService", "强制广播台账变动失败:", String(err));
      }
    });
  }
}
