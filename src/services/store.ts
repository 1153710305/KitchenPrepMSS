/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐采购/月度报表业务数据服务层（PrepReportService）：管理各受众人群月度报表的增删改查、一二级人群与食材大类配置的增删改查、与台账系统的数据同步桥接，并通过 SyncHelper 触发向后端的持久化。
 */

import { PRESET_ITEMS_BY_CATEGORY, CATEGORY_DEFAULT_UNITS } from "../constants/constants.ts";
import { FoodCategory, GroupMonthlyReport, PreparedItem, TargetGroup, DailyEntry, DynamicGroup, DynamicCategory } from "../types/types.ts";
import { LogBroker } from "../utils.ts";
import { SyncHelper } from "./syncHelper.ts";

/**
 * @description 自动模拟服务层接口呼叫时延 (毫秒)
 */
const MOCK_API_LATENCY = 150;

/** 系统预置的默认一级人群 key 集合，用于迁移升级前缺少 isDefault 标记的历史数据 */
const DEFAULT_GROUP_KEYS = new Set(["KID", "STUDENT", "TEACHER"]);

/** 系统预置的默认二级食材大类 key 集合，用于迁移升级前缺少 isDefault 标记的历史数据 */
const DEFAULT_CATEGORY_KEYS = new Set(["VEGETABLE", "GRAIN_OIL", "SEASONING", "MEAT", "LOW_CONSUMP", "FRUIT"]);

/**
 * @description 发生重大核心变动后的侦听分发器类型
 */
export type StateChangeListener = (reports: GroupMonthlyReport[]) => void;

/**
 * @description 双向业务逻辑数据服务层，针对后期前后端分离架构进行解耦设计
 */
export class PrepReportService {
  private static reports: GroupMonthlyReport[] = [];
  private static changeListeners: StateChangeListener[] = [];
  private static activeGroups: DynamicGroup[] = [];
  private static activeCategories: DynamicCategory[] = [];

  /**
   * @description 注册局部状态变动全局热补丁侦听
   * @param listener 回调监听器
   */
  public static subscribe(listener: StateChangeListener): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  /**
   * @description 推送最新报告集状态至所有订阅组件
   */
  private static notifyListeners(): void {
    this.changeListeners.forEach((listener) => {
      try {
        listener([...this.reports]);
      } catch (err) {
        LogBroker.publish("ERROR", "PrepReportService", "下发变动通知失败:", String(err));
      }
    });
  }

  /**
   * @description 判断某一天的备餐用料数据是否有"实质内容"值得增量持久化，口径与台账逐日流水的 hasData 判断保持一致
   * （全月默认置零的占位天数不写入数据库；前端各处消费 dailyData[day] 时早已统一做了 `?? {quantity:0,...}` 兜底，
   * 缺失的占位天数不影响任何渲染逻辑，因此省略它们是安全的简化）
   */
  private static hasMeaningfulDailyEntry(entry: DailyEntry | undefined): boolean {
    return !!entry && ((entry.quantity ?? 0) > 0 || (entry.price ?? 0) > 0 || (entry.amount ?? 0) > 0);
  }

