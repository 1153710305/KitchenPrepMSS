/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 客户端与后端持久化层之间的同步协调器（SyncHelper）：阶段三·增量写协议——收集调用方显式描述的
 * "这次到底变了什么"（SyncOp），去抖动 200ms 合并批量提交给服务端，并在系统初始化完成前加锁防止空状态覆写云端数据。
 * 取代此前"每次都整体拉取全部内存状态、整体 POST"的旧协议（BackendData/memoryFetcher/triggerSyncToServer）。
 */

/**
 * @description 后端读取接口 GET /api/storage/load 返回的完整状态数据结构（读路径不受本次改造影响，仍是整体状态）
 */
export interface BackendData {
  reports?: any[];
  activeGroups?: any[];
  activeCategories?: any[];
  ledgers?: any[];
  ledgerItems?: any[];
  rawMaterialsDict?: any[];
  ledgerHelperDict?: Record<string, string[]>;
}

/** 阶段三·增量写协议：可增量写入的实体类型，需与 server/storageService.ts 的 SyncOpEntity 保持一致 */
export type SyncOpEntity =
  | "ledger" | "ledgerItem" | "ledgerItemDailyRecord" | "report" | "preparedItem"
  | "preparedItemDailyData" | "activeGroup" | "activeCategory" | "rawMaterial" | "ledgerHelperOptions";

/**
 * @description 单个增量同步操作，由每个具体的 mutation 方法在完成内存状态变更后显式构造并调用 queueChange() 提交。
 * key 的形状按 entity 而定：大多数实体是主键字符串，ledgerItemDailyRecord/preparedItemDailyData 是
 * { itemId, date } 复合键，report 是 { targetGroup, year, month } 复合键。previousKey 仅供主键本身可被改名的
 * 实体（目前只有 rawMaterial.name）在改名时携带旧主键，供后端清理旧行。
 * op: "replaceAll" 仅供首次启动/批量种子数据生成场景使用。
 */
export interface SyncOp {
  entity: SyncOpEntity;
  op: "upsert" | "delete" | "replace" | "replaceAll";
  key?: any;
  data?: any;
  previousKey?: any;
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
   * @description 待提交的增量操作批次，key 为 `entity:JSON(key)`，同一 debounce 窗口内对同一实体+主键的重复写入
   * 自然合并为最后一次（解决"同一单元格连续两次失焦保存"发送冗余/过期请求的问题）
   */
  private static pendingOps: Map<string, SyncOp> = new Map();

  /**
   * @description 防抖同步定时器句柄，用于取消上一次尚未触发的延迟保存
   */
  private static debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @description 最近一次发生真实本地数据变更（如录入保存）的时间戳，用于心跳静默同步识别并丢弃与之竞态的过期响应
   */
  private static lastLocalMutationAt: number = 0;

  /**
   * @description flush() 失败后的连续重试计数，超过上限即放弃并打印明显日志，避免无限重试
   */
  private static retryCount = 0;

  /** @description 连续重试的次数上限 */
  private static readonly MAX_RETRY = 3;

  /**
   * @description 是否有一批增量操作正在向后端发起提交请求、尚未收到响应（区别于 pendingOps：
   * pendingOps 是"还没到 200ms 防抖时间"，isFlushing 是"已经在路上、等服务器确认"）
   */
  private static isFlushing = false;

  /**
   * @description 获取最近一次真实本地数据变更的时间戳
   */
  public static getLastLocalMutationAt(): number {
    return this.lastLocalMutationAt;
  }

  /**
   * @description 是否存在尚未被服务器确认落盘的本地变更（排队等待防抖、或已发出请求等待响应）。
   * 供心跳静默同步识别"这次本地变更是否已经真正写入后端"，避免用一份滞后于本地最新变更的服务器快照
   * 覆盖内存，导致刚保存的数据在界面上短暂"消失"后要等下一轮心跳才重新出现。
   */
  public static hasPendingSync(): boolean {
    return this.pendingOps.size > 0 || this.debounceTimer !== null || this.isFlushing;
  }

