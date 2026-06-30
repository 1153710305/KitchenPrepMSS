/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * @description 客户端与服务端数据同步助手类
 */
export class SyncHelper {
  /**
   * @description 防抖等待定时器引用
   */
  private static debounceTimer: any = null;

  /**
   * @description 本地 LocalStorage 键映射表，便于更新 LocalStorage
   */
  private static keysMap = {
    reports: "KITCHEN_PREP_REPORTS_V1",
    activeGroups: "KITCHEN_TARGET_GROUPS_V1",
    activeCategories: "KITCHEN_FOOD_CATEGORIES_V1",
    ledgers: "KITCHEN_LEDGERS_LIST_V2",
    ledgerItems: "KITCHEN_LEDGER_ITEMS_V2"
  };

  /**
   * @description 从服务器拉取最新的完整数据并覆盖本地 LocalStorage 与内存
   * @returns {Promise<BackendData | null>} 获取到的后端数据，若失败或无数据则返回 null
   */
  public static async loadFromServer(): Promise<BackendData | null> {
    try {
      const response = await fetch("/api/storage/load");
      if (!response.ok) {
        throw new Error(`服务器拉取失败: ${response.statusText}`);
      }
      const data: BackendData = await response.json();
      
      // 如果后端返回了空对象或无效数据，直接返回 null 以让本地使用预设种子
      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      // 将拉取到的有效数据同步写入本地 LocalStorage
      if (data.reports) localStorage.setItem(this.keysMap.reports, JSON.stringify(data.reports));
      if (data.activeGroups) localStorage.setItem(this.keysMap.activeGroups, JSON.stringify(data.activeGroups));
      if (data.activeCategories) localStorage.setItem(this.keysMap.activeCategories, JSON.stringify(data.activeCategories));
      if (data.ledgers) localStorage.setItem(this.keysMap.ledgers, JSON.stringify(data.ledgers));
      if (data.ledgerItems) localStorage.setItem(this.keysMap.ledgerItems, JSON.stringify(data.ledgerItems));

      return data;
    } catch (err) {
      console.error("[SYNC HELPER] 从后端加载数据失败:", err);
      return null;
    }
  }

  /**
   * @description 将当前系统完整状态异步推送到后端保存（带防抖处理）
   * @returns {void}
   */
  public static triggerSyncToServer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 防抖 500 毫秒，防止高频键入时频繁发起网络请求降低性能
    this.debounceTimer = setTimeout(async () => {
      try {
        // 读取本地最新的所有数据状态
        const reportsStr = localStorage.getItem(this.keysMap.reports);
        const groupsStr = localStorage.getItem(this.keysMap.activeGroups);
        const categoriesStr = localStorage.getItem(this.keysMap.activeCategories);
        const ledgersStr = localStorage.getItem(this.keysMap.ledgers);
        const itemsStr = localStorage.getItem(this.keysMap.ledgerItems);

        const payload: BackendData = {
          reports: reportsStr ? JSON.parse(reportsStr) : undefined,
          activeGroups: groupsStr ? JSON.parse(groupsStr) : undefined,
          activeCategories: categoriesStr ? JSON.parse(categoriesStr) : undefined,
          ledgers: ledgersStr ? JSON.parse(ledgersStr) : undefined,
          ledgerItems: itemsStr ? JSON.parse(itemsStr) : undefined
        };

        const response = await fetch("/api/storage/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`服务器保存失败: ${response.statusText}`);
        }
        
        const resJson = await response.json();
        console.log(`[SYNC HELPER] 数据已成功同步保存至服务器后端:`, resJson);
      } catch (err) {
        console.error("[SYNC HELPER] 数据同步保存至后端失败:", err);
      }
    }, 500);
  }
}
