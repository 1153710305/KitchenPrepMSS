/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 本地 SQLite（阶段一浅迁移，见 SQLite迁移规划.md）与腾讯云对象存储（COS）双模式持久化服务：负责主数据的整体读写、
 * 台账逐日流水的存储与重组、历史快照备份与恢复，以及从旧版纯 JSON 文件存储的一次性自动迁移。
 */

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import COS from "cos-nodejs-sdk-v5";

/** 整体状态里除 ledgerItems 之外、直接以 JSON 文本整体存入 kv_store 的顶层字段 */
const SKELETON_KV_KEYS = ["reports", "activeGroups", "activeCategories", "ledgers", "rawMaterialsDict", "ledgerHelperDict"] as const;

/**
 * @description 后端持久化数据同步引擎，支持本地 SQLite 与腾讯云 COS 对象存储双模式切换
 */
export class StorageService {
  /**
   * @description 存储类型：local（本地 SQLite） 或 cos（腾讯云对象存储）
   */
  private static storageType: string = process.env.STORAGE_TYPE || "local";

  /**
   * @description 旧版纯 JSON 存储的主文件路径，默认为项目根目录下 data/db.json。
   * 阶段一迁移后不再作为常态读写目标，仅在首次启动时用作"是否需要从旧版数据自动迁移"的判断依据与迁移源。
   */
  private static localDbPath: string = path.resolve(process.env.LOCAL_DB_PATH || "data/db.json");

  /**
   * @description 本地 SQLite 数据库文件路径，与旧版 db.json 同目录
   */
  private static sqliteDbPath: string = path.join(path.dirname(StorageService.localDbPath), "kpmss.sqlite");

  /**
   * @description 本地历史备份存储目录（备份快照仍然是人类可读的 JSON 文件，命名与保留策略均不变）
   */
  private static backupDir: string = path.resolve(path.dirname(StorageService.localDbPath), "backups");

