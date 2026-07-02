/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 客户端与后端持久化层之间的同步协调器（SyncHelper）：统一收集全部业务数据、去抖动批量提交给服务端，并在系统初始化完成前加锁防止空状态覆写云端数据。
 */

/**
 * @interface BackendData
 * @description 后端同步数据结构定义，合并了系统报表及台账的所有数据片
 */
export interface BackendData {
  /**
   * @description 备餐月度报表集
   */
  reports?: any[];
  /**
   * @description 活跃的一级受众人群列表
   */
  activeGroups?: any[];
  /**
   * @description 活跃的二级食材大类列表
   */
  activeCategories?: any[];
  /**
   * @description 原料购销台账列表
   */
  ledgers?: any[];
  /**
   * @description 采购原料项目列表
   */
  ledgerItems?: any[];
}

/**
 * @description 客户端与服务端数据同步助手类 (剔除 LocalStorage 本地缓存，完全基于内存与服务器通信)
 */
export class SyncHelper {
  /**
   * @description 全局初始化安全锁，只有在首屏 Promise.all 完美拉取就绪后才允许上传，防止引导时空内存覆盖服务器数据
   */
  private static isInitialized = false;

  /**
   * @description 初始化解锁前暂存的一次性回调队列（解锁后立即依次执行并清空）
   */
  private static onReadyQueue: Array<() => void> = [];

  /**
   * @description 开启或关闭全局初始化同步锁
   */
  public static setInitialized(val: boolean): void {
    this.isInitialized = val;
    console.log(`[SYNC HELPER] 全局初始化数据状态锁定已更新为: ${val ? "已就绪(解开限制)" : "未初始化(强力拦截)"}`);
    if (val && this.onReadyQueue.length > 0) {
      const queue = this.onReadyQueue;
      this.onReadyQueue = [];
      queue.forEach((fn) => fn());
    }
  }

  /**
   * @description 注册一个仅在全局初始化解锁后才执行一次的回调；若此时已解锁则立即同步执行，避免早于初始化完成的同步请求被拦截丢弃
   * @param fn 待执行的回调
   */
  public static runWhenInitialized(fn: () => void): void {
    if (this.isInitialized) {
      fn();
    } else {
      this.onReadyQueue.push(fn);
    }
  }

  /**
   * @description 动态注册的内存数据提取器，用来获取当前全模块最完整的最新内存数据
   */
  private static memoryFetcher: (() => BackendData) | null = null;

  /**
   * @description 注册内存数据提取器回调
   * @param fetcher 提取器函数
   */
  public static registerMemoryFetcher(fetcher: () => BackendData): void {
    this.memoryFetcher = fetcher;
  }

  /**
   * @description 从服务器拉取最新的完整数据并返回给调用层
   * @returns {Promise<BackendData | null>} 获取到的后端数据，若失败或无数据则返回 null
   */
  public static async loadFromServer(): Promise<BackendData | null> {
    try {
      const response = await fetch("/api/storage/load");
      if (!response.ok) {
        throw new Error(`服务器拉取失败: ${response.statusText}`);
      }
      const data: BackendData = await response.json();
      
      if (!data) return null;
      // 过滤掉只有 isFirstBoot 而无其他数据属性的空状态壳，使其能在首航返回 null 并加载本地默认种子
      const hasRealPayload = Object.keys(data).some(k => k !== "isFirstBoot");
      if (!hasRealPayload) {
        return { isFirstBoot: (data as any).isFirstBoot } as any;
      }

      return data;
    } catch (err) {
      console.error("[SYNC HELPER] 从后端加载数据失败:", err);
      return null;
    }
  }

  /**
   * @description 将当前系统在内存中的最新完整状态推送到后端保存（防抖 200 毫秒，防止高频点击/录入导致请求阻塞）
   * @param {BackendData} [customData] 可选的特定数据，不传时自动通过已注册的 memoryFetcher 从内存一键拉取
   * @returns {void}
   */
  public static triggerSyncToServer(customData?: BackendData): void {
    if (!this.isInitialized) {
      console.warn("[SYNC HELPER] 系统尚未初始化完成，拦截空内存数据同步云端，保护云端数据安全");
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 防抖 200 毫秒
    this.debounceTimer = setTimeout(async () => {
      try {
        // 如果没有传入特定数据包，则使用 memoryFetcher 自主合并最新的内存报表和台账数据
        const data = customData || (this.memoryFetcher ? this.memoryFetcher() : {});
        
        const response = await fetch("/api/storage/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          throw new Error(`服务器保存失败: ${response.statusText}`);
        }
        
        const resJson = await response.json();
        console.log(`[SYNC HELPER] 数据已成功同步保存至服务器后端:`, resJson);
      } catch (err) {
        console.error("[SYNC HELPER] 数据同步保存至后端失败:", err);
      }
    }, 200);
  }
}
