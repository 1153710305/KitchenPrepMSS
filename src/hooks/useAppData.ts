/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 封装 App 顶层的核心数据加载与多端同步逻辑的自定义 Hook：负责首屏并行初始化备餐报表/台账/原料字典三大服务、注册统一的内存数据提取器供 SyncHelper 去抖动上报、订阅各服务的数据变动、以及每 10 秒一次的静默心跳同步。
 */

import { useEffect, useState } from "react";
import { GroupMonthlyReport, DynamicGroup, DynamicCategory } from "../types/types.ts";
import { UI_TEXT } from "../constants/constants.ts";
import { PrepReportService } from "../services/store.ts";
import { LedgerService } from "../services/ledgerStore.ts";
import { SyncHelper } from "../services/syncHelper.ts";
import { RawMaterialsDictService } from "../services/rawMaterialDict.ts";
import { LogBroker } from "../utils.ts";

/**
 * @description useAppData 返回值接口
 */
export interface UseAppDataResult {
  /** 当前加载好的月度多客群报表数组 */
  reports: GroupMonthlyReport[];
  /** 当前激活聚焦决策的一级餐位人群唯一标识Key */
  activeGroup: string;
  setActiveGroup: (val: string | ((prev: string) => string)) => void;
  /** 当前选中的二级食材品类。为 null 时代表"合计汇总"汇总表 */
  activeCategory: string | null;
  setActiveCategory: (val: string | null | ((prev: string | null) => string | null)) => void;
  /** 系统离线架构自检与加载态指示 */
  isLoading: boolean;
  /** 自动同步极速轻量气泡提示文字 */
  saveToast: string | null;
  /** 首屏数据同步进度 */
  syncProgress: number;
  /** 首屏数据同步文本 */
  progressText: string;
  /** 动态从底层存储库嗅探的一级人群分组 */
  activeGroupsList: DynamicGroup[];
  /** 动态从底层存储库嗅探的二级食材大类 */
  activeCategoriesList: DynamicCategory[];
  /** 订阅的购销台账原料列表 */
  ledgerItemsList: any[];
}

/**
 * @description 管理备餐报表/台账/原料字典三大服务的首屏并行加载、内存数据提取器注册、数据变动订阅与心跳静默同步的自定义 Hook
 */
