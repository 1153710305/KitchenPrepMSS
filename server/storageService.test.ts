/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description StorageService（本地 SQLite 持久化服务，阶段二·规范化关系型表结构见 SQLite迁移规划.md）单元测试：
 * 主数据读写往返（含 reports/preparedItems/activeGroups/activeCategories/rawMaterialsDict/ledgerHelperDict 全部 7 个
 * 顶层字段的正确重组）、每日流水的存储与重组（含"删除后不应复活"的历史遗留 bug 回归）、损坏/首次启动状态容错、
 * 备份快照生成与保留策略裁剪、快照恢复（骨架部分覆盖但绝不清空当前生效中的台账每日流水）、restore() 的备份文件名
 * 安全校验（防路径穿越）、原子写入与写入锁、以及从阶段一 kv_store / 更早纯 JSON 文件存储的一次性自动迁移的回归测试。
 * 测试通过临时目录 + 动态重新导入模块实现相互隔离，因为 StorageService 在类定义时就从 process.env 读取路径并缓存为
 * private static 字段，运行期不会重新读取。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let StorageService: any;

/** 完整的最小合法台账原料项（与真实 LedgerItem 类型的必填字段保持一致：ledgerId/unit 均为必填） */
const makeLedgerItem = (overrides: Record<string, any> = {}) => ({
  id: "item_1",
  ledgerId: "KID",
  name: "土豆",
  unit: "斤",
  dailyRecords: {},
  ...overrides
});

/**
 * @description 每个用例前，把 LOCAL_DB_PATH 指向一个全新的临时目录，并动态重新导入模块，
 * 使 StorageService 类定义时读取到的路径绑定到这个隔离的临时目录，避免用例间互相污染磁盘状态
 */
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kpmss-storage-test-"));
  process.env.STORAGE_TYPE = "local";
  process.env.LOCAL_DB_PATH = path.join(tmpDir, "data", "db.json");

  vi.resetModules();
  const mod = await import("./storageService.ts");
  StorageService = mod.StorageService;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.STORAGE_TYPE;
  delete process.env.LOCAL_DB_PATH;
  vi.restoreAllMocks();
});

