/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 本地 SQLite（阶段二·规范化关系型表结构 + 阶段三·增量写协议，见 SQLite迁移规划.md）与腾讯云对象存储（COS）
 * 双模式持久化服务：save() 现在接收一批增量 SyncOp[]，通过 applyChangesIntoSqlite() 对规范化表做目标 upsert/delete
 * （而非阶段二的整体 DELETE+INSERT 重建）；load() 仍返回完整状态供 GET /load 与心跳轮询使用。另负责历史快照备份与恢复、
 * 以及从更早版本存储格式（阶段一 kv_store / 最早的纯 JSON 文件）的一次性自动迁移——迁移路径复用的 importFullDataIntoSqlite()
 * 仍是"全量重建"语义，专供一次性迁移与 upsertSkeleton 内部共享，不再是正常保存路径。
 */

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import COS from "cos-nodejs-sdk-v5";

/** ledgerHelperDict 的 8 个 string[] 字段名，打平存入 ledger_helper_options 表 */
const HELPER_DICT_CATEGORIES = [
  "suppliers", "buyers", "inspectors", "keepers",
  "outHandlers", "outRecipients", "sensoryOptions", "shelfLifeOptions"
] as const;

/** 判断"当前规范化表结构是否完全为空"时需要检查的表清单 */
const NORMALIZED_TABLES = [
  "ledgers", "ledger_items", "reports", "active_groups",
  "active_categories", "raw_materials_dict", "ledger_helper_options"
] as const;

/** 阶段三·增量写协议：可增量写入的实体类型 */
export type SyncOpEntity =
  | "ledger" | "ledgerItem" | "ledgerItemDailyRecord" | "report" | "preparedItem"
  | "preparedItemDailyData" | "activeGroup" | "activeCategory" | "rawMaterial" | "ledgerHelperOptions";

/**
 * @description 单个增量同步操作。key 的形状按 entity 而定：大多数实体是主键字符串，
 * ledgerItemDailyRecord/preparedItemDailyData 是 { itemId, date } 复合键，report 是 { targetGroup, year, month } 复合键。
 * previousKey 仅供"主键本身可被改名"的实体（目前只有 rawMaterial.name）在改名时携带旧主键用于清理旧行。
 * op: "replaceAll" 仅供首次启动/批量种子数据生成使用，data 为该实体的完整数组（一次性整体替换，不做逐条枚举）。
 */
