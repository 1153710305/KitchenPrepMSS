/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PRESET_ITEMS_BY_CATEGORY, CATEGORY_DEFAULT_UNITS } from "./constants.ts";
import { FoodCategory, GroupMonthlyReport, PreparedItem, TargetGroup, DailyEntry, DynamicGroup, DynamicCategory } from "./types.ts";
import { calculateEntryAmount, LogBroker } from "./utils.ts";
import { SyncHelper } from "./syncHelper.ts";
import { LedgerService } from "./ledgerStore.ts";

/** 
 * @description 本地 LocalStorage 物理缓存 Key 
 */
const STORAGE_KEY = "KITCHEN_PREP_REPORTS_V1";

/**
 * @description 一级人群缓存 Key
 */
const GROUPS_STORAGE_KEY = "KITCHEN_TARGET_GROUPS_V1";

/**
 * @description 二级分类缓存 Key
 */
const CATEGORIES_STORAGE_KEY = "KITCHEN_FOOD_CATEGORIES_V1";

/**
 * @description 自动模拟服务层接口呼叫时延 (毫秒)
 */
const MOCK_API_LATENCY = 150;

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
   * @description 启动并自检缓存。若无，自动使用 constants 中提取的种子填充库
   */
  public static async initStore(): Promise<GroupMonthlyReport[]> {
    try {
      // 优先从后端拉取最新同步数据落盘
      await SyncHelper.loadFromServer();
    } catch (err) {
      LogBroker.publish("WARN", "PrepReportService", "同步服务器数据失败，降级使用本地缓存: " + String(err));
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          // 加载动态一级人群配置
          const cachedGroups = localStorage.getItem(GROUPS_STORAGE_KEY);
          if (cachedGroups) {
            this.activeGroups = JSON.parse(cachedGroups);
          } else {
            this.activeGroups = [
              { key: "KID", label: "幼儿备餐", emoji: "👶" },
              { key: "STUDENT", label: "在校生备餐", emoji: "🎒" },
              { key: "TEACHER", label: "教师备餐", emoji: "👩‍🏫" }
            ];
            localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(this.activeGroups));
          }

          // 加载动态二级大类配置
          const cachedCategories = localStorage.getItem(CATEGORIES_STORAGE_KEY);
          if (cachedCategories) {
            this.activeCategories = JSON.parse(cachedCategories);
          } else {
            this.activeCategories = [
              { key: "VEGETABLE", label: "蔬菜" },
              { key: "GRAIN_OIL", label: "粮油" },
              { key: "SEASONING", label: "调料" },
              { key: "MEAT", label: "肉类" },
              { key: "LOW_CONSUMP", label: "低耗品" },
              { key: "FRUIT", label: "水果" }
            ];
            localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(this.activeCategories));
          }

          // 加载月度报表
          const cached = localStorage.getItem(STORAGE_KEY);
          if (cached) {
            const loadedReports = JSON.parse(cached) as GroupMonthlyReport[];
            // 补正老版本数据中或导入数据中缺失的 dailyHeadcount 属性，并添加中文注释
            this.reports = loadedReports.map((report) => {
              if (!report.dailyHeadcount) {
                const dailyHeadcount: Record<string, number> = {};
                for (let d = 1; d <= 31; d++) {
                  let defaultCount = 50;
                  if (report.targetGroup === "TEACHER") defaultCount = 20;
                  else if (report.targetGroup === "KID") defaultCount = 120;
                  else if (report.targetGroup === "LOW_GRADE") defaultCount = 80;
                  else if (report.targetGroup === "HIGH_GRADE") defaultCount = 90;
                  dailyHeadcount[String(d)] = defaultCount;
                }
                return { ...report, dailyHeadcount };
              }
              return report;
            });
            LogBroker.publish("INFO", "PrepReportService", "已从 LocalStorage 重新挂载物理备餐数据集并自动补全人数配置");
          } else {
            this.generateInitialSeeds();
          }
          resolve(this.reports);
        } catch (error) {
          LogBroker.publish("ERROR", "PrepReportService", "启动阶段加载缓存遇到严重异常:", String(error));
          this.generateInitialSeeds();
          resolve(this.reports);
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

      const dailyHeadcount: Record<string, number> = {};
      for (let d = 1; d <= 31; d++) {
        dailyHeadcount[String(d)] = 50;
      }

      report = {
        targetGroup: targetGroup as TargetGroup,
        year,
        month,
        items,
        dailyHeadcount
      };
      this.reports.push(report);
      this.saveToStorage();
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

      if (itemIndex > -1) {
        const item = report.items[itemIndex];
        const updatedDailyData = { ...item.dailyData };
        updatedDailyData[day] = {
          quantity,
          price,
          amount: Math.round(quantity * price * 100) / 100
        };
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
      }

      this.saveConfigAndNotify();
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
      }
    } else {
      this.activeGroups.push({
        key: id,
        label: name,
        emoji: "🍽️"
      });
      // 检查当前年月报表是否存在
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const reportExists = this.reports.some((r) => r.targetGroup === id as TargetGroup && r.year === currentYear && r.month === currentMonth);
      if (!reportExists) {
        const dailyHeadcount: Record<string, number> = {};
        for (let d = 1; d <= 31; d++) {
          dailyHeadcount[String(d)] = 50;
        }
        this.reports.push({
          targetGroup: id as TargetGroup,
          year: currentYear,
          month: currentMonth,
          items: [],
          dailyHeadcount
        });
      }
      this.saveConfigAndNotify();
    }
  }

  /**
   * @description 从台账同步删除餐位人群配置
   * @param id 台账ID / 人群Key
   */
  public static syncDeleteGroupFromLedger(id: string): void {
    const upperKey = id.toUpperCase();
    this.activeGroups = this.activeGroups.filter((g) => g.key !== upperKey);
    this.reports = this.reports.filter((r) => r.targetGroup !== upperKey as TargetGroup);
    LogBroker.publish("WARN", "PrepReportService", `从台账同步物理移除了群组与备餐报表: ${upperKey}`);
    this.saveConfigAndNotify();
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
            const isSampleDay = d <= 5;
            const initialQty = isSampleDay ? Math.round((20 + (itemIndex % 4) * 8 + d * 3) * 10) / 10 : 0;
            const initialPrice = isSampleDay ? Math.round((3.2 + (itemIndex % 3) * 1.5) * 10) / 10 : 0;
            
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

      // 初始化就餐人数并编写中文注释
      const dailyHeadcount: Record<string, number> = {};
      for (let d = 1; d <= 31; d++) {
        let defaultCount = 50;
        if (group === "TEACHER") defaultCount = 20;
        else if (group === "KID") defaultCount = 120;
        else if (group === "LOW_GRADE") defaultCount = 80;
        else if (group === "HIGH_GRADE") defaultCount = 90;
        dailyHeadcount[String(d)] = defaultCount;
      }

      return {
        targetGroup: group as TargetGroup,
        year: currentYear,
        month: currentMonth,
        items,
        dailyHeadcount
      };
    });

    this.reports = initialReports;
    this.saveToStorage();
    LogBroker.publish("INFO", "PrepReportService", `共创建 ${targetGroups.length} 大目标人群、涵盖多品类的日矩阵底层种子数据。`);
  }


  /**
   * @description 持久化落盘物理手段
   */
  private static saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.reports));
      this.notifyListeners();
      // 异步同步到后端存储
      SyncHelper.triggerSyncToServer();
    } catch (err) {
      LogBroker.publish("ERROR", "PrepReportService", "数据落盘LocalStorage发生溢出或权限阻碍错误", String(err));
    }
  }

  /**
   * @description 异步获取所有群组下的报表集
   */
  public static async fetchAllReports(): Promise<GroupMonthlyReport[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.reports);
      }, MOCK_API_LATENCY);
    });
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

        // 采用不可变方式克隆更新，确保 React 感知到 report.items 数组变化
        const report = this.reports[reportIndex];
        const updatedReport = {
          ...report,
          items: [...report.items, newItem]
        };

        const updatedReports = [...this.reports];
        updatedReports[reportIndex] = updatedReport;
        this.reports = updatedReports;

        this.saveToStorage();
        LogBroker.publish("INFO", "PrepReportService", `在「${targetGroup}」的 [${category}] 品类下成功新增了 [${name}] 的记录槽。`);
        resolve(newItem);
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
            
            entry.quantity = Math.max(0, quantity);
            entry.price = Math.max(0, price);
            entry.amount = calculateEntryAmount(entry.quantity, entry.price);
            updatedDailyData[day] = entry;

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

        // 【同步反向改写台账】当备餐单元格被编辑时，自动反向推送到台账数据集中，保证一一对应
        if (matchedReport && matchedItem) {
          const monthStr = String(matchedReport.month).padStart(2, "0");
          const dayStr = String(day).padStart(2, "0");
          const targetDateKey = `${matchedReport.year}-${monthStr}-${dayStr}`;
          
          // 查询字典，看是否具有换算单位
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
            .then(() => resolve())
            .catch((err) => {
              LogBroker.publish("WARN", "PrepReportService", `反向同步至台账失败 (可能需要先在台账里创建该原料): ${err.message}`);
              resolve(); // 备餐修改完成，不影响体验，平稳解脱
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
        const updatedItems = report.items.map((item) => {
          if (item.category === category) {
            const updatedDailyData = { ...item.dailyData };
            const entry = updatedDailyData[day] ? { ...updatedDailyData[day] } : { quantity: 0, price: 0, amount: 0 };
            
            entry.price = Math.max(0, fixedPrice);
            entry.amount = calculateEntryAmount(entry.quantity, entry.price);
            updatedDailyData[day] = entry;

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
        LogBroker.publish("INFO", "PrepReportService", `由于一键调价动作，群组「${targetGroup}」下的品类 [${category}] 在 [${day}号] 均统一设定为单价 ${fixedPrice}元`);
        resolve();
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 清空当月所有卡片（Immutable 重制零值）
   */
  public static async clearAllMonthlyCells(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const updatedReports = this.reports.map((report) => {
          const updatedItems = report.items.map((item) => {
            const updatedDailyData = { ...item.dailyData };
            Object.keys(updatedDailyData).forEach((day) => {
              updatedDailyData[day] = { quantity: 0, price: 0, amount: 0 };
            });
            return {
              ...item,
              dailyData: updatedDailyData
            };
          });
          return {
            ...report,
            items: updatedItems
          };
        });

        this.reports = updatedReports;
        this.saveToStorage();
        LogBroker.publish("WARN", "PrepReportService", "已触发当期月备采表全局数据归零！");
        resolve();
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 彻底重置物理，销毁LocalStorage并退回到演示种子大厅
   */
  public static async factoryReset(): Promise<GroupMonthlyReport[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(GROUPS_STORAGE_KEY);
        localStorage.removeItem(CATEGORIES_STORAGE_KEY);
        
        this.activeGroups = [
          { key: "TEACHER", label: "教师备餐", emoji: "🏫" },
          { key: "KID", label: "幼儿备餐", emoji: "👶" },
          { key: "LOW_GRADE", label: "低年级备餐", emoji: "🎒" },
          { key: "HIGH_GRADE", label: "高年级备餐", emoji: "🎓" }
        ];
        this.activeCategories = [
          { key: "VEGETABLE", label: "蔬菜" },
          { key: "GRAIN_OIL", label: "粮油" },
          { key: "SEASONING", label: "调料" },
          { key: "MEAT", label: "肉类" },
          { key: "LOW_CONSUMP", label: "低耗品" },
          { key: "FRUIT", label: "水果" }
        ];
        
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(this.activeGroups));
        localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(this.activeCategories));

        this.generateInitialSeeds();
        resolve(this.reports);
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

          if (existingIndex > -1) {
            this.activeGroups[existingIndex] = {
              key: upperKey,
              label: label.trim(),
              emoji: emoji.trim() || "🍽️"
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
              
              // 新增一级人群时同步初始化 1-31 号的就餐人数 (默认 50 人)
              const dailyHeadcount: Record<string, number> = {};
              for (let d = 1; d <= 31; d++) {
                dailyHeadcount[String(d)] = 50;
              }

              this.reports.push({
                targetGroup: upperKey as TargetGroup,
                year: currentYear,
                month: currentMonth,
                items: [],
                dailyHeadcount
              });
            }
            LogBroker.publish("INFO", "PrepReportService", `新增了一级备餐人群: ${label} (${upperKey})`);
          }

          this.saveConfigAndNotify();
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
   * @description 删除一级人群配置及关联的所有报表条目
   * @param key 人群标识键
   */
  public static async deleteGroup(key: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const upperKey = key.toUpperCase();
        this.activeGroups = this.activeGroups.filter((g) => g.key.toUpperCase() !== upperKey);
        this.reports = this.reports.filter((r) => r.targetGroup.toUpperCase() !== upperKey as any);
        LogBroker.publish("WARN", "PrepReportService", `剔除了一级备餐人群及关联的所有报表: ${upperKey}`);
        this.saveConfigAndNotify();
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
              label: label.trim()
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
          resolve();
        } catch (error) {
          reject(error);
        }
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 删除二级大品类配置并清空所有报表里属于此大类的细分项
   * @param key 大类标识键
   */
  public static async deleteCategory(key: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const upperKey = key.toUpperCase();
        this.activeCategories = this.activeCategories.filter((c) => c.key !== upperKey);
        this.reports.forEach((report) => {
          report.items = report.items.filter((item) => item.category !== upperKey as FoodCategory);
        });
        LogBroker.publish("WARN", "PrepReportService", `剔除了二级大类及各群体名下的对应食材: ${upperKey}`);
        this.saveConfigAndNotify();
        resolve();
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 同步所有配置项目落盘并广播更新消息
   */
  private static saveConfigAndNotify(): void {
    try {
      localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(this.activeGroups));
      localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(this.activeCategories));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.reports));
      this.notifyListeners();
      // 异步同步到后端存储
      SyncHelper.triggerSyncToServer();
    } catch (err) {
      LogBroker.publish("ERROR", "PrepReportService", "数据和配置落盘LocalStorage发生严重异常:", String(err));
    }
  }

  /**
   * @description 更新某一目标人群在某一天的就餐人数，保存至 LocalStorage 并发布操作审计日志
   * @param targetGroup 目标受众人群
   * @param day 具体哪一天 (1-31 号)
   * @param headcount 就餐人数数量
   */
  public static async updateHeadcount(
    targetGroup: TargetGroup,
    day: string,
    headcount: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const reportIndex = this.reports.findIndex((r) => r.targetGroup === targetGroup);
        if (reportIndex === -1) {
          reject(new Error(`未找到目标人群为 "${targetGroup}" 的月度报表`));
          return;
        }

        const report = this.reports[reportIndex];
        const updatedHeadcount = { ...(report.dailyHeadcount || {}) };
        const sanitizedCount = Math.max(1, headcount); // 最小就餐人数为1人，防止除以0

        updatedHeadcount[day] = sanitizedCount;

        const updatedReport = {
          ...report,
          dailyHeadcount: updatedHeadcount
        };

        const updatedReports = [...this.reports];
        updatedReports[reportIndex] = updatedReport;
        this.reports = updatedReports;

        this.saveToStorage();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * @description 安全覆盖式导入备份文件，让用户可以在其它设备恢复录入
   * @param newReports 导入的新月度报表集
   */
  public static async importReports(newReports: GroupMonthlyReport[]): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.reports = newReports;
        this.saveToStorage();
        LogBroker.publish("INFO", "PrepReportService", "全局主存储空间已成功覆写导入的数据。");
        resolve();
      }, MOCK_API_LATENCY);
    });
  }

  /**
   * @description 当从后台原料大底库修改了原料属性时，级联同步更新所有关联的已存备餐食材参数
   */
  public static cascadeUpdateMaterial(oldName: string, newName: string, newCategory: FoodCategory, newUnit: string): void {
    let changed = false;
    this.reports = this.reports.map((report) => {
      const updatedItems = report.items.map((item) => {
        if (item.name === oldName) {
          changed = true;
          return {
            ...item,
            name: newName,
            category: newCategory,
            unit: newUnit
          };
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
    }
  }

  /**
   * @description 当从后台原料大底库删除了原料时，级联同步删除所有关联的已存备餐食材采购项
   */
  public static cascadeDeleteMaterial(name: string): void {
    let changed = false;
    this.reports = this.reports.map((report) => {
      const originalCount = report.items.length;
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
    }
  }
}