  /**
   * @description 等待当前所有排队中与正在提交的增量操作全部完成（成功或达到重试上限后放弃），
   * 供"保存"类交互在正式呈现"已同步"提示或放行页面浏览前调用，确保用户看到的不是"本地已更新、
   * 服务器尚未确认"的中间态。
   */
  public static waitForPendingSync(): Promise<void> {
    if (!this.hasPendingSync()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const check = () => {
        if (!this.hasPendingSync()) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * @description 从服务器拉取最新的完整数据并返回给调用层（读路径不受本次改造影响，GET /load 仍返回整体状态）
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
   * @description 把一个增量同步操作描述加入待提交批次，去抖动 200 毫秒后统一打包提交给后端。
   * 每个具体的 mutation 方法（如新增一条台账原料、编辑某天的出入库记录）都应在完成内存状态变更后
   * 显式调用此方法描述"这次到底变了什么"，而不是像旧协议那样整体重新拉取全部内存状态。
   * @param {SyncOp} op 本次变更的增量操作描述
   * @returns {void}
   */
  public static queueChange(op: SyncOp): void {
    if (!this.isInitialized) {
      console.warn("[SYNC HELPER] 系统尚未初始化完成，拦截空内存数据同步云端，保护云端数据安全");
      return;
    }

    // 记录本次真实本地数据变更发生的时间，供心跳静默同步识别并丢弃与之竞态的过期响应
    this.lastLocalMutationAt = Date.now();

    const dedupeKey = `${op.entity}:${JSON.stringify(op.key ?? null)}`;
    this.pendingOps.set(dedupeKey, op);
    this.scheduleFlush();
  }

  /**
   * @description 安排（或重新安排）一次防抖 flush：取消上一个尚未触发的计时器，重新计时 200 毫秒
   * @returns {void}
   */
  private static scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, 200);
  }

  /**
   * @description 把当前累积的待提交批次一次性打包 POST 给后端；失败时把这批操作（若未被更新的同 key 操作覆盖）
   * 重新放回队列并安排一次重试，超过重试上限后放弃并打印明显日志（这是增量写协议相比"整体覆盖"引入的新失败模式：
   * 旧协议下一次 POST 失败，下一次任意 mutation 触发的全量快照能顺带把丢失的写入捎带回来；
   * 增量协议下每个 op 出队后如果不重试就真的丢了）
   * @returns {Promise<void>}
   */
  private static async flush(): Promise<void> {
    if (this.pendingOps.size === 0) {
      return;
    }
    const batch = Array.from(this.pendingOps.entries());
    this.pendingOps.clear();
    const ops = batch.map(([, op]) => op);

    this.isFlushing = true;
    try {
      const response = await fetch("/api/storage/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ protocolVersion: 2, ops })
      });

      if (!response.ok) {
        throw new Error(`服务器保存失败: ${response.statusText}`);
      }

      const resJson = await response.json();
      this.retryCount = 0;
      console.log(`[SYNC HELPER] ${ops.length} 个增量同步操作已成功提交至服务器后端:`, resJson);
    } catch (err) {
      console.error("[SYNC HELPER] 增量同步操作提交至后端失败:", err);
      this.retryFailedBatch(batch);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * @description flush() 失败后的重试处理：把这批操作放回待提交队列（若某个 key 期间已经有更新的操作覆盖了它，
   * 则不用失败的旧数据覆盖回去），重新安排一次 flush；超过连续重试上限后放弃
   * @param {Array<[string, SyncOp]>} batch 本次失败的操作批次（含去重 key）
   * @returns {void}
   */
  private static retryFailedBatch(batch: Array<[string, SyncOp]>): void {
    if (this.retryCount >= this.MAX_RETRY) {
      console.error(
        `[SYNC HELPER] 已连续重试 ${this.retryCount} 次仍失败，放弃这批 ${batch.length} 个同步操作，` +
        `本地数据可能未能同步至服务器，请检查网络连接与后端服务状态。`
      );
      this.retryCount = 0;
      return;
    }
    this.retryCount += 1;
    for (const [key, op] of batch) {
      if (!this.pendingOps.has(key)) {
        this.pendingOps.set(key, op);
      }
    }
    this.scheduleFlush();
  }
}
