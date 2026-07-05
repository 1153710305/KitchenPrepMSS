/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 备餐采购/月度报表业务数据服务层（PrepReportService）：管理各受众人群月度报表的增删改查、一二级人群与食材大类配置的增删改查、与台账系统的数据同步桥接，并通过 SyncHelper 触发向后端的持久化。
 */

import { PRESET_ITEMS_BY_CATEGORY, CATEGORY_DEFAULT_UNITS } from "../constants/constants.ts";
import { FoodCategory, GroupMonthlyReport, PreparedItem, TargetGroup, DailyEntry, DynamicGroup, DynamicCategory } from "../types/types.ts";
import { calculateEntryAmount, LogBroker } from "../utils.ts";
import { SyncHelper } from "./syncHelper.ts";
import { LedgerService } from "./ledgerStore.ts";
import { RawMaterialsDictService } from "./rawMaterialDict.ts";

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
  private static queuePreparedItemUpsertOps(item: PreparedItem): void {
    const { dailyData, ...skeleton } = item;
    SyncHelper.queueChange({ entity: "preparedItem", op: "upsert", key: item.id, data: skeleton });
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
            // 服务器上有完整数据，直接同步到内存；同时迁移升级前生成、缺少 isDefault 标记的历史默认人群/大类数据，
            // 按 key 匹配预置默认清单补齐标记，确保老数据升级后依然享有"默认数据不可删除"的保护
            let migrationChanged = false;
            this.activeGroups = (serverData.activeGroups as DynamicGroup[]).map((g) => {
              if (g.isDefault === undefined && DEFAULT_GROUP_KEYS.has(g.key)) {
                migrationChanged = true;
                return { ...g, isDefault: true };
              }
              return g;
            });
            this.activeCategories = (serverData.activeCategories as DynamicCategory[]).map((c) => {
              if (c.isDefault === undefined && DEFAULT_CATEGORY_KEYS.has(c.key)) {
                migrationChanged = true;
                return { ...c, isDefault: true };
              }
              return c;
            });
            this.reports = serverData.reports;
            LogBroker.publish("INFO", "PrepReportService", "已成功从服务器同步载入备餐报表数据");
            if (migrationChanged) {
              // 迁移可能涉及任意多个人群/大类条目补齐 isDefault 标记，无法精确描述"改了哪一条"，
              // 整批 replaceAll 覆盖回写，属于批量迁移场景而非用户增量编辑
              SyncHelper.runWhenInitialized(() => {
                this.saveConfigAndNotify();
                SyncHelper.queueChange({ entity: "activeGroup", op: "replaceAll", data: this.activeGroups });
                SyncHelper.queueChange({ entity: "activeCategory", op: "replaceAll", data: this.activeCategories });
              });
            }
          } else {
            // 服务器上无数据或未同步成功时，降级使用默认种子数据进行填充初始化（统一标记 isDefault:true，仅允许编辑不允许删除）
            this.activeGroups = [
              { key: "KID", label: "幼儿", emoji: "👶", isDefault: true },
              { key: "STUDENT", label: "在校生", emoji: "🎒", isDefault: true },
              { key: "TEACHER", label: "教师", emoji: "👩‍🏫", isDefault: true }
            ];
            this.activeCategories = [
              { key: "VEGETABLE", label: "蔬菜", isDefault: true },
              { key: "GRAIN_OIL", label: "粮油", isDefault: true },
              { key: "SEASONING", label: "调料", isDefault: true },
              { key: "MEAT", label: "肉蛋", isDefault: true },
              { key: "LOW_CONSUMP", label: "低耗品", isDefault: true },
              { key: "FRUIT", label: "水果", isDefault: true }
            ];
            // 首次启动整批 replaceAll 落盘，与 generateInitialSeeds() 内部对 reports 的整批处理保持同一批量初始化语义。
            // 这段代码运行在全局初始化 Promise.all 完成之前，SyncHelper 尚处于未就绪锁定状态，必须用
            // runWhenInitialized 延后到解锁之后再入队，否则会被静默丢弃、永久不落盘（真实发生过的数据丢失事故）
            SyncHelper.runWhenInitialized(() => {
              SyncHelper.queueChange({ entity: "activeGroup", op: "replaceAll", data: this.activeGroups });
              SyncHelper.queueChange({ entity: "activeCategory", op: "replaceAll", data: this.activeCategories });
            });
            this.generateInitialSeeds();
            LogBroker.publish("INFO", "PrepReportService", "服务器上无数据记录，系统已初始化备餐默认种子数据");
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
      report.items.forEach((item) => this.queuePreparedItemUpsertOps(item));
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
        this.queuePreparedItemUpsertOps(newItem);
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
   * @description 用预设值初始化种子数据
   */
  private static generateInitialSeeds(): void {
    LogBroker.publish("INFO", "PrepReportService", "初始缓存缺失，正在合成第一款初始种子报表...");
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const targetGroups = this.activeGroups.map((g) => g.key);
    const foodCategories = this.activeCategories.map((c) => c.key);

    const initialReports: GroupMonthlyReport[] = targetGroups.map((group) => {
      const items: PreparedItem[] = [];

      foodCategories.forEach((cat) => {
        const defaultNames = (PRESET_ITEMS_BY_CATEGORY as Record<string, string[]>)[cat] || ["预设原料"];
        const defaultUnit = (CATEGORY_DEFAULT_UNITS as Record<string, string>)[cat] || "斤";

        defaultNames.forEach((name, itemIndex) => {
          const dailyData: Record<string, DailyEntry> = {};

          for (let d = 1; d <= 31; d++) {
            const initialQty = 0;
            const initialPrice = 0;

            dailyData[String(d)] = {
              quantity: initialQty,
              price: initialPrice,
              amount: calculateEntryAmount(initialQty, initialPrice)
            };
          }

          items.push({
            id: `item_${group.toLowerCase()}_${cat.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name,
            category: cat as FoodCategory,
            targetGroup: group as TargetGroup,
            unit: defaultUnit,
            dailyData
          });
        });
      });

      return {
        targetGroup: group as TargetGroup,
        year: currentYear,
        month: currentMonth,
        items
      };
    });

    this.reports = initialReports;
    this.saveToStorage();
    // 批量种子数据生成场景，整批 replaceAll 覆盖（含完整 31 天占位矩阵，与首次启动落盘的既有数据形态保持一致），
    // 而非强行拆成逐条 upsert 枚举。这段代码运行在全局初始化 Promise.all 完成之前，SyncHelper 尚处于未就绪
    // 锁定状态，必须用 runWhenInitialized 延后到解锁之后再入队，否则会被静默丢弃、永久不落盘
    // （真实发生过的数据丢失事故）
    SyncHelper.runWhenInitialized(() => {
      SyncHelper.queueChange({ entity: "report", op: "replaceAll", data: initialReports });
    });
    LogBroker.publish("INFO", "PrepReportService", `共创建 ${targetGroups.length} 大目标人群、涵盖多品类的日矩阵底层种子数据。`);
  }


  /**
   * @description 分发变更通知（阶段三起不再兼任同步职责——每个具体的 mutation 方法完成内存状态变更后
   * 自行调用 SyncHelper.queueChange() 显式描述这次变了什么，此处只做本地监听者分发）
   */
  private static saveToStorage(): void {
    this.notifyListeners();
  }

  /**
   * @description 动态增加一个原材料子细类明细行
   */
  public static async addPreparedItem(
    targetGroup: TargetGroup,
    category: FoodCategory,
    name: string,
    unit: string
  ): Promise<PreparedItem> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!name.trim()) {
          reject(new Error("原料名称不能为空"));
          return;
        }

        const reportIndex = this.reports.findIndex((r) => r.targetGroup === targetGroup);
        if (reportIndex === -1) {
          reject(new Error(`无法找到目标人群分类为 "${targetGroup}" 的月度报表`));
          return;
        }



        // 采用不可变方式克隆更新，确保 React 感知到 report.items 数组变化
        const report = this.reports[reportIndex];
        const dailyData: Record<string, DailyEntry> = {};
        for (let d = 1; d <= 31; d++) {
          dailyData[String(d)] = { quantity: 0, price: 0, amount: 0 };
        }
        const newItem: PreparedItem = {
          id: `item_${targetGroup.toLowerCase()}_${category.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          name: name.trim(),
          category,
          targetGroup,
          unit: unit.trim() || CATEGORY_DEFAULT_UNITS[category] || "斤",
          dailyData
        };

        // 同步确保台账系统也存在该原料项目
        LedgerService.addLedgerItem(
          targetGroup,
          newItem.name,
          newItem.unit,
          "",
          0
        ).then(() => {
          const updatedReport = {
            ...report,
            items: [...report.items, newItem]
          };

          const updatedReports = [...this.reports];
          updatedReports[reportIndex] = updatedReport;
          this.reports = updatedReports;

          this.saveToStorage();
          this.queuePreparedItemUpsertOps(newItem);
          LogBroker.publish("INFO", "PrepReportService", `在「${targetGroup}」的 [${category}] 品类下成功新增了 [${name}] 的记录槽。`);
          resolve(newItem);
        }).catch((err) => {
          // 如果台账内该原料已存在，依然追加至备餐明细
          const updatedReport = {
            ...report,
            items: [...report.items, newItem]
          };
          const updatedReports = [...this.reports];
          updatedReports[reportIndex] = updatedReport;
          this.reports = updatedReports;

          this.saveToStorage();
          this.queuePreparedItemUpsertOps(newItem);
          resolve(newItem);
        });
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 修改某一单元格 (某项、某天) 的具体用料情况并瞬间核算（全面采用 Immutable 不可变更新以完美驱动受控 input 刷新）
   */
  public static async updateCell(
    itemId: string,
    day: string,
    quantity: number,
    price: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        let found = false;
        let matchedReport: GroupMonthlyReport | undefined;
        let matchedItem: PreparedItem | undefined;
        let matchedEntry: DailyEntry | undefined;

        const updatedReports = this.reports.map((report) => {
          const itemIndex = report.items.findIndex((i) => i.id === itemId);
          if (itemIndex > -1) {
            found = true;
            const item = report.items[itemIndex];
            matchedReport = report;
            matchedItem = item;

            // 复制 dailyData 深度属性，更新指定一天的指标数值并重新计算子金额
            const updatedDailyData = { ...item.dailyData };
            const entry = updatedDailyData[day] ? { ...updatedDailyData[day] } : { quantity: 0, price: 0, amount: 0 };

            // 非负数校验，同时兜底非法数字（如 NaN）不会绕过 Math.max 的负数拦截
            entry.quantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
            entry.price = Number.isFinite(price) ? Math.max(0, price) : 0;
            entry.amount = calculateEntryAmount(entry.quantity, entry.price);
            updatedDailyData[day] = entry;
            matchedEntry = entry;

            // 克隆食材项及列表
            const updatedItem = {
              ...item,
              dailyData: updatedDailyData
            };

            const updatedItems = [...report.items];
            updatedItems[itemIndex] = updatedItem;

            // 克隆整个报表对象
            return {
              ...report,
              items: updatedItems
            };
          }
          return report;
        });

        if (!found) {
          reject(new Error(`未找到ID为 "${itemId}" 的项目，修改失败`));
          return;
        }

        this.reports = updatedReports;

        // 物理存盘并实时派发通知，实现微秒级完美热更新
        this.saveToStorage();
        if (matchedItem && matchedEntry) {
          if (this.hasMeaningfulDailyEntry(matchedEntry)) {
            SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "upsert", key: { itemId: matchedItem.id, date: day }, data: matchedEntry });
          } else {
            SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "delete", key: { itemId: matchedItem.id, date: day } });
          }
        }

        // 获取当前报表客群，更新台账的采购数据
        if (matchedReport && matchedItem) {
          const monthStr = String(matchedReport.month).padStart(2, "0");
          const dayStr = String(day).padStart(2, "0");
          const targetDateKey = `${matchedReport.year}-${monthStr}-${dayStr}`;

          // 查询字典，获取换算单位
          const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === matchedItem!.name);
          const conversionQty = (dictItem && dictItem.conversionRatio)
            ? Number((quantity * dictItem.conversionRatio).toFixed(2))
            : undefined;

          // 构造 DailyStockRecord
          const ledgerRecordFields = {
            inQuantity: quantity,
            inPrice: price,
            inAmount: Number((quantity * price).toFixed(2)),
            conversionUnitQuantity: conversionQty
          };

          // 物理写入台账中此原料在指定日期下的入库数据
          LedgerService.updateDailyRecordByKey(matchedReport.targetGroup, matchedItem.name, targetDateKey, ledgerRecordFields)
            .then(() => {
              // 触发一次全局变动通知
              this.notifyListeners();
              resolve();
            })
            .catch((err) => {
              LogBroker.publish("WARN", "PrepReportService", `反向同步至台账失败: ${err.message}`);
              resolve();
            });
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * @description 一键物理删除某一细分原料行（不可变数据结构克隆设计）
   */
  public static async deletePreparedItem(itemId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let deleted = false;

        const updatedReports = this.reports.map((report) => {
          const filtered = report.items.filter((item) => item.id !== itemId);
          if (filtered.length < report.items.length) {
            deleted = true;
            return {
              ...report,
              items: filtered
            };
          }
          return report;
        });

        if (deleted) {
          this.reports = updatedReports;
          this.saveToStorage();
          SyncHelper.queueChange({ entity: "preparedItem", op: "delete", key: itemId });
          LogBroker.publish("INFO", "PrepReportService", `成功从系统中永久剔除条目ID: ${itemId}`);
          resolve();
        } else {
          reject(new Error(`无法定位删除项ID: ${itemId}`));
        }
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 批量将特定受众、特定日期、特定大品类下的所有细分单价统一刷成同一数值（不可变更新，彻底重绘相关依赖）
   */
  public static async batchUpdatePriceCol(
    targetGroup: TargetGroup,
    category: FoodCategory,
    day: string,
    fixedPrice: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const reportIndex = this.reports.findIndex((r) => r.targetGroup === targetGroup);
        if (reportIndex === -1) {
          reject(new Error("该人群报表不存在"));
          return;
        }

        const report = this.reports[reportIndex];
        const touchedEntries: Array<{ itemId: string; entry: DailyEntry }> = [];
        const updatedItems = report.items.map((item) => {
          if (item.category === category) {
            const updatedDailyData = { ...item.dailyData };
            const entry = updatedDailyData[day] ? { ...updatedDailyData[day] } : { quantity: 0, price: 0, amount: 0 };

            entry.price = Math.max(0, fixedPrice);
            entry.amount = calculateEntryAmount(entry.quantity, entry.price);
            updatedDailyData[day] = entry;
            touchedEntries.push({ itemId: item.id, entry });

            return {
              ...item,
              dailyData: updatedDailyData
            };
          }
          return item;
        });

        const updatedReport = {
          ...report,
          items: updatedItems
        };

        const updatedReports = [...this.reports];
        updatedReports[reportIndex] = updatedReport;
        this.reports = updatedReports;

        this.saveToStorage();
        touchedEntries.forEach(({ itemId, entry }) => {
          if (this.hasMeaningfulDailyEntry(entry)) {
            SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "upsert", key: { itemId, date: day }, data: entry });
          } else {
            SyncHelper.queueChange({ entity: "preparedItemDailyData", op: "delete", key: { itemId, date: day } });
          }
        });
        LogBroker.publish("INFO", "PrepReportService", `由于一键调价动作，群组「${targetGroup}」下的品类 [${category}] 在 [${day}号] 均统一设定为单价 ${fixedPrice}元`);
        resolve();
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 新增或编辑一级人群配置并落盘
   * @param key 标识键
   * @param label 显示中文标签
   * @param emoji 展现表情符号
   */
  public static async saveGroup(key: string, label: string, emoji: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          if (!key || !key.trim()) {
            reject(new Error("人群标识键不能为空"));
            return;
          }
          if (!label || !label.trim()) {
            reject(new Error("人群名称标签不能为空"));
            return;
          }

          const upperKey = key.trim().toUpperCase();
          const existingIndex = this.activeGroups.findIndex((g) => g.key === upperKey);
          let newReport: GroupMonthlyReport | null = null;

          if (existingIndex > -1) {
            this.activeGroups[existingIndex] = {
              key: upperKey,
              label: label.trim(),
              emoji: emoji.trim() || "🍽️",
              // 保留原有的默认数据标记，确保系统默认人群被编辑后依然不可删除
              isDefault: this.activeGroups[existingIndex].isDefault
            };
            LogBroker.publish("INFO", "PrepReportService", `更新了一级备餐人群: ${label} (${upperKey})`);
          } else {
            this.activeGroups.push({
              key: upperKey,
              label: label.trim(),
              emoji: emoji.trim() || "🍽️"
            });
            const reportExists = this.reports.some((r) => r.targetGroup === upperKey as TargetGroup);
            if (!reportExists) {
              const currentYear = new Date().getFullYear();
              const currentMonth = new Date().getMonth() + 1;

              newReport = {
                targetGroup: upperKey as TargetGroup,
                year: currentYear,
                month: currentMonth,
                items: []
              };
              this.reports.push(newReport);
            }
            LogBroker.publish("INFO", "PrepReportService", `新增了一级备餐人群: ${label} (${upperKey})`);
          }

          this.saveConfigAndNotify();
          const savedGroup = this.activeGroups.find((g) => g.key === upperKey)!;
          SyncHelper.queueChange({ entity: "activeGroup", op: "upsert", key: upperKey, data: savedGroup });
          if (newReport) {
            this.queueReportUpsertOp(newReport);
          }
          // 同步至台账服务
          LedgerService.syncLedgerFromGroup(upperKey, label.trim());
          resolve();
        } catch (error) {
          reject(error);
        }
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 删除一级人群配置及关联的所有报表条目（系统默认生成的人群不允许删除，仅允许编辑）
   * @param key 人群标识键
   */
  public static async deleteGroup(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const upperKey = key.toUpperCase();
        const target = this.activeGroups.find((g) => g.key.toUpperCase() === upperKey);
        if (target?.isDefault) {
          reject(new Error(`「${target.label}」是系统默认人群，不允许删除，如需调整可编辑其名称或图标`));
          return;
        }
        const removedReports = this.reports.filter((r) => r.targetGroup.toUpperCase() === upperKey);
        this.activeGroups = this.activeGroups.filter((g) => g.key.toUpperCase() !== upperKey);
        this.reports = this.reports.filter((r) => r.targetGroup.toUpperCase() !== upperKey as any);
        LogBroker.publish("WARN", "PrepReportService", `剔除了一级备餐人群及关联的所有报表: ${upperKey}`);
        this.saveConfigAndNotify();
        SyncHelper.queueChange({ entity: "activeGroup", op: "delete", key: upperKey });
        removedReports.forEach((report) => {
          SyncHelper.queueChange({ entity: "report", op: "delete", key: { targetGroup: report.targetGroup, year: report.year, month: report.month } });
        });
        // 同步至台账服务进行对应删除
        LedgerService.syncDeleteLedgerFromGroup(upperKey);
        resolve();
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 新增或编辑二级食材大类配置并在系统落盘
   * @param key 大类唯一标识键
   * @param label 大类名称显名
   */
  public static async saveCategory(key: string, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          if (!key || !key.trim()) {
            reject(new Error("大类标识键不能为空"));
            return;
          }
          if (!label || !label.trim()) {
            reject(new Error("大类名称标签不能为空"));
            return;
          }

          const upperKey = key.trim().toUpperCase();
          const existingIndex = this.activeCategories.findIndex((c) => c.key === upperKey);

          if (existingIndex > -1) {
            this.activeCategories[existingIndex] = {
              key: upperKey,
              label: label.trim(),
              // 保留原有的默认数据标记，确保系统默认大类被编辑后依然不可删除
              isDefault: this.activeCategories[existingIndex].isDefault
            };
            LogBroker.publish("INFO", "PrepReportService", `更新了二级食材大类: ${label} (${upperKey})`);
          } else {
            this.activeCategories.push({
              key: upperKey,
              label: label.trim()
            });
            LogBroker.publish("INFO", "PrepReportService", `新增了二级食材大类: ${label} (${upperKey})`);
          }

          this.saveConfigAndNotify();
          const savedCategory = this.activeCategories.find((c) => c.key === upperKey)!;
          SyncHelper.queueChange({ entity: "activeCategory", op: "upsert", key: upperKey, data: savedCategory });
          resolve();
        } catch (error) {
          reject(error);
        }
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 删除二级大品类配置并清空所有报表里属于此大类的细分项（系统默认生成的大类不允许删除，仅允许编辑）
   * @param key 大类标识键
   */
  public static async deleteCategory(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const upperKey = key.toUpperCase();
        const target = this.activeCategories.find((c) => c.key === upperKey);
        if (target?.isDefault) {
          reject(new Error(`「${target.label}」是系统默认大类，不允许删除，如需调整可编辑其名称`));
          return;
        }
        this.activeCategories = this.activeCategories.filter((c) => c.key !== upperKey);
        const removedItemIds: string[] = [];
        this.reports.forEach((report) => {
          const removed = report.items.filter((item) => item.category === upperKey as FoodCategory);
          removedItemIds.push(...removed.map((item) => item.id));
          report.items = report.items.filter((item) => item.category !== upperKey as FoodCategory);
        });
        LogBroker.publish("WARN", "PrepReportService", `剔除了二级大类及各群体名下的对应食材: ${upperKey}`);
        this.saveConfigAndNotify();
        SyncHelper.queueChange({ entity: "activeCategory", op: "delete", key: upperKey });
        removedItemIds.forEach((itemId) => {
          SyncHelper.queueChange({ entity: "preparedItem", op: "delete", key: itemId });
        });
        resolve();
      }, MOCK_API_LATENCY);
    });
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