export function useAppData(): UseAppDataResult {
  /** 当前加载好的月度多客群报表数组 */
  const [reports, setReports] = useState<GroupMonthlyReport[]>([]);
  /** 当前激活聚焦决策的一级餐位人群唯一标识Key，默认 TEACHER */
  const [activeGroup, setActiveGroup] = useState<string>("TEACHER");
  /** 当前选中的二级食材品类。当设置为 null 时，代表"合计汇总"汇总表 */
  const [activeCategory, setActiveCategory] = useState<string | null>("VEGETABLE");

  /** 系统离线架构自检与加载态指示 */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /** 自动同步极速轻量气泡提示文字 */
  const [saveToast, setSaveToast] = useState<string | null>(null);

  /** 首屏数据同步进度 */
  const [syncProgress, setSyncProgress] = useState<number>(0);
  /** 首屏数据同步文本 */
  const [progressText, setProgressText] = useState<string>("正在启动网络同步总线...");

  /** 动态从底层存储库嗅探的一级人群分组 */
  const [activeGroupsList, setActiveGroupsList] = useState<DynamicGroup[]>([]);
  /** 动态从底层存储库嗅探的二级食材大类 */
  const [activeCategoriesList, setActiveCategoriesList] = useState<DynamicCategory[]>([]);
  /** 订阅的购销台账原料列表 */
  const [ledgerItemsList, setLedgerItemsList] = useState<any[]>([]);

  /**
   * @description 触发极速防抖自动保存通知标签气泡
   */
  const triggerSaveToast = () => {
    setSaveToast(UI_TEXT.saveSuccess);
    const timer = setTimeout(() => {
      setSaveToast(null);
    }, 2500);
    return () => clearTimeout(timer);
  };

  // 系统初始化，挂载并预检底层存储结构，同时订阅状态变动
  useEffect(() => {
    let active = true;

    // 注册全局内存状态一键提取器，用于各模块修改数据时自动防抖同步给后端，规避多浏览器 LocalStorage 覆写冲突
    SyncHelper.registerMemoryFetcher(() => {
      return {
        reports: PrepReportService.getReports(),
        activeGroups: PrepReportService.getActiveGroups(),
        activeCategories: PrepReportService.getActiveCategories(),
        ledgers: LedgerService.getLedgers(),
        ledgerItems: LedgerService.getLedgerItems(),
        rawMaterialsDict: RawMaterialsDictService.getItems(),
        /** 同步台账常用人员与供货商字典 */
        ledgerHelperDict: LedgerService.getHelperDict()
      };
    });

    // 跟踪首屏并行加载进度
    let progress = 10;
    const reportProgress = (amt: number, txt: string) => {
      progress += amt;
      setSyncProgress(Math.min(100, progress));
      setProgressText(txt);
    };

    // 并行初始化各服务，分别累加进度
    const p1 = PrepReportService.initStore().then(data => {
      reportProgress(30, "已成功装载月度备餐食材细表...");
      return data;
    });

    const p2 = LedgerService.initLedgerStore().then(data => {
      reportProgress(30, "已成功装载原料购销及库存台账...");
      return data;
    });

    const p3 = SyncHelper.loadFromServer().then(data => {
      reportProgress(20, "已成功对齐云端标准大字典底册...");
      return data;
    });

    Promise.all([p1, p2, p3]).then(([prepData, ledgerData, serverData]) => {
      reportProgress(10, "校验并装载全新主控交互面板...");

      // 延迟 400ms 解除，避免一闪而过的尴尬，让进度条 100% 的视觉体验最大化
      setTimeout(() => {
        if (active) {
          // 如果是系统初次启动且 data 目录下没有物理 db.json 数据，清空浏览器本地残留缓存，确保数据完全一致
          if (serverData && (serverData as any).isFirstBoot) {
            console.warn("[SECURITY CLEAR] 监测到系统首航初次启动，强力清洗浏览器旧版缓存，确保与服务器种子一致");
            localStorage.clear();
            sessionStorage.clear();
          }

          setReports(prepData);
          setLedgerItemsList(ledgerData.items);

          // 使用服务器的原料大字典来初始化字典内存
          const sDict = serverData ? (serverData as any).rawMaterialsDict : undefined;
          RawMaterialsDictService.initDictFromServer(sDict);

          const groups = PrepReportService.getActiveGroups();
          const cats = PrepReportService.getActiveCategories();
          setActiveGroupsList(groups);
          setActiveCategoriesList(cats);

          // 如果动态列表已经就绪，并且默认或先前的选中项不存在了，自适应调平到首项
          if (groups.length > 0 && !groups.some((g) => g.key === activeGroup)) {
            setActiveGroup(groups[0].key);
          }
          if (cats.length > 0 && activeCategory && !cats.some((c) => c.key === activeCategory)) {
            setActiveCategory(cats[0].key);
          }

          setIsLoading(false);
          SyncHelper.setInitialized(true);
          LogBroker.publish("INFO", "App", "系统已完成备餐、台账以及大字典服务数据模型的全局并行加载初始化");
        }
      }, 400);
    }).catch(err => {
      LogBroker.publish("ERROR", "App", "加载基础数据服务异常:", String(err));
    });

    // 监听服务数据重大变动回调，实现各版块自动重算
    const unsubscribe = PrepReportService.subscribe((updated) => {
      if (active) {
        setReports(updated);
        const groups = PrepReportService.getActiveGroups();
        const cats = PrepReportService.getActiveCategories();
        setActiveGroupsList(groups);
        setActiveCategoriesList(cats);

        // 防止配置后台因级联删除而导致的悬空逻辑
        const groupKeys = groups.map((g) => g.key);
        const catKeys = cats.map((c) => c.key);

        setActiveGroup((prev) => {
          if (prev === "LEDGER") return prev;
          if (groupKeys.includes(prev)) return prev;
          return groupKeys[0] || "TEACHER";
        });

        setActiveCategory((prev) => {
          if (prev === null) return null;
          if (catKeys.includes(prev)) return prev;
          return catKeys[0] || "VEGETABLE";
        });

        // 触发自动存盘微气泡
        triggerSaveToast();
      }
    });

    // 监听原料台账数据的变动，为了能在 aside 底栏展示统计金额
    const unsubscribeLedger = LedgerService.subscribe((_ledgers, updatedItems) => {
      if (active) {
        setLedgerItemsList(updatedItems);
      }
    });

    // 心跳静默同步：每 10 秒钟静默从服务器拉取一次最新状态覆盖内存并触发分发重绘（解决多浏览器并发操作数据冲突）
    const syncInterval = setInterval(async () => {
      try {
        const freshData = await SyncHelper.loadFromServer();
        if (freshData && active) {
          let memoryChanged = false;

          if (freshData.reports && JSON.stringify(freshData.reports) !== JSON.stringify(PrepReportService.getReports())) {
            PrepReportService.setReportsInMemory(freshData.reports);
            memoryChanged = true;
          }
          if (freshData.activeGroups && JSON.stringify(freshData.activeGroups) !== JSON.stringify(PrepReportService.getActiveGroups())) {
            PrepReportService.setActiveGroupsInMemory(freshData.activeGroups);
            memoryChanged = true;
          }
          if (freshData.activeCategories && JSON.stringify(freshData.activeCategories) !== JSON.stringify(PrepReportService.getActiveCategories())) {
            PrepReportService.setActiveCategoriesInMemory(freshData.activeCategories);
            memoryChanged = true;
          }
          if (freshData.ledgers && JSON.stringify(freshData.ledgers) !== JSON.stringify(LedgerService.getLedgers())) {
            LedgerService.setLedgersInMemory(freshData.ledgers);
            memoryChanged = true;
          }
          if (freshData.ledgerItems && JSON.stringify(freshData.ledgerItems) !== JSON.stringify(LedgerService.getLedgerItems())) {
            LedgerService.setLedgerItemsInMemory(freshData.ledgerItems);
            memoryChanged = true;
          }
          if ((freshData as any).rawMaterialsDict && JSON.stringify((freshData as any).rawMaterialsDict) !== JSON.stringify(RawMaterialsDictService.getItems())) {
            RawMaterialsDictService.setRawMaterialsDictInMemory((freshData as any).rawMaterialsDict);
            memoryChanged = true;
          }

          if (memoryChanged) {
            // 强行分发，使 React UI 触发重新渲染，对齐最新服务器状态
            PrepReportService.forceNotify();
            LedgerService.forceNotify();
            LogBroker.publish("INFO", "App", "心跳同步成功，检测到服务器数据变化并完成多端数据静默对齐");
          }
        }
      } catch (err) {
        console.warn("[SILENT HEARTBEAT SYNC] 静默定时同步失败:", err);
      }
    }, 10000);

    // 监听前端浏览器全局未捕获 JS 运行时脚本错误
    const handleGlobalError = (event: ErrorEvent) => {
      const errMsg = `Message: ${event.message} | Source: ${event.filename} | Line: ${event.lineno}:${event.colno} | Stack: ${event.error?.stack || "No Stack"}`;
      LogBroker.publish("ERROR", "ClientGlobalError", errMsg);
    };

    // 监听前端未捕获 Promise Rejection
    const handleGlobalRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errMsg = reason instanceof Error ? `${reason.message}\nStack: ${reason.stack}` : String(reason);
      LogBroker.publish("ERROR", "ClientUnhandledRejection", errMsg);
    };

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleGlobalRejection);

    return () => {
      active = false;
      unsubscribe();
      unsubscribeLedger();
      clearInterval(syncInterval);
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleGlobalRejection);
    };
  }, []);

  return {
    reports,
    activeGroup,
    setActiveGroup,
    activeCategory,
    setActiveCategory,
    isLoading,
    saveToast,
    syncProgress,
    progressText,
    activeGroupsList,
    activeCategoriesList,
    ledgerItemsList
  };
}