  /**
   * @description 为一个（通常是刚创建的）备餐细项 queue 骨架 upsert op，并只对有实质内容的天数额外 queue
   * preparedItemDailyData upsert op（跳过全零占位天数）
   */
  private static queuePreparedItemUpsertOps(item: PreparedItem, reportTargetGroup: string, reportYear: number, reportMonth: number): void {
    const { dailyData, ...skeleton } = item;
    SyncHelper.queueChange({ 
      entity: "preparedItem", 
      op: "upsert", 
      key: item.id, 
      data: { ...skeleton, reportTargetGroup, reportYear, reportMonth } 
    });
    Object.entries(dailyData ?? {}).forEach(([day, entry]) => {
      if (!this.hasMeaningfulDailyEntry(entry)) return;
      SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "upsert", key: { itemId: item.id, date: day }, data: entry });
    });
  }

  /**
   * @description queue 一个 report 骨架 upsert op（只确保 (targetGroup, year, month) 这行存在，不涉及其 items）
   */
  private static queueReportUpsertOp(report: Pick<GroupMonthlyReport, "targetGroup" | "year" | "month">): void {
    SyncHelper.queueChange({ entity: "report", op: "upsert", key: { targetGroup: report.targetGroup, year: report.year, month: report.month } });
  }

  /**
   * @description 获取内存中全部的报表数据
   */
  public static getReports(): GroupMonthlyReport[] {
    return this.reports;
  }

  /**
   * @description 获取当前激活的餐卡人群列表
   * @returns 动态人群配置列表
   */
  public static getActiveGroups(): DynamicGroup[] {
    return this.activeGroups;
  }

  /**
   * @description 获取当前激活的食材大类列表
   * @returns 动态大类配置列表
   */
  public static getActiveCategories(): DynamicCategory[] {
    return this.activeCategories;
  }

  /**
   * @description 启动并自检缓存。完全从服务器同步获取数据，不使用本地缓存
   */
  public static async initStore(): Promise<GroupMonthlyReport[]> {
    let serverData: any = null;
    try {
      // 从后端拉取最新同步数据
      serverData = await SyncHelper.loadFromServer();
    } catch (err) {
      LogBroker.publish("WARN", "PrepReportService", "同步服务器数据失败: " + String(err));
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          if (serverData && serverData.activeGroups && serverData.activeCategories && serverData.reports) {
            this.activeGroups = serverData.activeGroups as DynamicGroup[];
            this.activeCategories = serverData.activeCategories as DynamicCategory[];
            this.reports = serverData.reports;
            LogBroker.publish("INFO", "PrepReportService", "已成功从服务器同步载入备餐报表数据");
          } else {
            // 服务端现在负责注入初始数据。若到达此处，说明网络失败或未收到有效负载。
            // 降级为空状态，不再主动在前端进行种子数据生成或覆盖推送
            this.activeGroups = [];
            this.activeCategories = [];
            this.reports = [];
            LogBroker.publish("WARN", "PrepReportService", "未收到有效的服务端报表数据，可能处于断网状态或服务异常。");
          }
          resolve(this.reports);
        } catch (error) {
          LogBroker.publish("ERROR", "PrepReportService", "启动加载数据发生异常:", String(error));
          resolve([]);
        }
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 惰性获取或创建一个月度报表
   * @param targetGroup 目标受众人群
   * @param year 年份
   * @param month 月份
   * @returns 已有或新建的月度报表
   */
  public static getOrCreateReport(targetGroup: string, year: number, month: number): GroupMonthlyReport {
    let report = this.reports.find(
      (r) => r.targetGroup === targetGroup as TargetGroup && r.year === year && r.month === month
    );
    if (!report) {
      // 找到这个人群的最近一份月度报表以克隆它的原料条目
      const latestReportForGroup = [...this.reports]
        .filter((r) => r.targetGroup === targetGroup as TargetGroup)
        .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0];

      let items: PreparedItem[] = [];
      if (latestReportForGroup) {
        // 复制所有原料条目，但将每日数据置空
        items = latestReportForGroup.items.map((oldItem) => {
          const dailyData: Record<string, DailyEntry> = {};
          for (let d = 1; d <= 31; d++) {
            dailyData[String(d)] = { quantity: 0, price: 0, amount: 0 };
          }
          return {
            ...oldItem,
            id: `item_${targetGroup.toLowerCase()}_${oldItem.category.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            dailyData
          };
        });
      } else {
        // 如果没有历史报表，使用默认品类种子填充
        const foodCategories = this.activeCategories.map((c) => c.key);
        foodCategories.forEach((cat) => {
          const defaultNames = (PRESET_ITEMS_BY_CATEGORY as Record<string, string[]>)[cat] || ["预设原料"];
          const defaultUnit = (CATEGORY_DEFAULT_UNITS as Record<string, string>)[cat] || "斤";

          defaultNames.forEach((name) => {
            const dailyData: Record<string, DailyEntry> = {};
            for (let d = 1; d <= 31; d++) {
              dailyData[String(d)] = { quantity: 0, price: 0, amount: 0 };
            }
            items.push({
              id: `item_${targetGroup.toLowerCase()}_${cat.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              name,
              category: cat as FoodCategory,
              targetGroup: targetGroup as TargetGroup,
              unit: defaultUnit,
              dailyData
            });
          });
        });
      }

      report = {
        targetGroup: targetGroup as TargetGroup,
        year,
        month,
        items
      };
      this.reports.push(report);
      this.saveToStorage();
      this.queueReportUpsertOp(report);
      report.items.forEach((item) => this.queuePreparedItemUpsertOps(item, report.targetGroup, report.year, report.month));
      LogBroker.publish("INFO", "PrepReportService", `惰性合成了客群「${targetGroup}」在 ${year}年${month}月 的空白初始备餐表。`);
    }
    return report;
  }

  /**
   * @description 从台账入库记录同步数据到备餐采购量和单价
   */
  public static async syncFromLedger(
    targetGroup: string,
    year: number,
    month: number,
    day: string,
    itemName: string,
    category: FoodCategory,
    unit: string,
    quantity: number,
    price: number
  ): Promise<void> {
    return new Promise((resolve) => {
      // 惰性获取或创建报表
      this.getOrCreateReport(targetGroup, year, month);

      const reportIndex = this.reports.findIndex(
        (r) => r.targetGroup === targetGroup as TargetGroup && r.year === year && r.month === month
      );

      const report = this.reports[reportIndex];
      const itemIndex = report.items.findIndex((item) => item.name === itemName);

      this.queueReportUpsertOp(report);

      if (itemIndex > -1) {
        const item = report.items[itemIndex];
        const updatedDailyData = { ...item.dailyData };
        const newEntry: DailyEntry = {
          quantity,
          price,
          amount: Math.round(quantity * price * 100) / 100
        };
        updatedDailyData[day] = newEntry;
        const updatedItem = {
          ...item,
          dailyData: updatedDailyData
        };
        const updatedItems = [...report.items];
        updatedItems[itemIndex] = updatedItem;
        this.reports[reportIndex] = {
          ...report,
          items: updatedItems
        };
        if (this.hasMeaningfulDailyEntry(newEntry)) {
          SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "upsert", key: { itemId: item.id, date: day }, data: newEntry });
        } else {
          SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "delete", key: { itemId: item.id, date: day } });
        }
      } else {
        // 创建新原料行
        const dailyData: Record<string, DailyEntry> = {};
        for (let d = 1; d <= 31; d++) {
          dailyData[String(d)] = { quantity: 0, price: 0, amount: 0 };
        }
        dailyData[day] = {
          quantity,
          price,
          amount: Math.round(quantity * price * 100) / 100
        };
        const newItem: PreparedItem = {
          id: `item_${targetGroup.toLowerCase()}_${category.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          name: itemName,
          category,
          targetGroup: targetGroup as TargetGroup,
          unit,
          dailyData
        };
        const updatedReport = {
          ...report,
          items: [...report.items, newItem]
        };
        this.reports[reportIndex] = updatedReport;
        this.queuePreparedItemUpsertOps(newItem, targetGroup, year, month);
      }

      this.notifyListeners();
      LogBroker.publish(
        "INFO",
        "PrepReportService",
        `已成功同步台账入库数据到备餐明细: ${targetGroup} - ${itemName} (${year}-${month}-${day}，数量:${quantity}，价格:${price})`
      );
      resolve();
    });
  }

  /**
   * @description 从台账同步餐位人群配置列表
   * @param id 台账唯一ID / 人群唯一Key
   * @param name 台账名称 / 人群中文名称
   */
  public static syncGroupFromLedger(id: string, name: string): void {
    const existingIndex = this.activeGroups.findIndex((g) => g.key === id);
    if (existingIndex > -1) {
      if (this.activeGroups[existingIndex].label !== name) {
        this.activeGroups[existingIndex].label = name;
        this.saveConfigAndNotify();
        SyncHelper.queueChange({ entity: "activeGroup", op: "upsert", key: id, data: this.activeGroups[existingIndex] });
      }
    } else {
      const newGroup: DynamicGroup = {
        key: id,
        label: name,
        emoji: "🍽️"
      };
      this.activeGroups.push(newGroup);
      // 检查当前年月报表是否存在
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const reportExists = this.reports.some((r) => r.targetGroup === id as TargetGroup && r.year === currentYear && r.month === currentMonth);
      let newReport: GroupMonthlyReport | null = null;
      if (!reportExists) {
        newReport = {
          targetGroup: id as TargetGroup,
          year: currentYear,
          month: currentMonth,
          items: []
        };
        this.reports.push(newReport);
      }
      this.saveConfigAndNotify();
      SyncHelper.queueChange({ entity: "activeGroup", op: "upsert", key: id, data: newGroup });
      if (newReport) {
        this.queueReportUpsertOp(newReport);
      }
    }
  }

  /**
   * @description 从台账同步删除餐位人群配置
   * @param id 台账ID / 人群Key
   */
  public static syncDeleteGroupFromLedger(id: string): void {
    const upperKey = id.toUpperCase();
    const removedReports = this.reports.filter((r) => r.targetGroup === upperKey as TargetGroup);
    this.activeGroups = this.activeGroups.filter((g) => g.key !== upperKey);
    this.reports = this.reports.filter((r) => r.targetGroup !== upperKey as TargetGroup);
    LogBroker.publish("WARN", "PrepReportService", `从台账同步物理移除了群组与备餐报表: ${upperKey}`);
    this.saveConfigAndNotify();
    SyncHelper.queueChange({ entity: "activeGroup", op: "delete", key: upperKey });
    // 后端 report 删除的级联只清理该报表自己的 preparedItems/dailyData，不会自动推断"同一人群的其它月份报表也要删"，
    // 因此这里需要为每个被级联删除的报表各自 queue 一个 delete op
    removedReports.forEach((report) => {
      SyncHelper.queueChange({ entity: "report", op: "delete", key: { targetGroup: report.targetGroup, year: report.year, month: report.month } });
    });
  }



  /**
   * @description 分发变更通知（阶段三起不再兼任同步职责——每个具体的 mutation 方法完成内存状态变更后
   * 自行调用 SyncHelper.queueChange() 显式描述这次变了什么，此处只做本地监听者分发）
   */
  private static saveToStorage(): void {
    this.notifyListeners();
  }

  /**
   * @description 新增或编辑一级人群配置并落盘
   * @param key 标识键
   * @param label 显示中文标签
   * @param emoji 展现表情符号
   */
  public static async saveGroup(key: string, label: string, emoji: string): Promise<void> {
    // 校验、isDefault保留、级联同步创建/改名对应台账（此前的 LedgerService.syncLedgerFromGroup 调用）
    // 均已迁移到后端（阶段C，见 SQLite迁移规划.md）
    const res = await SyncHelper.fetchWithVersion(`/api/groups/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, emoji })
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "保存人群配置失败");
    }
    const savedGroup: DynamicGroup = body.group;
    const existingIndex = this.activeGroups.findIndex((g) => g.key === savedGroup.key);
    if (existingIndex > -1) {
      this.activeGroups[existingIndex] = savedGroup;
      LogBroker.publish("INFO", "PrepReportService", `更新了一级备餐人群: ${label} (${savedGroup.key})`);
    } else {
      this.activeGroups.push(savedGroup);
      LogBroker.publish("INFO", "PrepReportService", `新增了一级备餐人群: ${label} (${savedGroup.key})`);
    }
    this.saveConfigAndNotify();

    // 级联结果（新建当月空报表、同步创建/改名对应台账）只发生在后端，主动刷新一次而不是等最多10秒的心跳
    await SyncHelper.refreshNow();
  }

  /**
   * @description 删除一级人群配置及关联的所有报表条目（系统默认生成的人群不允许删除，仅允许编辑）
   * @param key 人群标识键
   */
  public static async deleteGroup(key: string): Promise<void> {
    // 校验、级联删除报表/对应台账（此前的 LedgerService.syncDeleteLedgerFromGroup 调用）均已迁移到后端
    const upperKey = key.toUpperCase();
    const res = await SyncHelper.fetchWithVersion(`/api/groups/${encodeURIComponent(key)}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "删除人群配置失败");
    }
    this.activeGroups = this.activeGroups.filter((g) => g.key.toUpperCase() !== upperKey);
    this.reports = this.reports.filter((r) => r.targetGroup.toUpperCase() !== upperKey);
    LogBroker.publish("WARN", "PrepReportService", `剔除了一级备餐人群及关联的所有报表: ${upperKey}`);
    this.saveConfigAndNotify();

    // 级联结果（删除报表与对应台账）只发生在后端，主动刷新一次而不是等心跳
    await SyncHelper.refreshNow();
  }

  /**
   * @description 新增或编辑二级食材大类配置并在系统落盘
   * @param key 大类唯一标识键
   * @param label 大类名称显名
   */
  public static async saveCategory(key: string, label: string): Promise<void> {
    // 校验、isDefault保留已迁移到后端（阶段C，见 SQLite迁移规划.md）
    const res = await SyncHelper.fetchWithVersion(`/api/categories/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label })
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "保存大类配置失败");
    }
    const savedCategory: DynamicCategory = body.category;
    const existingIndex = this.activeCategories.findIndex((c) => c.key === savedCategory.key);
    if (existingIndex > -1) {
      this.activeCategories[existingIndex] = savedCategory;
      LogBroker.publish("INFO", "PrepReportService", `更新了二级食材大类: ${label} (${savedCategory.key})`);
    } else {
      this.activeCategories.push(savedCategory);
      LogBroker.publish("INFO", "PrepReportService", `新增了二级食材大类: ${label} (${savedCategory.key})`);
    }
    this.saveConfigAndNotify();
  }

  /**
   * @description 删除二级大品类配置并清空所有报表里属于此大类的细分项（系统默认生成的大类不允许删除，仅允许编辑）
   * @param key 大类标识键
   */
  public static async deleteCategory(key: string): Promise<void> {
    // 校验/级联清空报表里的对应细分项已迁移到后端
    const upperKey = key.toUpperCase();
    const res = await SyncHelper.fetchWithVersion(`/api/categories/${encodeURIComponent(key)}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "删除大类配置失败");
    }
    this.activeCategories = this.activeCategories.filter((c) => c.key !== upperKey);
    this.reports.forEach((report) => {
      report.items = report.items.filter((item) => item.category !== upperKey as FoodCategory);
    });
    LogBroker.publish("WARN", "PrepReportService", `剔除了二级大类及各群体名下的对应食材: ${upperKey}`);
    this.saveConfigAndNotify();
  }

  /**
   * @description 分发变更通知（阶段三起不再兼任同步职责——每个具体的 mutation 方法完成内存状态变更后
   * 自行调用 SyncHelper.queueChange() 显式描述这次变了什么，此处只做本地监听者分发）
   */
  private static saveConfigAndNotify(): void {
    this.notifyListeners();
  }

  /**
   * @description 当从后台原料大底库修改了原料属性时，级联同步更新所有关联的已存备餐食材参数
   */
  public static cascadeUpdateMaterial(oldName: string, newName: string, newCategory: FoodCategory, newUnit: string): void {
    let changed = false;
    const changedItems: PreparedItem[] = [];
    this.reports = this.reports.map((report) => {
      const updatedItems = report.items.map((item) => {
        if (item.name === oldName) {
          changed = true;
          const updated = {
            ...item,
            name: newName,
            category: newCategory,
            unit: newUnit
          };
          changedItems.push(updated);
          return updated;
        }
        return item;
      });
      return {
        ...report,
        items: updatedItems
      };
    });
    if (changed) {
      this.saveConfigAndNotify();
      changedItems.forEach((item) => {
        const { dailyData: _dailyData, ...skeleton } = item;
        SyncHelper.queueChange({ entity: "preparedItem", op: "upsert", key: item.id, data: skeleton });
      });
    }
  }

  /**
   * @description 当从后台原料大底库删除了原料时，级联同步删除所有关联的已存备餐食材采购项
   */
  public static cascadeDeleteMaterial(name: string): void {
    let changed = false;
    const removedItemIds: string[] = [];
    this.reports = this.reports.map((report) => {
      const originalCount = report.items.length;
      const removed = report.items.filter((item) => item.name === name);
      removedItemIds.push(...removed.map((item) => item.id));
      const updatedItems = report.items.filter((item) => item.name !== name);
      if (updatedItems.length !== originalCount) {
        changed = true;
        return {
          ...report,
          items: updatedItems
        };
      }
      return report;
    });
    if (changed) {
      this.saveConfigAndNotify();
      removedItemIds.forEach((itemId) => {
        SyncHelper.queueChange({ entity: "preparedItem", op: "delete", key: itemId });
      });
    }
  }

  /**
   * @description 当台账原料采购项目被物理删除时，级联清除该受众人群名下由 syncFromLedger 反向同步生成的
   * 同名备餐细项（含其全部逐日数量/单价/金额），使左下角当月采购支出与花销趋势图正确反映删除结果。
   * 只按 targetGroup（对应台账ID）+ name 精确匹配，不影响其它受众人群名下的同名原料。
   */
  public static cascadeDeleteLedgerItem(targetGroup: string, name: string): void {
    let changed = false;
    const removedItemIds: string[] = [];
    this.reports = this.reports.map((report) => {
      if (report.targetGroup !== targetGroup) return report;
      const originalCount = report.items.length;
      const removed = report.items.filter((item) => item.name === name);
      removedItemIds.push(...removed.map((item) => item.id));
      const updatedItems = report.items.filter((item) => item.name !== name);
      if (updatedItems.length !== originalCount) {
        changed = true;
        return {
          ...report,
          items: updatedItems
        };
      }
      return report;
    });
    if (changed) {
      this.saveConfigAndNotify();
      removedItemIds.forEach((itemId) => {
        SyncHelper.queueChange({ entity: "preparedItem", op: "delete", key: itemId });
      });
    }
  }

  /**
   * @description 供心跳轮询静默更新内存中的报表集，防止 LocalStorage 覆写
   */
  public static setReportsInMemory(r: GroupMonthlyReport[]): void {
    this.reports = r;
  }

  /**
   * @description 供心跳轮询静默更新内存中的一级人群列表
   */
  public static setActiveGroupsInMemory(g: DynamicGroup[]): void {
    this.activeGroups = g;
  }

  /**
   * @description 供心跳轮询静默更新内存中的二级大类列表
   */
  public static setActiveCategoriesInMemory(c: DynamicCategory[]): void {
    this.activeCategories = c;
  }

  /**
   * @description 强制广播分发最新的内存数据变动
   */
  public static forceNotify(): void {
    this.notifyListeners();
  }
}

