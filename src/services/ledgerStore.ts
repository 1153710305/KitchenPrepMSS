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
            this.ledgers = [];
            this.ledgerItems = [];
            LogBroker.publish("WARN", "LedgerService", "未收到有效的服务端台账数据，可能处于断网状态或服务异常。");
          }
          resolve({ ledgers: this.ledgers, items: this.ledgerItems });
        } catch (err) {
          LogBroker.publish("ERROR", "LedgerService", "启动加载数据发生异常:", String(err));
          resolve({ ledgers: [], items: [] });
        }
      }, LEDGER_API_LATENCY);
    });
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
    // 校验、级联同步餐位人群配置（此前的 PrepReportService.syncGroupFromLedger）均已迁移到后端一次事务完成
    // （阶段B，见 SQLite迁移规划.md），前端只负责发起请求、用响应更新内存缓存
    const oldName = this.ledgers.find((l) => l.id === id)?.name;
    const res = await fetch(`/api/ledgers/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "更新台账失败");
    }
    const ledgerIndex = this.ledgers.findIndex((l) => l.id === id);
    if (ledgerIndex === -1) {
      this.ledgers.push(body.ledger);
    } else {
      this.ledgers = [...this.ledgers];
      this.ledgers[ledgerIndex] = body.ledger;
    }
    this.notifyListeners();
    LogBroker.publish("INFO", "LedgerService", `【修改台账】成功将台账「${oldName}」更名为「${body.ledger.name}」`);

    // 级联结果（餐位人群 label 同步）只发生在后端，主动刷新一次而不是等最多 10 秒的心跳
    await SyncHelper.refreshNow();
  }

  /**
   * @description 物理彻底删除某本台账，级联删除其下的所有原料采购项目和出入库账单
   * @param id 台账ID
   */
  public static async deleteLedger(id: string): Promise<void> {
    // 校验、级联删除原料项目/对应餐位人群配置/月度报表（此前的 PrepReportService.syncDeleteGroupFromLedger）
    // 均已迁移到后端一次事务完成，前端只负责发起请求
    const ledger = this.ledgers.find((l) => l.id === id);
    const res = await fetch(`/api/ledgers/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "删除台账失败");
    }
    this.ledgers = this.ledgers.filter((l) => l.id !== id);
    this.ledgerItems = this.ledgerItems.filter((item) => item.ledgerId !== id);
    this.notifyListeners();
    LogBroker.publish("WARN", "LedgerService", `【删除台账】物理清空了台账「${ledger?.name}」以及其下的所有原料出入库及库存账单`);

    // 级联结果（餐位人群与月度报表移除）只发生在后端，主动刷新一次而不是等心跳
    await SyncHelper.refreshNow();
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
    // 校验规则已迁移到后端（阶段B，见 SQLite迁移规划.md），前端只负责发起请求并用响应更新内存缓存
    const res = await fetch(`/api/ledgers/${encodeURIComponent(ledgerId)}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, unit, spec, initialStock })
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "新增原料失败");
    }
    this.ledgerItems = [...this.ledgerItems, body.item];
    this.notifyListeners();
    LogBroker.publish("INFO", "LedgerService", `【新增原料】在台账中成功添加采购项原料「${body.item.name}」（规格：${body.item.spec}，初始库存：${body.item.initialStock}）`);
    return body.item;
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
    const oldName = this.ledgerItems.find((item) => item.id === id)?.name;
    const res = await fetch(`/api/ledger-items/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, unit, spec, initialStock })
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "更新原料失败");
    }
    const itemIndex = this.ledgerItems.findIndex((item) => item.id === id);
    if (itemIndex === -1) {
      this.ledgerItems.push(body.item);
    } else {
      this.ledgerItems = [...this.ledgerItems];
      this.ledgerItems[itemIndex] = body.item;
    }
    this.notifyListeners();
    LogBroker.publish("INFO", "LedgerService", `【修改原料】成功修改采购原料「${oldName}」的配置参数，并重新同步折算库存。`);
  }

  /**
   * @description 彻底物理删除某项采购项目（原料）
   * @param id 原料项目ID
   */
  public static async deleteLedgerItem(id: string): Promise<void> {
    const item = this.ledgerItems.find((i) => i.id === id);
    const res = await fetch(`/api/ledger-items/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "删除原料失败");
    }
    this.ledgerItems = this.ledgerItems.filter((i) => i.id !== id);
    this.notifyListeners();
    LogBroker.publish("WARN", "LedgerService", `【删除原料】物理清除了采购项原料「${item?.name}」的所有库存出入库明细记录`);
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
    // 合并/校验/重算逻辑已迁移到后端（阶段B，见 SQLite迁移规划.md）；反向同步进备餐月度报表
    // （PrepReportService.syncFromLedger）目前仍是前端调用——PrepReportService 本身尚未迁移到后端（阶段C）
    const item = this.ledgerItems.find((i) => i.id === itemId);
    if (!item) {
      throw new Error("找不到对应的采购原料项目");
    }

    const res = await fetch(`/api/ledger-items/${encodeURIComponent(itemId)}/daily/${encodeURIComponent(dateStr)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "保存出入库记录失败");
    }

    const itemIndex = this.ledgerItems.findIndex((i) => i.id === itemId);
    this.ledgerItems = [...this.ledgerItems];
    this.ledgerItems[itemIndex] = body.item;
    this.notifyListeners();

    // 当用户手动录入入库数据或入库单价时，单向自动同步至备餐月度报表
    if (fields.inQuantity !== undefined || fields.inPrice !== undefined) {
      const mergedRecord: DailyStockRecord = body.mergedRecord;
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
