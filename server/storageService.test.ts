/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description StorageService（本地 SQLite 持久化服务，阶段一浅迁移见 SQLite迁移规划.md）单元测试：主数据读写往返、
 * 每日流水的存储与重组（含"删除后不应复活"的历史遗留 bug 回归）、损坏/首次启动状态容错、备份快照生成与保留策略裁剪、
 * 快照恢复（骨架字段覆盖但绝不清空当前生效中的每日流水）、restore() 的备份文件名安全校验（防路径穿越）、
 * 原子写入与写入锁、以及从旧版纯 JSON 文件存储一次性自动迁移的回归测试。测试通过临时目录 + 动态重新导入模块实现
 * 相互隔离，因为 StorageService 在类定义时就从 process.env 读取路径并缓存为 private static 字段，运行期不会重新读取。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let StorageService: any;

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

describe("StorageService (local mode, SQLite-backed)", () => {
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
        ledgers: [{ id: "KID", name: "幼儿备餐" }],
        ledgerItems: [
          { id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } }
        ]
      });

      const data = await StorageService.load();

      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐" }]);
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toEqual({
        inQuantity: 3,
        inPrice: 2,
        inAmount: 6,
        outQuantity: 0
      });
    });

    it("keeps daily records for different items on different dates fully isolated from each other", async () => {
      await StorageService.save({
        ledgerItems: [
          { id: "item_1", name: "土豆", dailyRecords: { "2026-07-01": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } } },
          { id: "item_2", name: "柿子", dailyRecords: { "2026-07-02": { inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 } } }
        ]
      });

      const data = await StorageService.load();

      expect(data.ledgerItems[0].dailyRecords).toEqual({ "2026-07-01": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } });
      expect(data.ledgerItems[1].dailyRecords).toEqual({ "2026-07-02": { inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 } });
    });
  });

  describe("save", () => {
    it("strips ledgerItems' dailyRecords out of the skeleton but preserves them via the reassembled daily_records table", async () => {
      const success = await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐" }],
        ledgerItems: [{ id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } }]
      });

      expect(success).toBe(true);
      const data = await StorageService.load();
      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐" }]);
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
        ledgers: [{ id: "KID", name: "幼儿备餐" }],
        ledgerItems: [
          { id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } }
        ]
      });

      const reloaded = await StorageService.load();

      expect(reloaded.ledgers).toEqual([{ id: "KID", name: "幼儿备餐" }]);
      expect(reloaded.ledgerItems[0].dailyRecords["2026-07-03"]).toEqual({
        inQuantity: 3,
        inPrice: 2,
        inAmount: 6,
        outQuantity: 0
      });
    });

    it("REGRESSION: a daily record removed from the payload is correctly gone after the next save (no orphaned resurrection)", async () => {
      // 旧版按天拆分文件的实现里，若某天最后一条记录被删除，对应的日文件永远不会被清理，
      // 下次 load() 时又会被错误"复活"。新版 daily_records 表每次 save() 都整体重建，天然不存在孤儿数据
      await StorageService.save({
        ledgerItems: [
          { id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } }
        ]
      });
      let data = await StorageService.load();
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toBeDefined();

      // 客户端已经删除了该日期的记录，再次保存时该条目不再出现在 payload 里
      await StorageService.save({
        ledgerItems: [{ id: "item_1", name: "土豆", dailyRecords: {} }]
      });
      data = await StorageService.load();

      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toBeUndefined();
      expect(data.ledgerItems[0].dailyRecords).toEqual({});
    });
  });

  describe("[V5.84.0] SQLite transaction atomicity (真实事务回滚，取代旧版文件级 rename 原子性)", () => {
    it("leaves no leftover .tmp- temp files after a normal save (backup snapshot is still written atomically)", async () => {
      await StorageService.save({ ledgers: [{ id: "KID", name: "幼儿备餐" }] });

      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const leftoverTemp = fs.readdirSync(backupDir).filter((f) => f.includes(".tmp-"));
      expect(leftoverTemp).toEqual([]);
    });

    it("REGRESSION: a save() that fails partway through the SQLite transaction rolls back entirely — no partial writes survive", async () => {
      await StorageService.save({
        ledgers: [{ id: "ORIGINAL", name: "原始数据" }],
        ledgerItems: [{ id: "item_1", name: "土豆", dailyRecords: { "2026-07-01": { inQuantity: 1, inPrice: 1, inAmount: 1, outQuantity: 0 } } }]
      });

      // 构造一个会在事务中途触发 SQLite NOT NULL 约束冲突的畸形 payload（item.id 为 null），
      // 验证 SQLite 事务"要么全部生效、要么全部回滚"的特性：即便 item_2 排在 item_1 之后先被处理，
      // 整个事务仍会完整回滚，不会留下任何"改了一半"的中间状态
      const success = await StorageService.save({
        ledgers: [{ id: "SHOULD_NOT_PERSIST", name: "不应生效" }],
        ledgerItems: [
          { id: "item_2", name: "柿子", dailyRecords: { "2026-07-02": { inQuantity: 2, inPrice: 2, inAmount: 4, outQuantity: 0 } } },
          { id: null, name: "非法条目", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 3, inAmount: 9, outQuantity: 0 } } }
        ]
      });

      expect(success).toBe(false);
      const data = await StorageService.load();
      expect(data.ledgers).toEqual([{ id: "ORIGINAL", name: "原始数据" }]);
      expect(data.ledgerItems.find((i: any) => i.id === "item_1")).toBeDefined();
      expect(data.ledgerItems.find((i: any) => i.id === "item_2")).toBeUndefined();
    });

    it("REGRESSION: concurrent save() calls never interleave — the final state always matches one complete payload, never a corrupted mix", async () => {
      const [resultA, resultB] = await Promise.all([
        StorageService.save({ ledgers: [{ id: "A", name: "台账A" }] }),
        StorageService.save({ ledgers: [{ id: "B", name: "台账B" }] })
      ]);

      expect(resultA).toBe(true);
      expect(resultB).toBe(true);

      const finalData = await StorageService.load();
      const matchesA = JSON.stringify(finalData.ledgers) === JSON.stringify([{ id: "A", name: "台账A" }]);
      const matchesB = JSON.stringify(finalData.ledgers) === JSON.stringify([{ id: "B", name: "台账B" }]);
      expect(matchesA || matchesB).toBe(true);
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
      const backupContent = JSON.stringify({ ledgers: [{ id: "RESTORED", name: "已恢复" }] });
      fs.writeFileSync(path.join(backupDir, "db_2026-07-01T00-00-00-000Z.json"), backupContent);

      const result = await StorageService.restore("db_2026-07-01T00-00-00-000Z.json");

      expect(result.ledgers).toEqual([{ id: "RESTORED", name: "已恢复" }]);
      const reloaded = await StorageService.load();
      expect(reloaded.ledgers).toEqual([{ id: "RESTORED", name: "已恢复" }]);
    });

    it("REGRESSION: restoring a skeleton-only backup never clears the daily records currently in effect", async () => {
      // 备份快照本身从不包含每日流水（与迁移前的既有限制保持一致）；恢复时绝不能把当前生效中的
      // daily_records 一并清空，否则会造成比旧版更严重的数据丢失回归
      await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐" }],
        ledgerItems: [
          { id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } }
        ]
      });
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const backupName = fs.readdirSync(backupDir).find((f) => f.startsWith("db_"))!;

      const result = await StorageService.restore(backupName);

      expect(result.ledgerItems[0].dailyRecords["2026-07-03"]).toEqual({
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
      fs.writeFileSync(path.join(backupDir, "db_2026-07-03T08-52-47-296Z.json"), JSON.stringify({ ledgers: [] }));

      const result = await StorageService.restore("db_2026-07-03T08-52-47-296Z.json");

      expect(result.ledgers).toEqual([]);
    });
  });

  describe("[V5.84.0] one-time legacy JSON migration (on init)", () => {
    it("automatically migrates an existing legacy db.json + per-day split files into SQLite on first init", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(dbPath, JSON.stringify({
        ledgers: [{ id: "KID", name: "幼儿备餐" }],
        ledgerItems: [{ id: "item_1", name: "土豆", dailyRecords: {} }]
      }), "utf8");
      const dailyDayPath = path.join(path.dirname(dbPath), "ledgers", "daily", "2026", "07");
      fs.mkdirSync(dailyDayPath, { recursive: true });
      fs.writeFileSync(
        path.join(dailyDayPath, "03.json"),
        JSON.stringify({ item_1: { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } }),
        "utf8"
      );

      // 重新动态 import，让全新的模块实例的 init() 检测到磁盘上的旧版文件并触发一次性迁移
      vi.resetModules();
      const mod = await import("./storageService.ts");
      const MigratedStorageService = mod.StorageService;

      const data = await MigratedStorageService.load();

      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐" }]);
      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toEqual({
        inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0
      });
    });

    it("does not re-run the migration (and does not let stale db.json content overwrite newer SQLite data) once SQLite already has data", async () => {
      await StorageService.save({ ledgers: [{ id: "NEW", name: "新数据" }] });

      // 模拟磁盘上仍残留着一份内容不同的旧版 db.json（迁移完成后本就不会被删除）
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(dbPath, JSON.stringify({ ledgers: [{ id: "STALE", name: "旧数据不应生效" }] }), "utf8");

      vi.resetModules();
      const mod = await import("./storageService.ts");
      const data = await mod.StorageService.load();

      expect(data.ledgers).toEqual([{ id: "NEW", name: "新数据" }]);
    });

    it("does not delete or modify the original db.json after migrating it, keeping it as a manual fallback", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      const legacyContent = JSON.stringify({ ledgers: [{ id: "KID", name: "幼儿备餐" }] });
      fs.writeFileSync(dbPath, legacyContent, "utf8");

      vi.resetModules();
      const mod = await import("./storageService.ts");
      await mod.StorageService.load();

      expect(fs.existsSync(dbPath)).toBe(true);
      expect(fs.readFileSync(dbPath, "utf8")).toBe(legacyContent);
    });

    it("does nothing (no crash, empty state) on a genuinely fresh install with neither SQLite data nor a legacy db.json", async () => {
      const data = await StorageService.load();
      expect(data).toEqual({});
    });
  });
});