export interface SyncOp {
  entity: SyncOpEntity;
  op: "upsert" | "delete" | "replace" | "replaceAll";
  key?: any;
  data?: any;
  previousKey?: any;
}

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
   * 现仅用于首次启动时"是否需要从更早版本自动迁移"的判断依据与迁移源，不再是常态读写目标。
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
   * @description 获取（并按需懒创建）本地 SQLite 数据库连接与规范化的关系型表结构。
   * 相比阶段一"7 个字段整体塞进 kv_store 的 JSON 文本"，这里按业务实体拆成了 9 张真正的关系型表
   * （ledgers/ledger_items/ledger_item_daily_records/reports/prepared_items/prepared_item_daily_data/
   * active_groups/active_categories/raw_materials_dict/ledger_helper_options），获得可索引查询、
   * 字段级类型约束等关系型数据库的实质好处；同时阶段一遗留的 kv_store/daily_records 两张旧表不会被删除，
   * 仅在首次启动检测到需要迁移时读取一次，此后不再使用。
   * @returns {Database.Database} SQLite 数据库连接
   */
  private static getDb(): Database.Database {
    if (!StorageService.db) {
      StorageService.db = new Database(StorageService.sqliteDbPath);
      // WAL 模式：写入不阻塞并发读取，且每次事务提交都由 SQLite 引擎保证落盘的原子性与崩溃恢复能力
      StorageService.db.pragma("journal_mode = WAL");
      StorageService.db.exec(`
        -- 阶段一遗留表（不再写入，仅在一次性迁移时可能被读取一次，予以保留不删除）
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

        -- 阶段二规范化表结构
        CREATE TABLE IF NOT EXISTS ledgers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ledger_items (
          id TEXT PRIMARY KEY,
          ledger_id TEXT NOT NULL,
          name TEXT NOT NULL,
          unit TEXT NOT NULL,
          spec TEXT,
          initial_stock REAL NOT NULL DEFAULT 0,
          current_stock REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_items_ledger_id ON ledger_items(ledger_id);

        -- 台账每日出入库流水：按 (item_id, date) 存放，字段级展开而非整块 JSON 文本，
        -- 取代阶段一的 daily_records（同名字段结构不同，故改用新表名，避免与阶段一遗留表冲突）
        CREATE TABLE IF NOT EXISTS ledger_item_daily_records (
          item_id TEXT NOT NULL,
          date TEXT NOT NULL,
          in_quantity REAL NOT NULL DEFAULT 0,
          in_price REAL NOT NULL DEFAULT 0,
          in_amount REAL NOT NULL DEFAULT 0,
          out_quantity REAL NOT NULL DEFAULT 0,
          out_price REAL,
          out_amount REAL,
          note TEXT,
          certification TEXT,
          sensory_property TEXT,
          supplier TEXT,
          purchase_date TEXT,
          buyer TEXT,
          inspector TEXT,
          keeper TEXT,
          produce_date TEXT,
          shelf_life TEXT,
          out_handler TEXT,
          out_recipient TEXT,
          conversion_unit_quantity REAL,
          out_date TEXT,
          PRIMARY KEY (item_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_daily_date ON ledger_item_daily_records(date);

        CREATE TABLE IF NOT EXISTS reports (
          target_group TEXT NOT NULL,
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          PRIMARY KEY (target_group, year, month)
        );

        CREATE TABLE IF NOT EXISTS prepared_items (
          id TEXT PRIMARY KEY,
          report_target_group TEXT NOT NULL,
          report_year INTEGER NOT NULL,
          report_month INTEGER NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          target_group TEXT NOT NULL,
          unit TEXT NOT NULL,
          note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_prepared_items_report ON prepared_items(report_target_group, report_year, report_month);

        CREATE TABLE IF NOT EXISTS prepared_item_daily_data (
          item_id TEXT NOT NULL,
          date TEXT NOT NULL,
          quantity REAL NOT NULL DEFAULT 0,
          price REAL NOT NULL DEFAULT 0,
          amount REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (item_id, date)
        );

        CREATE TABLE IF NOT EXISTS active_groups (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          emoji TEXT,
          is_default INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS active_categories (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS raw_materials_dict (
          name TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          unit TEXT NOT NULL,
          remark TEXT,
          conversion_unit TEXT,
          conversion_ratio REAL,
          is_default INTEGER NOT NULL DEFAULT 0
        );

        -- ledgerHelperDict 的 8 个 string[] 字段打平存储；sort_order 保留管理员维护的原始顺序
        CREATE TABLE IF NOT EXISTS ledger_helper_options (
          category TEXT NOT NULL,
          value TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (category, value)
        );
      `);
    }
    return StorageService.db;
  }

  /**
   * @description 统计规范化表结构里一共有多少行数据，用于判断"是否首次启动/是否需要迁移"
   * @param {Database.Database} db SQLite 数据库连接
   * @returns {number} 规范化表结构的数据总行数
   */
  private static countNormalizedRows(db: Database.Database): number {
    return NORMALIZED_TABLES.reduce((sum, table) => {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
      return sum + row.c;
    }, 0);
  }

  /**
   * @description 覆盖写入"骨架"部分：ledgers / ledger_items（不含每日流水）/ reports+prepared_items+每日备餐数据 /
   * active_groups / active_categories / raw_materials_dict / ledger_helper_options。
   * 不涉及 ledger_item_daily_records，供 importFullDataIntoSqlite（正常保存）与 importSkeletonOnlyIntoSqlite（备份恢复）共用。
   * @param {Database.Database} db SQLite 数据库连接
   * @param {any} data 需要写入的全量数据包
   * @returns {void}
   */
  private static upsertSkeleton(db: Database.Database, data: any): void {
    // 1. ledgers
    db.prepare("DELETE FROM ledgers").run();
    const insertLedger = db.prepare("INSERT INTO ledgers (id, name, created_at) VALUES (?, ?, ?)");
    for (const l of data.ledgers ?? []) {
      insertLedger.run(l.id, l.name, l.createdAt);
    }

    // 2. ledger_items（骨架，不含每日流水）
    db.prepare("DELETE FROM ledger_items").run();
    const insertItem = db.prepare(
      "INSERT INTO ledger_items (id, ledger_id, name, unit, spec, initial_stock, current_stock) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const item of data.ledgerItems ?? []) {
      insertItem.run(item.id, item.ledgerId, item.name, item.unit, item.spec ?? null, item.initialStock ?? 0, item.currentStock ?? 0);
    }

    // 3. reports + prepared_items + prepared_item_daily_data（这部分历来完整包含在备份快照里，恢复时也要整体覆盖）
    db.prepare("DELETE FROM reports").run();
    db.prepare("DELETE FROM prepared_items").run();
    db.prepare("DELETE FROM prepared_item_daily_data").run();
    const insertReport = db.prepare("INSERT OR IGNORE INTO reports (target_group, year, month) VALUES (?, ?, ?)");
    const insertPreparedItem = db.prepare(
      "INSERT INTO prepared_items (id, report_target_group, report_year, report_month, name, category, target_group, unit, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertDailyData = db.prepare(
      "INSERT INTO prepared_item_daily_data (item_id, date, quantity, price, amount) VALUES (?, ?, ?, ?, ?)"
    );
    for (const report of data.reports ?? []) {
      insertReport.run(report.targetGroup, report.year, report.month);
      for (const item of report.items ?? []) {
        insertPreparedItem.run(
          item.id, report.targetGroup, report.year, report.month,
          item.name, item.category, item.targetGroup, item.unit, item.note ?? null
        );
        for (const [dateStr, entry] of Object.entries(item.dailyData ?? {}) as [string, any][]) {
          if (!dateStr || !entry) continue;
          insertDailyData.run(item.id, dateStr, entry.quantity ?? 0, entry.price ?? 0, entry.amount ?? 0);
        }
      }
    }

    // 4. active_groups / active_categories
    db.prepare("DELETE FROM active_groups").run();
    const insertGroup = db.prepare("INSERT INTO active_groups (key, label, emoji, is_default) VALUES (?, ?, ?, ?)");
    for (const g of data.activeGroups ?? []) {
      insertGroup.run(g.key, g.label, g.emoji ?? null, g.isDefault ? 1 : 0);
    }
    db.prepare("DELETE FROM active_categories").run();
    const insertCategory = db.prepare("INSERT INTO active_categories (key, label, is_default) VALUES (?, ?, ?)");
    for (const c of data.activeCategories ?? []) {
      insertCategory.run(c.key, c.label, c.isDefault ? 1 : 0);
    }

    // 5. raw_materials_dict
    db.prepare("DELETE FROM raw_materials_dict").run();
    const insertDictItem = db.prepare(
      "INSERT INTO raw_materials_dict (name, category, unit, remark, conversion_unit, conversion_ratio, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const d of data.rawMaterialsDict ?? []) {
      insertDictItem.run(d.name, d.category, d.unit, d.remark ?? null, d.conversionUnit ?? null, d.conversionRatio ?? null, d.isDefault ? 1 : 0);
    }

    // 6. ledger_helper_options
    db.prepare("DELETE FROM ledger_helper_options").run();
    const insertHelperOption = db.prepare("INSERT INTO ledger_helper_options (category, value, sort_order) VALUES (?, ?, ?)");
    const helperDict = data.ledgerHelperDict ?? {};
    for (const category of HELPER_DICT_CATEGORIES) {
      const values: string[] = helperDict[category] ?? [];
      values.forEach((value, idx) => insertHelperOption.run(category, value, idx));
    }
  }

  /**
   * @description 全量重建：骨架部分整体覆盖 + ledger_item_daily_records 整体重建（先清空再按当前 payload 完整重插入），
   * 全部包裹在同一个 SQLite 事务里——要么全部生效，要么全部不生效。阶段三起不再是正常保存路径调用的方法
   * （正常保存改为 applyChangesIntoSqlite() 的增量 upsert/delete），仅供 migrateToNormalizedSchemaIfNeeded()
   * 处理历史版本一次性迁移时调用。
   * @param {any} data 需要迁移导入的全量数据包（ledgerItems[].dailyRecords 为完整的当前每日流水）
   * @returns {void}
   */
  private static importFullDataIntoSqlite(data: any): void {
    const db = StorageService.getDb();
    const deleteAllDaily = db.prepare("DELETE FROM ledger_item_daily_records");
    const insertDaily = db.prepare(`
      INSERT INTO ledger_item_daily_records
        (item_id, date, in_quantity, in_price, in_amount, out_quantity, out_price, out_amount, note,
         certification, sensory_property, supplier, purchase_date, buyer, inspector, keeper,
         produce_date, shelf_life, out_handler, out_recipient, conversion_unit_quantity, out_date)
      VALUES
        (@itemId, @date, @inQuantity, @inPrice, @inAmount, @outQuantity, @outPrice, @outAmount, @note,
         @certification, @sensoryProperty, @supplier, @purchaseDate, @buyer, @inspector, @keeper,
         @produceDate, @shelfLife, @outHandler, @outRecipient, @conversionUnitQuantity, @outDate)
    `);

    const run = db.transaction((payload: any) => {
      StorageService.upsertSkeleton(db, payload);
      deleteAllDaily.run();
      for (const item of payload.ledgerItems ?? []) {
        if (!item || !item.dailyRecords) continue;
        for (const [dateStr, record] of Object.entries(item.dailyRecords) as [string, any][]) {
          if (!dateStr || !record) continue;
          insertDaily.run({
            itemId: item.id,
            date: dateStr,
            inQuantity: record.inQuantity ?? 0,
            inPrice: record.inPrice ?? 0,
            inAmount: record.inAmount ?? 0,
            outQuantity: record.outQuantity ?? 0,
            outPrice: record.outPrice ?? null,
            outAmount: record.outAmount ?? null,
            note: record.note ?? null,
            certification: record.certification ?? null,
            sensoryProperty: record.sensoryProperty ?? null,
            supplier: record.supplier ?? null,
            purchaseDate: record.purchaseDate ?? null,
            buyer: record.buyer ?? null,
            inspector: record.inspector ?? null,
            keeper: record.keeper ?? null,
            produceDate: record.produceDate ?? null,
            shelfLife: record.shelfLife ?? null,
            outHandler: record.outHandler ?? null,
            outRecipient: record.outRecipient ?? null,
            conversionUnitQuantity: record.conversionUnitQuantity ?? null,
            outDate: record.outDate ?? null
          });
        }
      }
    });
    run(data);
  }

  /**
   * @description 从备份恢复专用：只覆盖骨架部分，绝不触碰 ledger_item_daily_records。备份快照本身从不包含
   * 台账每日出入库流水（与阶段一、以及更早版本的既有限制保持一致：备份快照里 ledgerItems[].dailyRecords 恒为空对象），
   * 若在这里也整体重建每日流水，会把当前生效中的真实购销记录清空，属于比历史版本更严重的数据丢失回归。
   * @param {any} data 备份快照解析出的数据
   * @returns {void}
   */
  private static importSkeletonOnlyIntoSqlite(data: any): void {
    const db = StorageService.getDb();
    const run = db.transaction((payload: any) => {
      StorageService.upsertSkeleton(db, payload);
    });
    run(data);
  }

  /**
   * @description 增量写入专用的 prepared statement 缓存（按名称缓存，避免每次防抖 flush 都重新 db.prepare()）。
   * 与 upsertSkeleton/importFullDataIntoSqlite（全量重建路径，专供一次性历史迁移与备份恢复使用）完全独立、
   * 互不复用，避免为了减少一点重复 SQL 文本而让这两套本质不同的写入路径产生耦合。
   */
  private static incrementalStmts: Map<string, Database.Statement> | null = null;

  /**
   * @description 懒加载并返回增量写入用的 prepared statement 缓存
   * @param {Database.Database} db SQLite 数据库连接
   * @returns {Map<string, Database.Statement>} 按名称索引的 prepared statement 缓存
   */
  private static getIncrementalStmts(db: Database.Database): Map<string, Database.Statement> {
    if (!StorageService.incrementalStmts) {
      const stmts = new Map<string, Database.Statement>();
      stmts.set("upsertLedger", db.prepare(
        "INSERT INTO ledgers (id, name, created_at) VALUES (@id, @name, @createdAt) " +
        "ON CONFLICT(id) DO UPDATE SET name = @name, created_at = @createdAt"
      ));
      stmts.set("deleteLedger", db.prepare("DELETE FROM ledgers WHERE id = ?"));
      stmts.set("upsertLedgerItem", db.prepare(
        "INSERT INTO ledger_items (id, ledger_id, name, unit, spec, initial_stock, current_stock) " +
        "VALUES (@id, @ledgerId, @name, @unit, @spec, @initialStock, @currentStock) " +
        "ON CONFLICT(id) DO UPDATE SET ledger_id=@ledgerId, name=@name, unit=@unit, spec=@spec, " +
        "initial_stock=@initialStock, current_stock=@currentStock"
      ));
      stmts.set("deleteLedgerItem", db.prepare("DELETE FROM ledger_items WHERE id = ?"));
      stmts.set("deleteDailyRecordsByItem", db.prepare("DELETE FROM ledger_item_daily_records WHERE item_id = ?"));
      stmts.set("upsertDailyRecord", db.prepare(`
        INSERT INTO ledger_item_daily_records
          (item_id, date, in_quantity, in_price, in_amount, out_quantity, out_price, out_amount, note,
           certification, sensory_property, supplier, purchase_date, buyer, inspector, keeper,
           produce_date, shelf_life, out_handler, out_recipient, conversion_unit_quantity, out_date)
        VALUES
          (@itemId, @date, @inQuantity, @inPrice, @inAmount, @outQuantity, @outPrice, @outAmount, @note,
           @certification, @sensoryProperty, @supplier, @purchaseDate, @buyer, @inspector, @keeper,
           @produceDate, @shelfLife, @outHandler, @outRecipient, @conversionUnitQuantity, @outDate)
        ON CONFLICT(item_id, date) DO UPDATE SET
          in_quantity=@inQuantity, in_price=@inPrice, in_amount=@inAmount, out_quantity=@outQuantity,
          out_price=@outPrice, out_amount=@outAmount, note=@note, certification=@certification,
          sensory_property=@sensoryProperty, supplier=@supplier, purchase_date=@purchaseDate, buyer=@buyer,
          inspector=@inspector, keeper=@keeper, produce_date=@produceDate, shelf_life=@shelfLife,
          out_handler=@outHandler, out_recipient=@outRecipient,
          conversion_unit_quantity=@conversionUnitQuantity, out_date=@outDate
      `));
      stmts.set("deleteDailyRecord", db.prepare("DELETE FROM ledger_item_daily_records WHERE item_id = ? AND date = ?"));
      stmts.set("upsertReport", db.prepare("INSERT OR IGNORE INTO reports (target_group, year, month) VALUES (?, ?, ?)"));
      stmts.set("deleteReport", db.prepare("DELETE FROM reports WHERE target_group = ? AND year = ? AND month = ?"));
      stmts.set("selectPreparedItemIdsByReport", db.prepare(
        "SELECT id FROM prepared_items WHERE report_target_group = ? AND report_year = ? AND report_month = ?"
      ));
      stmts.set("deletePreparedItemsByReport", db.prepare(
        "DELETE FROM prepared_items WHERE report_target_group = ? AND report_year = ? AND report_month = ?"
      ));
      stmts.set("upsertPreparedItem", db.prepare(
        "INSERT INTO prepared_items (id, report_target_group, report_year, report_month, name, category, target_group, unit, note) " +
        "VALUES (@id, @reportTargetGroup, @reportYear, @reportMonth, @name, @category, @targetGroup, @unit, @note) " +
        "ON CONFLICT(id) DO UPDATE SET report_target_group=@reportTargetGroup, report_year=@reportYear, " +
        "report_month=@reportMonth, name=@name, category=@category, target_group=@targetGroup, unit=@unit, note=@note"
      ));
      stmts.set("deletePreparedItem", db.prepare("DELETE FROM prepared_items WHERE id = ?"));
      stmts.set("deleteDailyDataByItem", db.prepare("DELETE FROM prepared_item_daily_data WHERE item_id = ?"));
      stmts.set("upsertDailyData", db.prepare(
        "INSERT INTO prepared_item_daily_data (item_id, date, quantity, price, amount) " +
        "VALUES (@itemId, @date, @quantity, @price, @amount) " +
        "ON CONFLICT(item_id, date) DO UPDATE SET quantity=@quantity, price=@price, amount=@amount"
      ));
      stmts.set("deleteDailyData", db.prepare("DELETE FROM prepared_item_daily_data WHERE item_id = ? AND date = ?"));
      stmts.set("upsertActiveGroup", db.prepare(
        "INSERT INTO active_groups (key, label, emoji, is_default) VALUES (@key, @label, @emoji, @isDefault) " +
        "ON CONFLICT(key) DO UPDATE SET label=@label, emoji=@emoji, is_default=@isDefault"
      ));
      stmts.set("deleteActiveGroup", db.prepare("DELETE FROM active_groups WHERE key = ?"));
      stmts.set("upsertActiveCategory", db.prepare(
        "INSERT INTO active_categories (key, label, is_default) VALUES (@key, @label, @isDefault) " +
        "ON CONFLICT(key) DO UPDATE SET label=@label, is_default=@isDefault"
      ));
      stmts.set("deleteActiveCategory", db.prepare("DELETE FROM active_categories WHERE key = ?"));
      stmts.set("upsertRawMaterial", db.prepare(
        "INSERT INTO raw_materials_dict (name, category, unit, remark, conversion_unit, conversion_ratio, is_default) " +
        "VALUES (@name, @category, @unit, @remark, @conversionUnit, @conversionRatio, @isDefault) " +
        "ON CONFLICT(name) DO UPDATE SET category=@category, unit=@unit, remark=@remark, " +
        "conversion_unit=@conversionUnit, conversion_ratio=@conversionRatio, is_default=@isDefault"
      ));
      stmts.set("deleteRawMaterial", db.prepare("DELETE FROM raw_materials_dict WHERE name = ?"));
      stmts.set("deleteHelperCategory", db.prepare("DELETE FROM ledger_helper_options WHERE category = ?"));
      stmts.set("insertHelperOption", db.prepare("INSERT INTO ledger_helper_options (category, value, sort_order) VALUES (?, ?, ?)"));
      StorageService.incrementalStmts = stmts;
    }
    return StorageService.incrementalStmts;
  }

  /**
   * @description 把一条台账逐日流水记录（可能字段不全）规整成 upsertDailyRecord 需要的具名参数对象
   * @param {string} itemId 台账原料项 id
   * @param {string} date 日期字符串
   * @param {any} record 逐日流水记录（可能为 undefined）
   * @returns {any} 具名参数对象
   */
  private static toDailyRecordParams(itemId: string, date: string, record: any) {
    return {
      itemId, date,
      inQuantity: record?.inQuantity ?? 0, inPrice: record?.inPrice ?? 0, inAmount: record?.inAmount ?? 0,
      outQuantity: record?.outQuantity ?? 0, outPrice: record?.outPrice ?? null, outAmount: record?.outAmount ?? null,
      note: record?.note ?? null, certification: record?.certification ?? null, sensoryProperty: record?.sensoryProperty ?? null,
      supplier: record?.supplier ?? null, purchaseDate: record?.purchaseDate ?? null, buyer: record?.buyer ?? null,
      inspector: record?.inspector ?? null, keeper: record?.keeper ?? null, produceDate: record?.produceDate ?? null,
      shelfLife: record?.shelfLife ?? null, outHandler: record?.outHandler ?? null, outRecipient: record?.outRecipient ?? null,
      conversionUnitQuantity: record?.conversionUnitQuantity ?? null, outDate: record?.outDate ?? null
    };
  }

  /**
   * @description 增量应用一批同步操作到规范化关系型表，包裹在同一个 SQLite 事务里（整批要么全部生效、要么全部回滚）。
   * 与 importFullDataIntoSqlite 的"全量 DELETE+INSERT 重建"不同，这里只对 op 里明确指出的实体/主键做目标 upsert/delete。
   * 由于当前 schema 未声明任何 ON DELETE CASCADE（全量重建靠"删光重插"隐式达到级联效果），
   * 这里对有子表的实体删除操作必须显式做级联清理，否则会留下孤儿行。
   * @param {SyncOp[]} ops 一批增量同步操作
   * @returns {void}
   */
  private static applyChangesIntoSqlite(ops: SyncOp[]): void {
    const db = StorageService.getDb();
    const stmts = StorageService.getIncrementalStmts(db);

    const run = db.transaction((batch: SyncOp[]) => {
      for (const op of batch) {
        if (op.op === "replaceAll") {
          StorageService.applyReplaceAllIntoSqlite(db, stmts, op);
          continue;
        }
        switch (op.entity) {
          case "ledger":
            if (op.op === "delete") {
              stmts.get("deleteLedger")!.run(op.key);
            } else {
              stmts.get("upsertLedger")!.run({ id: op.data.id, name: op.data.name, createdAt: op.data.createdAt });
            }
            break;

          case "ledgerItem":
            if (op.op === "delete") {
              // 无 FK 级联声明，显式先清空该原料项的全部逐日流水，再删骨架行，避免留下孤儿流水行
              stmts.get("deleteDailyRecordsByItem")!.run(op.key);
              stmts.get("deleteLedgerItem")!.run(op.key);
            } else {
              const d = op.data;
              stmts.get("upsertLedgerItem")!.run({
                id: d.id, ledgerId: d.ledgerId, name: d.name, unit: d.unit,
                spec: d.spec ?? null, initialStock: d.initialStock ?? 0, currentStock: d.currentStock ?? 0
              });
            }
            break;

          case "ledgerItemDailyRecord": {
            const key = op.key as { itemId: string; date: string };
            if (op.op === "delete") {
              stmts.get("deleteDailyRecord")!.run(key.itemId, key.date);
            } else {
              stmts.get("upsertDailyRecord")!.run(StorageService.toDailyRecordParams(key.itemId, key.date, op.data));
            }
            break;
          }

          case "report": {
            const key = op.key as { targetGroup: string; year: number; month: number };
            if (op.op === "delete") {
              // 级联：先清空该报表下所有备餐细项的每日数据，再删细项，最后删报表本身
              const ids = stmts.get("selectPreparedItemIdsByReport")!.all(key.targetGroup, key.year, key.month) as Array<{ id: string }>;
              for (const row of ids) {
                stmts.get("deleteDailyDataByItem")!.run(row.id);
              }
              stmts.get("deletePreparedItemsByReport")!.run(key.targetGroup, key.year, key.month);
              stmts.get("deleteReport")!.run(key.targetGroup, key.year, key.month);
            } else {
              stmts.get("upsertReport")!.run(key.targetGroup, key.year, key.month);
            }
            break;
          }

          case "preparedItem":
            if (op.op === "delete") {
              stmts.get("deleteDailyDataByItem")!.run(op.key);
              stmts.get("deletePreparedItem")!.run(op.key);
            } else {
              const d = op.data;
              stmts.get("upsertPreparedItem")!.run({
                id: d.id, reportTargetGroup: d.reportTargetGroup, reportYear: d.reportYear, reportMonth: d.reportMonth,
                name: d.name, category: d.category, targetGroup: d.targetGroup, unit: d.unit, note: d.note ?? null
              });
            }
            break;

          case "preparedItemDailyData": {
            const key = op.key as { itemId: string; date: string };
            if (op.op === "delete") {
              stmts.get("deleteDailyData")!.run(key.itemId, key.date);
            } else {
              const d = op.data ?? {};
              stmts.get("upsertDailyData")!.run({
                itemId: key.itemId, date: key.date, quantity: d.quantity ?? 0, price: d.price ?? 0, amount: d.amount ?? 0
              });
            }
            break;
          }

          case "activeGroup":
            if (op.op === "delete") {
              stmts.get("deleteActiveGroup")!.run(op.key);
            } else {
              const d = op.data;
              stmts.get("upsertActiveGroup")!.run({ key: d.key, label: d.label, emoji: d.emoji ?? null, isDefault: d.isDefault ? 1 : 0 });
            }
            break;

          case "activeCategory":
            if (op.op === "delete") {
              stmts.get("deleteActiveCategory")!.run(op.key);
            } else {
              const d = op.data;
              stmts.get("upsertActiveCategory")!.run({ key: d.key, label: d.label, isDefault: d.isDefault ? 1 : 0 });
            }
            break;

          case "rawMaterial":
            if (op.op === "delete") {
              stmts.get("deleteRawMaterial")!.run(op.key);
            } else {
              const d = op.data;
              // rawMaterial.name 本身是主键且支持改名：改名时先删旧主键行，避免留下 (旧名, 新数据的孤本) 之外的重复行
              if (op.previousKey && op.previousKey !== d.name) {
                stmts.get("deleteRawMaterial")!.run(op.previousKey);
              }
              stmts.get("upsertRawMaterial")!.run({
                name: d.name, category: d.category, unit: d.unit, remark: d.remark ?? null,
                conversionUnit: d.conversionUnit ?? null, conversionRatio: d.conversionRatio ?? null, isDefault: d.isDefault ? 1 : 0
              });
            }
            break;

          case "ledgerHelperOptions": {
            const category = op.key as string;
            stmts.get("deleteHelperCategory")!.run(category);
            const values: string[] = op.data ?? [];
            values.forEach((value, idx) => stmts.get("insertHelperOption")!.run(category, value, idx));
            break;
          }

          default:
            throw new Error(`[STORAGE SQLITE] 未知的增量操作实体类型: ${(op as any).entity}`);
        }
      }
    });
    run(ops);
  }

  /**
   * @description "replaceAll" 操作的具体应用逻辑：仅供首次启动/批量种子数据生成场景使用，
   * 整批删除并重插入指定实体的全部行（而不是强行拆成逐条 upsert 枚举）。
   * @param {Database.Database} db SQLite 数据库连接
   * @param {Map<string, Database.Statement>} stmts 增量写入 prepared statement 缓存
   * @param {SyncOp} op replaceAll 操作
   * @returns {void}
   */
  private static applyReplaceAllIntoSqlite(db: Database.Database, stmts: Map<string, Database.Statement>, op: SyncOp): void {
    const rows: any[] = op.data ?? [];
    switch (op.entity) {
      case "ledger":
        db.prepare("DELETE FROM ledgers").run();
        for (const l of rows) stmts.get("upsertLedger")!.run({ id: l.id, name: l.name, createdAt: l.createdAt });
        break;

      case "ledgerItem":
        db.prepare("DELETE FROM ledger_item_daily_records").run();
        db.prepare("DELETE FROM ledger_items").run();
        for (const item of rows) {
          stmts.get("upsertLedgerItem")!.run({
            id: item.id, ledgerId: item.ledgerId, name: item.name, unit: item.unit,
            spec: item.spec ?? null, initialStock: item.initialStock ?? 0, currentStock: item.currentStock ?? 0
          });
          for (const [dateStr, record] of Object.entries(item.dailyRecords ?? {}) as [string, any][]) {
            if (!dateStr || !record) continue;
            stmts.get("upsertDailyRecord")!.run(StorageService.toDailyRecordParams(item.id, dateStr, record));
          }
        }
        break;

      case "report":
        db.prepare("DELETE FROM prepared_item_daily_data").run();
        db.prepare("DELETE FROM prepared_items").run();
        db.prepare("DELETE FROM reports").run();
        for (const report of rows) {
          stmts.get("upsertReport")!.run(report.targetGroup, report.year, report.month);
          for (const item of report.items ?? []) {
            stmts.get("upsertPreparedItem")!.run({
              id: item.id, reportTargetGroup: report.targetGroup, reportYear: report.year, reportMonth: report.month,
              name: item.name, category: item.category, targetGroup: item.targetGroup, unit: item.unit, note: item.note ?? null
            });
            for (const [dateStr, entry] of Object.entries(item.dailyData ?? {}) as [string, any][]) {
              if (!dateStr || !entry) continue;
              stmts.get("upsertDailyData")!.run({ itemId: item.id, date: dateStr, quantity: entry.quantity ?? 0, price: entry.price ?? 0, amount: entry.amount ?? 0 });
            }
          }
        }
        break;

      case "activeGroup":
        db.prepare("DELETE FROM active_groups").run();
        for (const g of rows) stmts.get("upsertActiveGroup")!.run({ key: g.key, label: g.label, emoji: g.emoji ?? null, isDefault: g.isDefault ? 1 : 0 });
        break;

      case "activeCategory":
        db.prepare("DELETE FROM active_categories").run();
        for (const c of rows) stmts.get("upsertActiveCategory")!.run({ key: c.key, label: c.label, isDefault: c.isDefault ? 1 : 0 });
        break;

      case "rawMaterial":
        db.prepare("DELETE FROM raw_materials_dict").run();
        for (const d of rows) {
          stmts.get("upsertRawMaterial")!.run({
            name: d.name, category: d.category, unit: d.unit, remark: d.remark ?? null,
            conversionUnit: d.conversionUnit ?? null, conversionRatio: d.conversionRatio ?? null, isDefault: d.isDefault ? 1 : 0
          });
        }
        break;

      case "ledgerHelperOptions":
        // 此实体的 replaceAll 用 data: Array<{ category: string; values: string[] }> 的特殊形状
        for (const entry of rows as Array<{ category: string; values: string[] }>) {
          stmts.get("deleteHelperCategory")!.run(entry.category);
          (entry.values ?? []).forEach((value, idx) => stmts.get("insertHelperOption")!.run(entry.category, value, idx));
        }
        break;
    }
  }

  /**
   * @description 从规范化关系型表中读出完整的应用状态对象，形状与迁移之前的 load() 返回值完全一致
   * （含把 ledger_item_daily_records 重新拼装回每个 ledgerItem 的 dailyRecords 字典、把 prepared_item_daily_data
   * 重新拼装回每个 PreparedItem 的 dailyData 字典）。规范化表结构完全为空时返回 {}，与首次启动语义保持一致。
   * @returns {any} 完整的应用状态对象
   */
  private static readDataFromSqlite(): any {
    const db = StorageService.getDb();
    if (StorageService.countNormalizedRows(db) === 0) {
      return {};
    }

    const ledgers = db.prepare("SELECT id, name, created_at as createdAt FROM ledgers").all();

    const ledgerItemsRaw = db.prepare(
      "SELECT id, ledger_id as ledgerId, name, unit, spec, initial_stock as initialStock, current_stock as currentStock FROM ledger_items"
    ).all() as any[];
    const dailyRows = db.prepare(`
      SELECT item_id as itemId, date, in_quantity as inQuantity, in_price as inPrice, in_amount as inAmount,
             out_quantity as outQuantity, out_price as outPrice, out_amount as outAmount, note, certification,
             sensory_property as sensoryProperty, supplier, purchase_date as purchaseDate, buyer, inspector, keeper,
             produce_date as produceDate, shelf_life as shelfLife, out_handler as outHandler, out_recipient as outRecipient,
             conversion_unit_quantity as conversionUnitQuantity, out_date as outDate
      FROM ledger_item_daily_records
    `).all() as any[];
    const dailyByItem: Record<string, Record<string, any>> = {};
    for (const row of dailyRows) {
      const { itemId, date, ...record } = row;
      if (!dailyByItem[itemId]) dailyByItem[itemId] = {};
      dailyByItem[itemId][date] = record;
    }
    const ledgerItems = ledgerItemsRaw.map((item) => ({
      ...item,
      dailyRecords: dailyByItem[item.id] || {}
    }));

    const reportsRaw = db.prepare("SELECT target_group as targetGroup, year, month FROM reports").all() as any[];
    const preparedItemsRaw = db.prepare(`
      SELECT id, report_target_group as reportTargetGroup, report_year as reportYear, report_month as reportMonth,
             name, category, target_group as targetGroup, unit, note
      FROM prepared_items
    `).all() as any[];
    const dailyDataRows = db.prepare("SELECT item_id as itemId, date, quantity, price, amount FROM prepared_item_daily_data").all() as any[];
    const dailyDataByItem: Record<string, Record<string, any>> = {};
    for (const row of dailyDataRows) {
      if (!dailyDataByItem[row.itemId]) dailyDataByItem[row.itemId] = {};
      dailyDataByItem[row.itemId][row.date] = { quantity: row.quantity, price: row.price, amount: row.amount };
    }
    const preparedItemsByReport: Record<string, any[]> = {};
    for (const item of preparedItemsRaw) {
      const reportKey = `${item.reportTargetGroup}__${item.reportYear}__${item.reportMonth}`;
      const { reportTargetGroup, reportYear, reportMonth, ...rest } = item;
      if (!preparedItemsByReport[reportKey]) preparedItemsByReport[reportKey] = [];
      preparedItemsByReport[reportKey].push({ ...rest, dailyData: dailyDataByItem[item.id] || {} });
    }
    const reports = reportsRaw.map((r) => {
      const key = `${r.targetGroup}__${r.year}__${r.month}`;
      return { ...r, items: preparedItemsByReport[key] || [] };
    });

    const activeGroups = (db.prepare("SELECT key, label, emoji, is_default as isDefault FROM active_groups").all() as any[])
      .map((g) => ({ key: g.key, label: g.label, emoji: g.emoji, isDefault: !!g.isDefault }));
    const activeCategories = (db.prepare("SELECT key, label, is_default as isDefault FROM active_categories").all() as any[])
      .map((c) => ({ key: c.key, label: c.label, isDefault: !!c.isDefault }));

    const rawMaterialsDict = (db.prepare(`
      SELECT name, category, unit, remark, conversion_unit as conversionUnit, conversion_ratio as conversionRatio, is_default as isDefault
      FROM raw_materials_dict
    `).all() as any[]).map((d) => ({ ...d, isDefault: !!d.isDefault }));

    const helperRows = db.prepare("SELECT category, value FROM ledger_helper_options ORDER BY category, sort_order").all() as Array<{ category: string; value: string }>;
    const ledgerHelperDict: Record<string, string[]> = {};
    for (const category of HELPER_DICT_CATEGORIES) {
      ledgerHelperDict[category] = [];
    }
    for (const row of helperRows) {
      if (!ledgerHelperDict[row.category]) ledgerHelperDict[row.category] = [];
      ledgerHelperDict[row.category].push(row.value);
    }

    return { reports, activeGroups, activeCategories, ledgers, ledgerItems, rawMaterialsDict, ledgerHelperDict };
  }

  /**
   * @description 递归扫描并读取本地 ledgers/daily 目录下按年、月、天分散保存的最早版本 JSON 流水文件，并合并到内存结构中。
   * 仅供 migrateLegacyJsonIfNeeded() 一次性导入历史数据时调用，不再是常态读取路径。
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
   * @description 读取阶段一遗留的 kv_store + daily_records（JSON 文本块）数据，还原成与 load() 一致的应用状态对象。
   * 仅供 migrateToNormalizedSchemaIfNeeded() 一次性升级迁移时调用。
   * @param {Database.Database} db SQLite 数据库连接
   * @returns {any} 阶段一 kv_store 里还原出的应用状态对象；若阶段一表本身没有数据则返回 null
   */
  private static readLegacyKvStoreData(db: Database.Database): any {
    const kvRows = db.prepare("SELECT key, value FROM kv_store").all() as Array<{ key: string; value: string }>;
    if (kvRows.length === 0) return null;

    const data: any = {};
    for (const row of kvRows) {
      try {
        data[row.key] = JSON.parse(row.value);
      } catch (e) {
        console.error(`[STORAGE SQLITE] 解析阶段一 kv_store 字段 ${row.key} 失败:`, e);
      }
    }

    const mergedDaily: Record<string, Record<string, any>> = {};
    const dailyRows = db.prepare("SELECT item_id, date, data FROM daily_records").all() as Array<{ item_id: string; date: string; data: string }>;
    for (const row of dailyRows) {
      try {
        if (!mergedDaily[row.item_id]) mergedDaily[row.item_id] = {};
        mergedDaily[row.item_id][row.date] = JSON.parse(row.data);
      } catch (e) {
        console.error(`[STORAGE SQLITE] 解析阶段一每日流水记录失败 (item=${row.item_id}, date=${row.date}):`, e);
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
   * @description 一次性历史数据迁移：若当前规范化表结构完全没有数据，说明这是从更早版本升级上来的部署，按优先级
   * 依次尝试两种历史数据源自动迁移——① 阶段一遗留的 kv_store（浅迁移版本）；② 更早的纯 JSON 文件 db.json（含按年/月/日
   * 拆分的每日流水）。迁移完成后原始数据（阶段一的 kv_store 表、最早版本的 JSON 文件）均不会被删除，作为人工回退的最后手段。
   * 仅在规范化表结构完全没有数据时才会触发，避免每次重启都重复导入、用旧数据覆盖掉已经产生的新数据。
   * @returns {void}
   */
  private static migrateToNormalizedSchemaIfNeeded(): void {
    const db = StorageService.getDb();
    if (StorageService.countNormalizedRows(db) > 0) {
      return;
    }

    // 优先尝试阶段一遗留的 kv_store 数据
    const legacyKvData = StorageService.readLegacyKvStoreData(db);
    if (legacyKvData) {
      StorageService.importFullDataIntoSqlite(legacyKvData);
      console.log("[STORAGE SQLITE] 已自动将阶段一（浅迁移）数据迁移至规范化关系型表结构，原表结构予以保留。");
      return;
    }

    // 再尝试更早版本的纯 JSON 文件
    if (!fs.existsSync(StorageService.localDbPath)) {
      return;
    }
    try {
      const content = fs.readFileSync(StorageService.localDbPath, "utf8");
      const legacyJsonData = JSON.parse(content);

      const dailyDir = path.join(path.dirname(StorageService.localDbPath), "ledgers", "daily");
      const mergedDaily: Record<string, Record<string, any>> = {};
      StorageService.readAllDailyRecordsLocal(dailyDir, mergedDaily);
      if (Array.isArray(legacyJsonData.ledgerItems)) {
        for (const item of legacyJsonData.ledgerItems) {
          item.dailyRecords = mergedDaily[item.id] || {};
        }
      }

      StorageService.importFullDataIntoSqlite(legacyJsonData);
      console.log(`[STORAGE SQLITE] 已自动将最早版本的 JSON 数据（${StorageService.localDbPath}）迁移至规范化关系型表结构，原始文件予以保留。`);
    } catch (err) {
      console.error("[STORAGE SQLITE] 历史数据迁移失败，将以空数据集启动：", err);
    }
  }

  /**
   * @description 初始化存储引擎，创建必要的本地目录、打开 SQLite 连接，并按需自动迁移历史数据
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
      StorageService.migrateToNormalizedSchemaIfNeeded();
    } else {
      console.log("[STORAGE] 启动云端存储模式：已挂载腾讯云 COS 同步总线。");
    }
  }

  /**
   * @description 从腾讯云 COS 拉取当前主数据对象（内部专用，供 load() 与增量写入路径共用读取逻辑）
   * @returns {Promise<any>} 当前云端主数据对象；不存在或解析失败时返回 {}
   */
  private static async loadCurrentFromCos(): Promise<any> {
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
  }

  /**
   * @description 加载主数据库内容
   * @returns {Promise<any>} 返回 JSON 数据对象
   */
  public static async load(): Promise<any> {
    if (StorageService.storageType === "cos") {
      return StorageService.loadCurrentFromCos();
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
   * @description 在内存中把一批增量同步操作应用到一份完整状态对象上，返回应用后的新对象（不修改传入的原对象）。
   * 腾讯云 COS 对象存储没有行级别写入 API，只能整体覆盖对象，因此 COS 模式下的"增量写"实质是
   * "读出当前完整对象→在内存里应用 op 批次→整体覆盖写回"，增量写入带来的收益（更小的写入体积、更少的全量重建）
   * 只体现在本地 SQLite 模式下；COS 模式下这是可接受的架构现实，不需要也没有必要单独优化。
   * @param {any} current 当前完整状态对象
   * @param {SyncOp[]} ops 一批增量同步操作
   * @returns {any} 应用完 op 批次后的新状态对象
   */
  private static applyOpsToPlainObject(current: any, ops: SyncOp[]): any {
    const data: any = {
      ledgers: current.ledgers ? [...current.ledgers] : [],
      ledgerItems: current.ledgerItems ? current.ledgerItems.map((i: any) => ({ ...i, dailyRecords: { ...(i.dailyRecords ?? {}) } })) : [],
      reports: current.reports ? current.reports.map((r: any) => ({
        ...r, items: (r.items ?? []).map((it: any) => ({ ...it, dailyData: { ...(it.dailyData ?? {}) } }))
      })) : [],
      activeGroups: current.activeGroups ? [...current.activeGroups] : [],
      activeCategories: current.activeCategories ? [...current.activeCategories] : [],
      rawMaterialsDict: current.rawMaterialsDict ? [...current.rawMaterialsDict] : [],
      ledgerHelperDict: current.ledgerHelperDict ? { ...current.ledgerHelperDict } : {}
    };

    const findLedgerItem = (id: string) => data.ledgerItems.find((i: any) => i.id === id);
    const findReport = (tg: string, y: number, m: number) => data.reports.find((r: any) => r.targetGroup === tg && r.year === y && r.month === m);
    const findPreparedItem = (id: string): { report: any; item: any } | null => {
      for (const r of data.reports) {
        const it = (r.items ?? []).find((i: any) => i.id === id);
        if (it) return { report: r, item: it };
      }
      return null;
    };

    for (const op of ops) {
      if (op.op === "replaceAll") {
        const rows = op.data ?? [];
        switch (op.entity) {
          case "ledger": data.ledgers = rows; break;
          case "ledgerItem": data.ledgerItems = rows.map((item: any) => ({ ...item, dailyRecords: item.dailyRecords ?? {} })); break;
          case "report": data.reports = rows.map((r: any) => ({ ...r, items: (r.items ?? []).map((it: any) => ({ ...it, dailyData: it.dailyData ?? {} })) })); break;
          case "activeGroup": data.activeGroups = rows; break;
          case "activeCategory": data.activeCategories = rows; break;
          case "rawMaterial": data.rawMaterialsDict = rows; break;
          case "ledgerHelperOptions":
            data.ledgerHelperDict = Object.fromEntries(
              (rows as Array<{ category: string; values: string[] }>).map((entry) => [entry.category, entry.values ?? []])
            );
            break;
        }
        continue;
      }
      switch (op.entity) {
        case "ledger":
          data.ledgers = data.ledgers.filter((l: any) => l.id !== op.key);
          if (op.op === "upsert") data.ledgers.push(op.data);
          break;

        case "ledgerItem": {
          const existingDaily = findLedgerItem(op.key)?.dailyRecords ?? {};
          data.ledgerItems = data.ledgerItems.filter((i: any) => i.id !== op.key);
          if (op.op === "upsert") data.ledgerItems.push({ ...op.data, dailyRecords: existingDaily });
          break;
        }

        case "ledgerItemDailyRecord": {
          const key = op.key as { itemId: string; date: string };
          const item = findLedgerItem(key.itemId);
          if (item) {
            if (op.op === "delete") delete item.dailyRecords[key.date];
            else item.dailyRecords[key.date] = op.data;
          }
          break;
        }

        case "report": {
          const key = op.key as { targetGroup: string; year: number; month: number };
          const existingItems = findReport(key.targetGroup, key.year, key.month)?.items ?? [];
          data.reports = data.reports.filter((r: any) => !(r.targetGroup === key.targetGroup && r.year === key.year && r.month === key.month));
          if (op.op === "upsert") data.reports.push({ targetGroup: key.targetGroup, year: key.year, month: key.month, items: existingItems });
          break;
        }

        case "preparedItem": {
          for (const r of data.reports) r.items = (r.items ?? []).filter((i: any) => i.id !== op.key);
          if (op.op === "upsert") {
            const d = op.data;
            const report = findReport(d.reportTargetGroup, d.reportYear, d.reportMonth);
            if (report) report.items.push({ ...d, dailyData: {} });
          }
          break;
        }

        case "preparedItemDailyData": {
          const key = op.key as { itemId: string; date: string };
          const found = findPreparedItem(key.itemId);
          if (found) {
            if (op.op === "delete") delete found.item.dailyData[key.date];
            else found.item.dailyData[key.date] = op.data;
          }
          break;
        }

        case "activeGroup":
          data.activeGroups = data.activeGroups.filter((g: any) => g.key !== op.key);
          if (op.op === "upsert") data.activeGroups.push(op.data);
          break;

        case "activeCategory":
          data.activeCategories = data.activeCategories.filter((c: any) => c.key !== op.key);
          if (op.op === "upsert") data.activeCategories.push(op.data);
          break;

        case "rawMaterial": {
          const previousKey = op.previousKey;
          data.rawMaterialsDict = data.rawMaterialsDict.filter((d: any) => d.name !== op.key && (!previousKey || d.name !== previousKey));
          if (op.op === "upsert") data.rawMaterialsDict.push(op.data);
          break;
        }

        case "ledgerHelperOptions":
          data.ledgerHelperDict[op.key as string] = op.data ?? [];
          break;
      }
    }
    return data;
  }

  /**
   * @description 保存一批增量同步操作到引擎，并自动生成应用后的完整状态备份快照
   * @param {SyncOp[]} ops 一批增量同步操作（阶段三·增量写协议，取代此前的"整体状态"参数）
   * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
   */
  public static async save(ops: SyncOp[]): Promise<boolean> {
    // 整个保存流程（含云端双写、本地 SQLite 事务+备份快照）都在写锁内串行执行，防止并发触发的多次 save() 交叉写入
    return StorageService.withWriteLock(() => StorageService.saveInternal(ops));
  }

  /**
   * @description save() 的实际执行体，被写锁包裹调用，禁止在锁外单独调用
   * @param {SyncOp[]} ops 一批增量同步操作
   * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
   */
  private static async saveInternal(ops: SyncOp[]): Promise<boolean> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (StorageService.storageType === "cos") {
      // COS 对象存储没有行级别写入 API，只能整体覆盖：读出当前完整对象、在内存中应用这批增量操作、整体写回
      const current = await StorageService.loadCurrentFromCos();
      const data = StorageService.applyOpsToPlainObject(current, ops);
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
      // 本地存储模式：这批增量操作经由 SQLite 事务原子应用（要么全部生效、要么全部不生效），
      // 随后读出应用后的完整状态，生成一份人类可读的 JSON 快照文件用于留档与手动核查（沿用既有的 30 份滚动保留策略与命名格式）
      try {
        StorageService.applyChangesIntoSqlite(ops);
        console.log(`[STORAGE SQLITE] 已通过事务增量应用 ${ops.length} 个同步操作至本地规范化关系型表结构。`);

        const cleanedData = StorageService.readDataFromSqlite();
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
      // 本地存储模式（备份快照仍是普通 JSON 文件，与迁移之前完全一致）
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
      // 本地存储模式：备份快照仍是纯 JSON 文件，且从不包含台账每日流水（与迁移之前的既有限制保持一致）。
      // 恢复时只把快照里的骨架部分重新导入，绝不清空/覆盖当前生效中的 ledger_item_daily_records
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
