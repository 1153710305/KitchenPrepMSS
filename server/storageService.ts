/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 本地文件与腾讯云对象存储（COS）双模式持久化服务：负责主数据文件读写、台账逐日流水拆分存储、以及历史快照备份与恢复。
 */

import path from "path";
import fs from "fs";
import COS from "cos-nodejs-sdk-v5";

/**
 * @description 后端持久化数据同步引擎，支持本地 JSON 文件与腾讯云 COS 对象存储双模式切换
 */
export class StorageService {
  /**
   * @description 存储类型：local（本地文件） 或 cos（腾讯云对象存储）
   */
  private static storageType: string = process.env.STORAGE_TYPE || "local";

  /**
   * @description 本地文件存储路径，默认为项目根目录下 data/db.json
   */
  private static localDbPath: string = path.resolve(process.env.LOCAL_DB_PATH || "data/db.json");

  /**
   * @description 本地历史备份存储目录
   */
  private static backupDir: string = path.resolve(path.dirname(StorageService.localDbPath), "backups");

  /**
   * @description 腾讯云 COS 客户端实例
   */
  private static cosClient: COS | null = null;

  /**
   * @description 获取腾讯云 COS 客户端实例（延迟初始化）
   * @returns {COS} COS 客户端实例
   */
  private static getCosClient(): COS {
    if (!StorageService.cosClient) {
      StorageService.cosClient = new COS({
        SecretId: process.env.COS_SECRET_ID || "",
        SecretKey: process.env.COS_SECRET_KEY || "",
      });
    }
    return StorageService.cosClient;
  }

  /**
   * @description 获取 COS 配置参数
   * @returns {Object} 包含 Bucket, Region, Key 等配置
   */
  private static getCosConfig() {
    return {
      Bucket: process.env.COS_BUCKET || "",
      Region: process.env.COS_REGION || "",
      Key: process.env.COS_KEY || "kitchen_db.json"
    };
  }

  /**
   * @description 串行化所有写操作的互斥锁（Promise 链式实现）：save()/restore() 无论被并发触发多少次，
   * 都会被严格排队、逐一执行，前一个操作完成（无论成功或失败）后才轮到下一个开始。
   * 当前所有本地写入都用的是同步 fs 调用，Node 单线程事件循环本身就不会在一次同步执行中途被抢占，
   * 天然不会发生"两次写入交叉执行"；但这个隐含前提并不明显、也容易在未来改动中被破坏（比如为了不阻塞
   * 事件循环而改用异步 fs.promises 写入后，交叉执行的风险就会重新出现）。显式加锁把"同一时刻只有一个
   * 写操作在跑"这件事变成一个不依赖实现细节、任何人都能看懂的硬性保证。
   */
  private static writeLock: Promise<void> = Promise.resolve();

  /**
   * @description 把一个异步任务放入写锁队列：等前面所有排队中的任务完成后再执行当前任务，并在完成后释放锁供下一个任务使用
   * @param {() => Promise<T> | T} task 需要互斥执行的任务
   * @returns {Promise<T>} 任务的执行结果
   */
  private static async withWriteLock<T>(task: () => Promise<T> | T): Promise<T> {
    const previous = StorageService.writeLock;
    let release!: () => void;
    StorageService.writeLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  /**
   * @description 原子写入本地文件：先写入同目录下的一个唯一临时文件，写入成功后再用 rename 替换目标文件。
   * rename 在同一文件系统内是操作系统保证的原子操作（要么完全生效、要么完全不生效），不会出现"写了一半"
   * 的中间状态；相比直接 fs.writeFileSync(targetPath, ...)，避免了进程崩溃/断电恰好发生在写入目标文件
   * 过程中，导致该文件被截断成一份损坏、无法解析的 JSON。
   * @param {string} targetPath 最终要写入的目标文件路径
   * @param {string} content 要写入的文件内容
   * @returns {void}
   */
  private static atomicWriteFileSync(targetPath: string, content: string): void {
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, targetPath);
  }