  /**
   * @description 本地 SQLite 数据库连接（懒加载，全生命周期内复用同一个连接）
   */
  private static db: Database.Database | null = null;

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
   * 仍用于备份快照 JSON 文件的落盘——正式数据本身的原子性已经由下方 SQLite 事务保证，不再需要这个手段。
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
   * @description 获取（并按需懒创建）本地 SQLite 数据库连接与表结构。
   * kv_store 以 key-value 形式整体存放 6 个骨架字段（外加 ledgerItems 本身剥离每日流水后的骨架数组）；
   * daily_records 按 (item_id, date) 存放每一条台账每日出入库流水，取代旧版按年/月/日拆分的 JSON 文件，
   * 天然支持按 item_id/date 索引查询，也天然修复了旧版"某天最后一条记录被删除后，对应日文件永远不会被清理，
   * 下次加载时又被错误复活"的历史遗留问题（因为新版每次保存都会整体重建 daily_records，不存在孤儿文件）。
   * @returns {Database.Database} SQLite 数据库连接
   */
  private static getDb(): Database.Database {
    if (!StorageService.db) {
      StorageService.db = new Database(StorageService.sqliteDbPath);
      // WAL 模式：写入不阻塞并发读取，且每次事务提交都由 SQLite 引擎保证落盘的原子性与崩溃恢复能力
      StorageService.db.pragma("journal_mode = WAL");
      StorageService.db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_records (
          item_id TEXT NOT NULL,
          date TEXT NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (item_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(date);
      `);
    }
    return StorageService.db;
  }

  /**
   * @description 把"骨架"字段（ledgerItems 剥离每日流水后的数组，以及其余 6 个整体字段）整体覆盖写入 kv_store。
   * 不涉及 daily_records，供 saveInternal（正常保存）与 restoreInternal（从备份恢复）共用。
   * @param {Database.Database} db SQLite 数据库连接
   * @param {any} data 需要写入的全量数据包
   * @returns {void}
   */
  private static upsertSkeletonKv(db: Database.Database, data: any): void {
    const upsertKv = db.prepare(
      "INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const ledgerItemsSkeleton = Array.isArray(data.ledgerItems)
      ? data.ledgerItems.map((item: any) => {
          const { dailyRecords, ...rest } = item || {};
          return rest;
        })
      : [];
    upsertKv.run("ledgerItems", JSON.stringify(ledgerItemsSkeleton));
    for (const key of SKELETON_KV_KEYS) {
      upsertKv.run(key, JSON.stringify(data[key] ?? []));
    }
  }

  /**
   * @description 正常保存路径：骨架字段整体覆盖 + daily_records 整体重建（先清空再按当前 payload 完整重插入），
   * 全部包裹在同一个 SQLite 事务里——要么全部生效，要么全部不生效，比"临时文件+rename"更强的原子性保证。
   * @param {any} data 需要保存的全量数据包（ledgerItems[].dailyRecords 为完整的当前每日流水）
   * @returns {void}
   */
  private static importFullDataIntoSqlite(data: any): void {
    const db = StorageService.getDb();
    const insertDaily = db.prepare("INSERT INTO daily_records (item_id, date, data) VALUES (?, ?, ?)");
    const deleteAllDaily = db.prepare("DELETE FROM daily_records");

    const run = db.transaction((payload: any) => {
      StorageService.upsertSkeletonKv(db, payload);
      deleteAllDaily.run();
      if (Array.isArray(payload.ledgerItems)) {
        for (const item of payload.ledgerItems) {
          if (item && item.dailyRecords) {
            for (const [dateStr, record] of Object.entries(item.dailyRecords)) {
              if (!dateStr || !record) continue;
              insertDaily.run(item.id, dateStr, JSON.stringify(record));
            }
          }
        }
      }
    });
    run(data);
  }

  /**
   * @description 从备份恢复专用：只覆盖骨架字段，绝不触碰 daily_records。备份快照本身从不包含每日流水
   * （与旧版实现的既有限制保持一致：旧版 restore() 只覆盖 db.json 骨架文件，从不touch ledgers/daily/** 目录），
   * 若在这里也整体重建 daily_records，会把当前生效中的真实每日购销记录清空，属于比旧版更严重的数据丢失回归。
   * @param {any} data 备份快照解析出的数据（ledgerItems[].dailyRecords 恒为空对象）
   * @returns {void}
   */
  private static importSkeletonOnlyIntoSqlite(data: any): void {
    const db = StorageService.getDb();
    const run = db.transaction((payload: any) => {
      StorageService.upsertSkeletonKv(db, payload);
    });
    run(data);
  }

  /**
   * @description 从 SQLite 读出完整的应用状态对象，形状与旧版 JSON 文件方案的 load() 返回值完全一致
   * （含把 daily_records 重新拼装回每个 ledgerItem 的 dailyRecords 字典）。kv_store 完全为空时返回 {}，
   * 与旧版"文件不存在则返回空对象"的首次启动语义保持一致。
   * @returns {any} 完整的应用状态对象
   */
  private static readDataFromSqlite(): any {
    const db = StorageService.getDb();
    const kvRows = db.prepare("SELECT key, value FROM kv_store").all() as Array<{ key: string; value: string }>;
    if (kvRows.length === 0) {
      return {};
    }

    const data: any = {};
    for (const row of kvRows) {
      try {
        data[row.key] = JSON.parse(row.value);
      } catch (e) {
        console.error(`[STORAGE SQLITE] 解析 kv_store 字段 ${row.key} 失败:`, e);
      }
    }

    const mergedDaily: Record<string, Record<string, any>> = {};
    const dailyRows = db.prepare("SELECT item_id, date, data FROM daily_records").all() as Array<{ item_id: string; date: string; data: string }>;
    for (const row of dailyRows) {
      try {
        if (!mergedDaily[row.item_id]) mergedDaily[row.item_id] = {};
        mergedDaily[row.item_id][row.date] = JSON.parse(row.data);
      } catch (e) {
        console.error(`[STORAGE SQLITE] 解析每日流水记录失败 (item=${row.item_id}, date=${row.date}):`, e);
      }
    }

    if (Array.isArray(data.ledgerItems)) {
      for (const item of data.ledgerItems) {
        item.dailyRecords = mergedDaily[item.id] || {};
      }
    }

    return data;
  }

  /**
   * @description 递归扫描并读取本地 ledgers/daily 目录下按年、月、天分散保存的旧版 JSON 流水文件，并合并到内存结构中。
   * 阶段一迁移后仅供 migrateLegacyJsonIfNeeded() 一次性导入历史数据时调用，不再是常态读取路径。
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
   * @description 一次性历史数据迁移：若 SQLite 里还没有任何数据、但磁盘上存在旧版 JSON 骨架文件（db.json），
   * 说明这是从旧的纯文件存储升级上来的部署，自动把旧数据（含按年/月/日拆分的每日流水）导入新的 SQLite 存储。
   * 迁移完成后不会删除原始 JSON/逐日流水文件，保留作为人工回退的最后手段。仅在 SQLite 完全没有数据时才会触发，
   * 避免每次重启都重复导入、用旧的 JSON 快照覆盖掉已经在 SQLite 里产生的新数据。
   * @returns {void}
   */
  private static migrateLegacyJsonIfNeeded(): void {
    const db = StorageService.getDb();
    const existingCount = (db.prepare("SELECT COUNT(*) as count FROM kv_store").get() as { count: number }).count;
    if (existingCount > 0) {
      return;
    }
    if (!fs.existsSync(StorageService.localDbPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(StorageService.localDbPath, "utf8");
      const legacyData = JSON.parse(content);

      const dailyDir = path.join(path.dirname(StorageService.localDbPath), "ledgers", "daily");
      const mergedDaily: Record<string, Record<string, any>> = {};
      StorageService.readAllDailyRecordsLocal(dailyDir, mergedDaily);
      if (Array.isArray(legacyData.ledgerItems)) {
        for (const item of legacyData.ledgerItems) {
          item.dailyRecords = mergedDaily[item.id] || {};
        }
      }

      StorageService.importFullDataIntoSqlite(legacyData);
      console.log(`[STORAGE SQLITE] 已自动将历史 JSON 数据（${StorageService.localDbPath}）迁移至 SQLite，原始文件予以保留。`);
    } catch (err) {
      console.error("[STORAGE SQLITE] 历史 JSON 数据迁移失败，将以空数据集启动：", err);
    }
  }

  /**
   * @description 初始化存储引擎，创建必要的本地目录、打开 SQLite 连接，并按需自动迁移旧版历史数据
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
      StorageService.migrateLegacyJsonIfNeeded();
    } else {
      console.log("[STORAGE] 启动云端存储模式：已挂载腾讯云 COS 同步总线。");
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
      try {
        return StorageService.readDataFromSqlite();
      } catch (err) {
        console.error("[STORAGE SQLITE] 读取本地数据失败:", err);
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
    // 整个保存流程（含云端双写、本地 SQLite 事务+备份快照）都在写锁内串行执行，防止并发触发的多次 save() 交叉写入
    return StorageService.withWriteLock(() => StorageService.saveInternal(data));
  }

  /**
   * @description save() 的实际执行体，被写锁包裹调用，禁止在锁外单独调用
   * @param {any} data 需要保存的全量数据包
   * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
   */
  private static async saveInternal(data: any): Promise<boolean> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (StorageService.storageType === "cos") {
      const dataStr = JSON.stringify(data, null, 2);
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
      // 本地存储模式：整体状态经由 SQLite 事务原子写入（要么全部生效、要么全部不生效），
      // 随后额外生成一份人类可读的 JSON 快照文件用于留档与手动核查（沿用既有的 30 份滚动保留策略与命名格式）
      try {
        StorageService.importFullDataIntoSqlite(data);
        console.log("[STORAGE SQLITE] 结构与配置数据、逐日流水已通过事务写入本地 SQLite 数据库。");

        const cleanedData = JSON.parse(JSON.stringify(data));
        if (cleanedData.ledgerItems && Array.isArray(cleanedData.ledgerItems)) {
          for (const item of cleanedData.ledgerItems) {
            item.dailyRecords = {};
          }
        }
        const cleanedDataStr = JSON.stringify(cleanedData, null, 2);

        const snapshotPath = path.join(StorageService.backupDir, `db_${timestamp}.json`);
        StorageService.atomicWriteFileSync(snapshotPath, cleanedDataStr);
        console.log(`[STORAGE LOCAL] 成功生成本地配置备份快照: ${snapshotPath}`);

        StorageService.trimLocalBackups();
        return true;
      } catch (err) {
        console.error("[STORAGE SQLITE] 写入本地数据失败:", err);
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
      // 本地存储模式（备份快照仍是普通 JSON 文件，与阶段一迁移前完全一致）
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

    // 恢复会覆盖主数据，与 save() 写的是同一份 SQLite 数据库，因此也必须纳入同一把写锁，
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
      // 本地存储模式：备份快照仍是纯 JSON 文件，且从不包含每日流水（与阶段一迁移前的既有限制保持一致）。
      // 恢复时只把快照里的骨架字段重新导入 SQLite，绝不清空/覆盖当前生效中的 daily_records
      const targetPath = path.join(StorageService.backupDir, backupName);
      if (!fs.existsSync(targetPath)) {
        return null;
      }
      try {
        const content = fs.readFileSync(targetPath, "utf8");
        const parsed = JSON.parse(content);
        StorageService.importSkeletonOnlyIntoSqlite(parsed);
        console.log(`[STORAGE SQLITE] 成功从本地快照 ${backupName} 覆盖恢复骨架数据`);
        return StorageService.readDataFromSqlite();
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