describe("StorageService (local mode, SQLite-backed, normalized schema)", () => {
  describe("init", () => {
    it("creates the data directory and the backups subdirectory on module load", () => {
      const dataDir = path.dirname(process.env.LOCAL_DB_PATH!);
      expect(fs.existsSync(dataDir)).toBe(true);
      expect(fs.existsSync(path.join(dataDir, "backups"))).toBe(true);
    });

    it("creates the SQLite database file on module load", () => {
      const dataDir = path.dirname(process.env.LOCAL_DB_PATH!);
      expect(fs.existsSync(path.join(dataDir, "kpmss.sqlite"))).toBe(true);
    });
  });

  describe("load", () => {
    it("returns an empty object when no data exists yet (first boot)", async () => {
      const data = await StorageService.load();
      expect(data).toEqual({});
    });

    it("returns the full state after a save, including daily records reattached onto the matching ledgerItem", async () => {
      await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [
          makeLedgerItem({ dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } })
        ]
      });

      const data = await StorageService.load();

      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]);
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toMatchObject({
        inQuantity: 3,
        inPrice: 2,
        inAmount: 6,
        outQuantity: 0
      });
    });

    it("keeps daily records for different items on different dates fully isolated from each other", async () => {
      await StorageService.save({
        ledgerItems: [
          makeLedgerItem({ id: "item_1", dailyRecords: { "2026-07-01": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } } }),
          makeLedgerItem({ id: "item_2", name: "柿子", dailyRecords: { "2026-07-02": { inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 } } })
        ]
      });

      const data = await StorageService.load();
      const item1 = data.ledgerItems.find((i: any) => i.id === "item_1");
      const item2 = data.ledgerItems.find((i: any) => i.id === "item_2");

      expect(item1.dailyRecords["2026-07-01"]).toMatchObject({ inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 });
      expect(Object.keys(item1.dailyRecords)).toEqual(["2026-07-01"]);
      expect(item2.dailyRecords["2026-07-02"]).toMatchObject({ inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 });
      expect(Object.keys(item2.dailyRecords)).toEqual(["2026-07-02"]);
    });

    it("round-trips reports/preparedItems/dailyData correctly (备餐报表这条链路历来完整包含在保存/恢复里)", async () => {
      await StorageService.save({
        reports: [
          {
            targetGroup: "KID",
            year: 2026,
            month: 7,
            items: [
              {
                id: "prep_1",
                name: "土豆",
                category: "VEGETABLE",
                targetGroup: "KID",
                unit: "斤",
                dailyData: { "2026-07-03": { quantity: 5, price: 2, amount: 10 } }
              }
            ]
          }
        ]
      });

      const data = await StorageService.load();

      expect(data.reports).toHaveLength(1);
      expect(data.reports[0]).toMatchObject({ targetGroup: "KID", year: 2026, month: 7 });
      expect(data.reports[0].items[0]).toMatchObject({ id: "prep_1", name: "土豆", category: "VEGETABLE" });
      expect(data.reports[0].items[0].dailyData["2026-07-03"]).toEqual({ quantity: 5, price: 2, amount: 10 });
    });

    it("round-trips activeGroups/activeCategories/rawMaterialsDict/ledgerHelperDict correctly", async () => {
      await StorageService.save({
        activeGroups: [{ key: "KID", label: "幼儿", emoji: "👶", isDefault: true }],
        activeCategories: [{ key: "VEGETABLE", label: "蔬菜", isDefault: true }],
        rawMaterialsDict: [{ name: "土豆", category: "VEGETABLE", unit: "斤", remark: "散装", isDefault: true }],
        ledgerHelperDict: {
          suppliers: ["合作基地直供", "宏发粮油批发"],
          buyers: ["张采购"],
          inspectors: [],
          keepers: [],
          outHandlers: [],
          outRecipients: [],
          sensoryOptions: ["新鲜"],
          shelfLifeOptions: ["3个月"]
        }
      });

      const data = await StorageService.load();

      expect(data.activeGroups).toEqual([{ key: "KID", label: "幼儿", emoji: "👶", isDefault: true }]);
      expect(data.activeCategories).toEqual([{ key: "VEGETABLE", label: "蔬菜", isDefault: true }]);
      expect(data.rawMaterialsDict[0]).toMatchObject({ name: "土豆", category: "VEGETABLE", unit: "斤", remark: "散装", isDefault: true });
      // suppliers 顺序必须与写入顺序一致（sort_order 保留管理员维护的原始排列）
      expect(data.ledgerHelperDict.suppliers).toEqual(["合作基地直供", "宏发粮油批发"]);
      expect(data.ledgerHelperDict.sensoryOptions).toEqual(["新鲜"]);
      expect(data.ledgerHelperDict.inspectors).toEqual([]);
    });
  });

  describe("save", () => {
    it("strips ledgerItems' dailyRecords out of the skeleton but preserves them via the reassembled daily-records table", async () => {
      const success = await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [makeLedgerItem({ dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } })]
      });

      expect(success).toBe(true);
      const data = await StorageService.load();
      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]);
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toBeDefined();
    });

    it("creates a timestamped JSON backup snapshot alongside every save", async () => {
      await StorageService.save({ ledgers: [] });

      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith("db_") && f.endsWith(".json"));
      expect(backups.length).toBe(1);
    });

    it("round-trips a full save-then-load cycle correctly, including daily records", async () => {
      await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [makeLedgerItem({ dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } })]
      });

      const reloaded = await StorageService.load();

      expect(reloaded.ledgers).toEqual([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]);
      expect(reloaded.ledgerItems[0].dailyRecords["2026-07-03"]).toMatchObject({
        inQuantity: 3,
        inPrice: 2,
        inAmount: 6,
        outQuantity: 0
      });
    });

    it("REGRESSION: a daily record removed from the payload is correctly gone after the next save (no orphaned resurrection)", async () => {
      await StorageService.save({
        ledgerItems: [makeLedgerItem({ dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } })]
      });
      let data = await StorageService.load();
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toBeDefined();

      // 客户端已经删除了该日期的记录，再次保存时该条目不再出现在 payload 里
      await StorageService.save({ ledgerItems: [makeLedgerItem({ dailyRecords: {} })] });
      data = await StorageService.load();

      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toBeUndefined();
      expect(data.ledgerItems[0].dailyRecords).toEqual({});
    });
  });

  describe("[V5.85.0] SQLite transaction atomicity (真实事务回滚，规范化多表写入同样全部包在一个事务里)", () => {
    it("leaves no leftover .tmp- temp files after a normal save (backup snapshot is still written atomically)", async () => {
      await StorageService.save({ ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }] });

      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const leftoverTemp = fs.readdirSync(backupDir).filter((f) => f.includes(".tmp-"));
      expect(leftoverTemp).toEqual([]);
    });

    it("REGRESSION: a save() that fails partway through the SQLite transaction rolls back entirely — no partial writes survive", async () => {
      await StorageService.save({
        ledgers: [{ id: "ORIGINAL", name: "原始数据", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [makeLedgerItem({ dailyRecords: { "2026-07-01": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } } })]
      });

      // 构造一个会在事务中途触发 SQLite NOT NULL 约束冲突的畸形 payload（第二个原料项缺少必填的 ledgerId），
      // 验证 SQLite 事务"要么全部生效、要么全部回滚"的特性：即便 item_2 排在前面先被处理，
      // 整个事务（含 ledgers 骨架覆盖）仍会完整回滚，不会留下任何"改了一半"的中间状态
      const success = await StorageService.save({
        ledgers: [{ id: "SHOULD_NOT_PERSIST", name: "不应生效", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [
          makeLedgerItem({ id: "item_2", name: "柿子", dailyRecords: {} }),
          { id: "item_3", ledgerId: null, name: "非法条目", unit: "斤", dailyRecords: {} }
        ]
      });

      expect(success).toBe(false);
      const data = await StorageService.load();
      expect(data.ledgers).toEqual([{ id: "ORIGINAL", name: "原始数据", createdAt: "2026-01-01T00:00:00.000Z" }]);
      expect(data.ledgerItems.find((i: any) => i.id === "item_1")).toBeDefined();
      expect(data.ledgerItems.find((i: any) => i.id === "item_2")).toBeUndefined();
    });

    it("REGRESSION: concurrent save() calls never interleave — the final state always matches one complete payload, never a corrupted mix", async () => {
      const [resultA, resultB] = await Promise.all([
        StorageService.save({ ledgers: [{ id: "A", name: "台账A", createdAt: "2026-01-01T00:00:00.000Z" }] }),
        StorageService.save({ ledgers: [{ id: "B", name: "台账B", createdAt: "2026-01-01T00:00:00.000Z" }] })
      ]);

      expect(resultA).toBe(true);
      expect(resultB).toBe(true);

      const finalData = await StorageService.load();
      const matchesA = finalData.ledgers[0]?.id === "A";
      const matchesB = finalData.ledgers[0]?.id === "B";
      expect(matchesA || matchesB).toBe(true);
      expect(finalData.ledgers).toHaveLength(1);
    });
  });

  describe("write lock (internal mutex serializes save()/restore())", () => {
    it("serializes queued tasks so a later task never starts running before an earlier one finishes", async () => {
      const order: string[] = [];
      const slowTask = async () => {
        order.push("A-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push("A-end");
      };
      const fastTask = async () => {
        order.push("B-start");
        order.push("B-end");
      };

      const withWriteLock = (StorageService as any).withWriteLock.bind(StorageService);
      const pA = withWriteLock(slowTask);
      const pB = withWriteLock(fastTask);
      await Promise.all([pA, pB]);

      // 即便 B 任务本身瞬间完成，也必须等 A 任务（含其内部 30ms 延迟）完全结束后才能开始执行
      expect(order).toEqual(["A-start", "A-end", "B-start", "B-end"]);
    });

    it("still runs a queued task even if an earlier queued task throws (the lock is released on failure, not just success)", async () => {
      const order: string[] = [];
      const failingTask = async () => {
        order.push("fail-start");
        throw new Error("模拟前一个任务失败");
      };
      const nextTask = async () => {
        order.push("next-ran");
      };

      const withWriteLock = (StorageService as any).withWriteLock.bind(StorageService);
      const pFail = withWriteLock(failingTask).catch(() => {});
      const pNext = withWriteLock(nextTask);
      await Promise.all([pFail, pNext]);

      expect(order).toEqual(["fail-start", "next-ran"]);
    });
  });

  describe("getBackups", () => {
    it("returns an empty array when no backups exist and the backups dir was never touched by a save", async () => {
      const backups = await StorageService.getBackups();
      expect(backups).toEqual([]);
    });

    it("lists backup filenames sorted from newest to oldest", async () => {
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      fs.writeFileSync(path.join(backupDir, "db_2026-07-01T00-00-00-000Z.json"), "{}");
      fs.writeFileSync(path.join(backupDir, "db_2026-07-03T00-00-00-000Z.json"), "{}");
      fs.writeFileSync(path.join(backupDir, "db_2026-07-02T00-00-00-000Z.json"), "{}");

      const backups = await StorageService.getBackups();

      expect(backups).toEqual([
        "db_2026-07-03T00-00-00-000Z.json",
        "db_2026-07-02T00-00-00-000Z.json",
        "db_2026-07-01T00-00-00-000Z.json"
      ]);
    });
  });

  describe("trimLocalBackups (retention policy, invoked internally by save)", () => {
    it("keeps at most the 30 most recent backups, deleting the oldest ones beyond that", async () => {
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      // 预先手工构造 32 份"旧"备份文件（时间戳递增，确保排序稳定）
      for (let i = 0; i < 32; i++) {
        const ts = `2026-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z`;
        fs.writeFileSync(path.join(backupDir, `db_${ts}.json`), "{}");
      }

      // 触发一次真实 save()，内部会在写完新快照后调用 trimLocalBackups()
      await StorageService.save({ ledgers: [] });

      const remaining = fs.readdirSync(backupDir).filter((f) => f.startsWith("db_") && f.endsWith(".json"));
      expect(remaining.length).toBe(30);
      // 最早的两份（01-01、01-02）应已被清理
      expect(remaining).not.toContain("db_2026-01-01T00-00-00-000Z.json");
      expect(remaining).not.toContain("db_2026-01-02T00-00-00-000Z.json");
    });
  });

  describe("restore", () => {
    it("overwrites the skeleton fields with the content of the given backup and returns the fully reassembled data", async () => {
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const backupContent = JSON.stringify({ ledgers: [{ id: "RESTORED", name: "已恢复", createdAt: "2026-01-01T00:00:00.000Z" }] });
      fs.writeFileSync(path.join(backupDir, "db_2026-07-01T00-00-00-000Z.json"), backupContent);

      const result = await StorageService.restore("db_2026-07-01T00-00-00-000Z.json");

      expect(result.ledgers).toEqual([{ id: "RESTORED", name: "已恢复", createdAt: "2026-01-01T00:00:00.000Z" }]);
      const reloaded = await StorageService.load();
      expect(reloaded.ledgers).toEqual([{ id: "RESTORED", name: "已恢复", createdAt: "2026-01-01T00:00:00.000Z" }]);
    });

    it("REGRESSION: restoring a skeleton-only backup never clears the daily records currently in effect", async () => {
      // 备份快照本身从不包含台账每日流水（与迁移前的既有限制保持一致）；恢复时绝不能把当前生效中的
      // ledger_item_daily_records 一并清空，否则会造成比历史版本更严重的数据丢失回归
      await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [makeLedgerItem({ dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } })]
      });
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const backupName = fs.readdirSync(backupDir).find((f) => f.startsWith("db_"))!;

      const result = await StorageService.restore(backupName);

      expect(result.ledgerItems[0].dailyRecords["2026-07-03"]).toMatchObject({
        inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0
      });
    });

    it("returns null when the requested backup file does not exist", async () => {
      const result = await StorageService.restore("db_2099-01-01T00-00-00-000Z.json");
      expect(result).toBeNull();
    });

    it("SECURITY REGRESSION: rejects a path-traversal backupName and does not touch any file outside the backups directory or import any data", async () => {
      // 在备份目录之外放一个"敏感文件"作为穿越目标，验证它绝对不会被读取或覆盖
      const sensitiveFile = path.join(tmpDir, "sensitive.txt");
      fs.writeFileSync(sensitiveFile, "top-secret-content");
      const sensitiveContentBefore = fs.readFileSync(sensitiveFile, "utf8");

      const result = await StorageService.restore("../../sensitive.txt");

      expect(result).toBeNull();
      // 目标敏感文件内容必须完全未被改动
      expect(fs.readFileSync(sensitiveFile, "utf8")).toBe(sensitiveContentBefore);
      // 非法请求不应向 SQLite 导入任何数据
      expect(await StorageService.load()).toEqual({});
    });

    it("SECURITY REGRESSION: rejects a backupName containing a forward slash even without '..'", async () => {
      const result = await StorageService.restore("subdir/db_evil.json");
      expect(result).toBeNull();
    });

    it("still accepts a legitimate backup filename matching the expected db_<timestamp>.json pattern", async () => {
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      fs.writeFileSync(
        path.join(backupDir, "db_2026-07-03T08-52-47-296Z.json"),
        JSON.stringify({ ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }] })
      );

      const result = await StorageService.restore("db_2026-07-03T08-52-47-296Z.json");

      expect(result.ledgers).toEqual([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]);
    });

    it("KNOWN EDGE CASE: restoring a backup whose content is entirely empty across every entity is indistinguishable from first-boot and returns {} rather than an all-empty-arrays shape", async () => {
      // 规范化表结构按"每个业务实体一行"存储，而非阶段一那种"每个顶层 key 固定占一行"的 kv_store 形态；
      // 因此"数据库彻底没有任何数据"和"曾经保存过一份内容全为空数组的状态"在规范化表结构下无法区分。
      // 这只影响"恢复一份从未真正录入过任何数据的空白备份"这一极端场景（现实中不会有业务需要这么做），
      // 对真实使用场景（保存过任意一条真实数据）没有影响，此处作为已知行为差异记录下来，避免日后被误当作 bug。
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      fs.writeFileSync(path.join(backupDir, "db_2026-07-04T00-00-00-000Z.json"), JSON.stringify({ ledgers: [] }));

      const result = await StorageService.restore("db_2026-07-04T00-00-00-000Z.json");

      expect(result).toEqual({});
    });
  });

  describe("[V5.85.0] one-time migration to the normalized schema", () => {
    it("automatically migrates an existing legacy db.json + per-day split files (earliest storage format) directly into the normalized tables", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(dbPath, JSON.stringify({
        ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }],
        ledgerItems: [{ id: "item_1", ledgerId: "KID", name: "土豆", unit: "斤", dailyRecords: {} }]
      }), "utf8");
      const dailyDayPath = path.join(path.dirname(dbPath), "ledgers", "daily", "2026", "07");
      fs.mkdirSync(dailyDayPath, { recursive: true });
      fs.writeFileSync(
        path.join(dailyDayPath, "03.json"),
        JSON.stringify({ item_1: { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } }),
        "utf8"
      );

      // 重新动态 import，让全新的模块实例的 init() 检测到磁盘上的最早版本文件并触发一次性迁移
      vi.resetModules();
      const mod = await import("./storageService.ts");
      const MigratedStorageService = mod.StorageService;

      const data = await MigratedStorageService.load();

      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]);
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toMatchObject({
        inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0
      });
    });

    it("automatically migrates stage-1 (shallow migration) kv_store data into the normalized tables when upgrading from that version", async () => {
      // 手工模拟阶段一遗留的 kv_store + daily_records（JSON 文本块）表结构，验证从阶段一升级到阶段二同样能自动迁移
      const db = (StorageService as any).getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS daily_records (item_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (item_id, date));
      `);
      const upsertKv = db.prepare("INSERT INTO kv_store (key, value) VALUES (?, ?)");
      upsertKv.run("ledgers", JSON.stringify([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]));
      upsertKv.run("ledgerItems", JSON.stringify([{ id: "item_1", ledgerId: "KID", name: "土豆", unit: "斤" }]));
      for (const key of ["reports", "activeGroups", "activeCategories", "rawMaterialsDict"]) {
        upsertKv.run(key, JSON.stringify([]));
      }
      upsertKv.run("ledgerHelperDict", JSON.stringify({
        suppliers: [], buyers: [], inspectors: [], keepers: [], outHandlers: [], outRecipients: [], sensoryOptions: [], shelfLifeOptions: []
      }));
      db.prepare("INSERT INTO daily_records (item_id, date, data) VALUES (?, ?, ?)").run(
        "item_1", "2026-07-03", JSON.stringify({ inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 })
      );

      vi.resetModules();
      const mod = await import("./storageService.ts");
      const MigratedStorageService = mod.StorageService;

      const data = await MigratedStorageService.load();

      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }]);
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toMatchObject({
        inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0
      });
    });

    it("does not re-run the migration (and does not let stale legacy content overwrite newer data) once the normalized tables already have data", async () => {
      await StorageService.save({ ledgers: [{ id: "NEW", name: "新数据", createdAt: "2026-01-01T00:00:00.000Z" }] });

      // 模拟磁盘上仍残留着一份内容不同的最早版本 db.json（迁移完成后本就不会被删除）
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(dbPath, JSON.stringify({ ledgers: [{ id: "STALE", name: "旧数据不应生效", createdAt: "2020-01-01T00:00:00.000Z" }] }), "utf8");

      vi.resetModules();
      const mod = await import("./storageService.ts");
      const data = await mod.StorageService.load();

      expect(data.ledgers).toEqual([{ id: "NEW", name: "新数据", createdAt: "2026-01-01T00:00:00.000Z" }]);
    });

    it("does not delete or modify the original db.json after migrating it, keeping it as a manual fallback", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      const legacyContent = JSON.stringify({ ledgers: [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }] });
      fs.writeFileSync(dbPath, legacyContent, "utf8");

      vi.resetModules();
      const mod = await import("./storageService.ts");
      await mod.StorageService.load();

      expect(fs.existsSync(dbPath)).toBe(true);
      expect(fs.readFileSync(dbPath, "utf8")).toBe(legacyContent);
    });

    it("does nothing (no crash, empty state) on a genuinely fresh install with no data of any kind", async () => {
      const data = await StorageService.load();
      expect(data).toEqual({});
    });
  });
});