  /**
   * @description 初始化存储引擎，创建必要的本地目录
   * @returns {void}
   */
  public static init(): void {
    if (StorageService.storageType === "local") {
      const dir = path.dirname(StorageService.localDbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[STORAGE] 已成功创建本地数据存储目录: ${dir}`);
      }
      if (!fs.existsSync(StorageService.backupDir)) {
        fs.mkdirSync(StorageService.backupDir, { recursive: true });
        console.log(`[STORAGE] 已成功创建本地备份快照目录: ${StorageService.backupDir}`);
      }
    } else {
      console.log("[STORAGE] 启动云端存储模式：已挂载腾讯云 COS 同步总线。");
    }
  }

  /**
   * @description 递归扫描并读取本地 ledgers/daily 目录下按年、月、天分散保存的 JSON 流水文件，并合并到内存结构中
   * @param {string} dailyDir 日度数据根目录路径
   * @param {Record<string, Record<string, any>>} mergedDaily 用于在内存中重组的合并流水数据字典 (格式: { itemId: { YYYY-MM-DD: DailyStockRecord } })
   */
  private static readAllDailyRecordsLocal(dailyDir: string, mergedDaily: Record<string, Record<string, any>>): void {
    if (!fs.existsSync(dailyDir)) return;
    try {
      const years = fs.readdirSync(dailyDir);
      for (const year of years) {
        const yearPath = path.join(dailyDir, year);
        if (!fs.statSync(yearPath).isDirectory()) continue;
        const months = fs.readdirSync(yearPath);
        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          if (!fs.statSync(monthPath).isDirectory()) continue;
          const days = fs.readdirSync(monthPath);
          for (const day of days) {
            const dayPath = path.join(monthPath, day);
            if (!fs.statSync(dayPath).isFile() || !day.endsWith(".json")) continue;
            try {
              const dateStr = `${year}-${month}-${day.replace(".json", "")}`;
              const fileContent = fs.readFileSync(dayPath, "utf8");
              const dayRecords = JSON.parse(fileContent);

              // dayRecords 格式为 { itemId: DailyStockRecord }
              for (const [itemId, record] of Object.entries(dayRecords)) {
                if (!mergedDaily[itemId]) {
                  mergedDaily[itemId] = {};
                }
                mergedDaily[itemId][dateStr] = record as any;
              }
            } catch (e) {
              console.error(`[STORAGE] 解析日度账单文件失败 ${dayPath}:`, e);
            }
          }
        }
      }
    } catch (e) {
      console.error("[STORAGE] 读取日度分散台账目录失败:", e);
    }
  }

  /**
   * @description 将全量台账项目中的每日流水提取出来，按照年、月、天分散持久化到不同的文件夹中保存
   * @param {string} dailyDir 日度数据根目录路径
   * @param {any[]} ledgerItems 内存中的全量台账原料项列表
   */
  private static writeDailyRecordsLocal(dailyDir: string, ledgerItems: any[]): void {
    if (!ledgerItems || !Array.isArray(ledgerItems)) return;
    try {
      // 1. 将全量数据按日期进行逆向分组整理
      // dateMap 格式: { YYYY-MM-DD: { itemId: DailyStockRecord } }
      const dateMap: Record<string, Record<string, any>> = {};
      for (const item of ledgerItems) {
        if (item.dailyRecords) {
          for (const [dateStr, record] of Object.entries(item.dailyRecords)) {
            if (!dateStr || !record) continue;
            if (!dateMap[dateStr]) {
              dateMap[dateStr] = {};
            }
            dateMap[dateStr][item.id] = record;
          }
        }
      }

      // 2. 将数据按年月日写到相应的独立 json 文件中，限制单个文件过大
      for (const [dateStr, dayRecords] of Object.entries(dateMap)) {
        const parts = dateStr.split("-");
        if (parts.length !== 3) continue;
        const [year, month, day] = parts;

        const targetDir = path.join(dailyDir, year, month);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const targetPath = path.join(targetDir, `${day}.json`);
        StorageService.atomicWriteFileSync(targetPath, JSON.stringify(dayRecords, null, 2));
      }
    } catch (e) {
      console.error("[STORAGE] 写入日度分散台账文件失败:", e);
    }
  }

  /**
   * @description 加载主数据库内容
   * @returns {Promise<any>} 返回 JSON 数据对象
   */
  public static async load(): Promise<any> {
    if (StorageService.storageType === "cos") {
      const { Bucket, Region, Key } = StorageService.getCosConfig();
      return new Promise((resolve) => {
        StorageService.getCosClient().getObject({
          Bucket,
          Region,
          Key
        }, (err, data) => {
          if (err) {
            // 如果文件不存在 (404 / NoSuchKey)，则返回空对象，供前端自行初始化默认值
            if (err.statusCode === 404 || err.code === "NoSuchKey") {
              console.log("[STORAGE COS] COS上暂无数据文件，将返回空初始集。");
              resolve({});
            } else {
              console.error("[STORAGE COS] 从腾讯云拉取数据失败:", err);
              resolve({});
            }
          } else {
            try {
              const bodyStr = data.Body.toString("utf8");
              resolve(JSON.parse(bodyStr));
            } catch (parseErr) {
              console.error("[STORAGE COS] 解析云端JSON失败:", parseErr);
              resolve({});
            }
          }
        });
      });
    } else {
      // 本地存储模式
      if (!fs.existsSync(StorageService.localDbPath)) {
        return {};
      }
      try {
        const content = fs.readFileSync(StorageService.localDbPath, "utf8");
        const data = JSON.parse(content);

        // 加载按年月日分散在各子文件夹中的日度账单流水
        const dailyDir = path.join(path.dirname(StorageService.localDbPath), "ledgers", "daily");
        const mergedDaily: Record<string, Record<string, any>> = {};
        StorageService.readAllDailyRecordsLocal(dailyDir, mergedDaily);

        // 重新拼装回 ledgerItems 对应的 dailyRecords 字典中
        if (data.ledgerItems && Array.isArray(data.ledgerItems)) {
          for (const item of data.ledgerItems) {
            item.dailyRecords = mergedDaily[item.id] || {};
          }
        }

        return data;
      } catch (err) {
        console.error("[STORAGE LOCAL] 读取本地数据失败:", err);
        return {};
      }
    }
  }

  /**
   * @description 保存数据到引擎，并自动生成备份快照
   * @param {any} data 需要保存的全量数据包
   * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
   */
  public static async save(data: any): Promise<boolean> {
    // 整个保存流程（含云端双写、本地三步落盘）都在写锁内串行执行，防止并发触发的多次 save() 交叉写入
    return StorageService.withWriteLock(() => StorageService.saveInternal(data));
  }

  /**
   * @description save() 的实际执行体，被写锁包裹调用，禁止在锁外单独调用
   * @param {any} data 需要保存的全量数据包
   * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
   */
  private static async saveInternal(data: any): Promise<boolean> {
    const dataStr = JSON.stringify(data, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (StorageService.storageType === "cos") {
      const { Bucket, Region, Key } = StorageService.getCosConfig();
      // 1. 保存主数据
      const saveMain = new Promise<boolean>((resolve) => {
        StorageService.getCosClient().putObject({
          Bucket,
          Region,
          Key,
          Body: Buffer.from(dataStr, "utf8")
        }, (err) => {
          if (err) {
            console.error("[STORAGE COS] 保存主数据至云端失败:", err);
            resolve(false);
          } else {
            console.log("[STORAGE COS] 主数据已成功落盘至腾讯云 COS");
            resolve(true);
          }
        });
      });

      // 2. 保存快照备份，以便发生意外时恢复（写锁已保证同一时刻只有一组 save() 在跑，这里改为等待上传结果，
      // 避免"不阻塞主线程"的旧写法让备份上传实际上跑到下一次 save() 的写锁区间之外，脱离串行化保护）
      const backupKey = `backups/db_${timestamp}.json`;
      await new Promise<void>((resolve) => {
        StorageService.getCosClient().putObject({
          Bucket,
          Region,
          Key: backupKey,
          Body: Buffer.from(dataStr, "utf8")
        }, (err) => {
          if (err) {
            console.error(`[STORAGE COS] 备份快照 ${backupKey} 上传失败:`, err);
          } else {
            console.log(`[STORAGE COS] 成功生成云端备份快照: ${backupKey}`);
          }
          resolve();
        });
      });

      return saveMain;
    } else {
      // 本地存储模式
      try {
        const dailyDir = path.join(path.dirname(StorageService.localDbPath), "ledgers", "daily");

        // 1. 先将庞大的每日出入库流水提取整理，以 YYYY/MM/DD.json 分散文件物理落盘（内部已改为原子写入）
        StorageService.writeDailyRecordsLocal(dailyDir, data.ledgerItems);

        // 2. 深度克隆并清理内存快照中的 dailyRecords，避免主 db.json 及系统快照包体积无限膨胀
        const cleanedData = JSON.parse(JSON.stringify(data));
        if (cleanedData.ledgerItems && Array.isArray(cleanedData.ledgerItems)) {
          for (const item of cleanedData.ledgerItems) {
            item.dailyRecords = {};
          }
        }
        const cleanedDataStr = JSON.stringify(cleanedData, null, 2);

        // 3. 保存去除了每日流水的主配置骨架文件（原子写入：先写临时文件再 rename，避免崩溃/断电写出半份损坏文件）
        StorageService.atomicWriteFileSync(StorageService.localDbPath, cleanedDataStr);
        console.log(`[STORAGE LOCAL] 结构与配置数据已写入主文件: ${StorageService.localDbPath}`);

        // 4. 写入去除了每日流水的时间戳快照备份文件（同样原子写入）
        const snapshotPath = path.join(StorageService.backupDir, `db_${timestamp}.json`);
        StorageService.atomicWriteFileSync(snapshotPath, cleanedDataStr);
        console.log(`[STORAGE LOCAL] 成功生成本地配置备份快照: ${snapshotPath}`);

        // 5. 限制本地历史备份文件总数（最多保留30个版本）
        StorageService.trimLocalBackups();
        return true;
      } catch (err) {
        console.error("[STORAGE LOCAL] 写入本地数据失败:", err);
        return false;
      }
    }
  }

  /**
   * @description 获取备份列表
   * @returns {Promise<string[]>} 快照名称列表
   */
  public static async getBackups(): Promise<string[]> {
    if (StorageService.storageType === "cos") {
      const { Bucket, Region } = StorageService.getCosConfig();
      return new Promise((resolve) => {
        StorageService.getCosClient().getBucket({
          Bucket,
          Region,
          Prefix: "backups/"
        }, (err, data) => {
          if (err) {
            console.error("[STORAGE COS] 列出云端快照失败:", err);
            resolve([]);
          } else {
            const files = (data.Contents || [])
              .map((item) => item.Key)
              .filter((key) => key && key.endsWith(".json"))
              .sort()
              .reverse(); // 从新到旧
            resolve(files);
          }
        });
      });
    } else {
      // 本地存储模式
      try {
        if (!fs.existsSync(StorageService.backupDir)) {
          return [];
        }
        const files = fs.readdirSync(StorageService.backupDir)
          .filter((file) => file.startsWith("db_") && file.endsWith(".json"))
          .sort()
          .reverse(); // 从新到旧
        return files;
      } catch (err) {
        console.error("[STORAGE LOCAL] 读取本地快照列表失败:", err);
        return [];
      }
    }
  }

  /**
   * @description 从指定备份文件恢复数据
   * @param {string} backupName 快照名称
   * @returns {Promise<any>} 恢复后的 JSON 数据对象
   */
  public static async restore(backupName: string): Promise<any> {
    // 安全校验：仅允许形如 db_<时间戳>.json 的合法备份文件名，拒绝任何包含路径分隔符/上级目录穿越序列的输入，
    // 避免恶意构造的 backupName（如 "../../.env"）导致读取或覆盖备份目录之外的任意文件。
    // 校验本身是纯读取判断、不涉及写入，放在写锁之外执行，不占用锁资源
    if (!/^db_[\w-]+\.json$/.test(backupName)) {
      console.error(`[STORAGE] 非法的备份文件名，已拒绝恢复请求: ${backupName}`);
      return null;
    }

    // 恢复会覆盖主数据库文件，与 save() 写的是同一份文件，因此也必须纳入同一把写锁，
    // 避免"恢复覆盖"与"正常保存"两个不同调用点的写入互相交叉
    return StorageService.withWriteLock(() => StorageService.restoreInternal(backupName));
  }

  /**
   * @description restore() 的实际执行体，被写锁包裹调用，禁止在锁外单独调用
   * @param {string} backupName 已通过安全校验的合法备份文件名
   * @returns {Promise<any>} 恢复后的 JSON 数据对象
   */
  private static async restoreInternal(backupName: string): Promise<any> {
    if (StorageService.storageType === "cos") {
      const { Bucket, Region } = StorageService.getCosConfig();
      return new Promise((resolve) => {
        StorageService.getCosClient().getObject({
          Bucket,
          Region,
          Key: backupName
        }, (err, data) => {
          if (err) {
            console.error(`[STORAGE COS] 从云端快照 ${backupName} 读取数据失败:`, err);
            resolve(null);
          } else {
            try {
              const bodyStr = data.Body.toString("utf8");
              resolve(JSON.parse(bodyStr));
            } catch (parseErr) {
              console.error("[STORAGE COS] 解析备份JSON失败:", parseErr);
              resolve(null);
            }
          }
        });
      });
    } else {
      // 本地存储模式
      const targetPath = path.join(StorageService.backupDir, backupName);
      if (!fs.existsSync(targetPath)) {
        return null;
      }
      try {
        const content = fs.readFileSync(targetPath, "utf8");
        const parsed = JSON.parse(content);
        // 将恢复的数据写回主库文件（原子写入）
        StorageService.atomicWriteFileSync(StorageService.localDbPath, content);
        console.log(`[STORAGE LOCAL] 成功从本地快照 ${backupName} 覆盖恢复主数据库`);
        return parsed;
      } catch (err) {
        console.error("[STORAGE LOCAL] 本地快照恢复失败:", err);
        return null;
      }
    }
  }

  /**
   * @description 裁剪本地历史备份文件数，防止过度占用硬盘空间
   * @returns {void}
   */
  private static trimLocalBackups(): void {
    try {
      const files = fs.readdirSync(StorageService.backupDir)
        .filter((file) => file.startsWith("db_") && file.endsWith(".json"))
        .sort(); // 升序排列（旧文件在前面）

      const maxBackups = 30;
      if (files.length > maxBackups) {
        const filesToDelete = files.slice(0, files.length - maxBackups);
        filesToDelete.forEach((file) => {
          const deletePath = path.join(StorageService.backupDir, file);
          fs.unlinkSync(deletePath);
          console.log(`[STORAGE LOCAL] 已自动清理历史超期本地备份: ${file}`);
        });
      }
    } catch (err) {
      console.error("[STORAGE LOCAL] 清理超期备份失败:", err);
    }
  }
}

// 初始化存储目录
StorageService.init();
