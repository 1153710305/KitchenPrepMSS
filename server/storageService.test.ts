/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description StorageService（本地文件持久化服务）单元测试：主数据文件读写往返、台账逐日流水拆分与合并、损坏 JSON 容错跳过、备份快照生成与保留策略裁剪、
 * 快照恢复，以及针对 restore() 新增的备份文件名安全校验（防路径穿越）的回归测试。测试通过临时目录 + 动态重新导入模块实现相互隔离，因为
 * StorageService 在类定义时就从 process.env 读取路径并缓存为 private static 字段，运行期不会重新读取。
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

describe("StorageService (local mode)", () => {
  describe("init", () => {
    it("creates the data directory and the backups subdirectory on module load", () => {
      const dataDir = path.dirname(process.env.LOCAL_DB_PATH!);
      expect(fs.existsSync(dataDir)).toBe(true);
      expect(fs.existsSync(path.join(dataDir, "backups"))).toBe(true);
    });
  });

  describe("load", () => {
    it("returns an empty object when no db.json file exists yet (first boot)", async () => {
      const data = await StorageService.load();
      expect(data).toEqual({});
    });

    it("returns the parsed JSON content when a valid db.json exists", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(dbPath, JSON.stringify({ ledgers: [{ id: "KID", name: "幼儿备餐" }] }), "utf8");

      const data = await StorageService.load();

      expect(data.ledgers).toEqual([{ id: "KID", name: "幼儿备餐" }]);
    });

    it("gracefully returns an empty object when db.json contains malformed JSON", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, "{ not valid json !!", "utf8");

      const data = await StorageService.load();

      expect(data).toEqual({});
    });

    it("merges per-day split ledger records back onto their matching ledgerItems by id", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(
        dbPath,
        JSON.stringify({ ledgerItems: [{ id: "item_1", name: "土豆", dailyRecords: {} }] }),
        "utf8"
      );
      const dailyDayPath = path.join(path.dirname(dbPath), "ledgers", "daily", "2026", "07");
      fs.mkdirSync(dailyDayPath, { recursive: true });
      fs.writeFileSync(
        path.join(dailyDayPath, "03.json"),
        JSON.stringify({ item_1: { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } }),
        "utf8"
      );

      const data = await StorageService.load();

      expect(data.ledgerItems[0].dailyRecords["2026-07-03"]).toEqual({
        inQuantity: 3,
        inPrice: 2,
        inAmount: 6,
        outQuantity: 0
      });
    });

    it("skips a corrupted per-day file without failing the entire load", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      fs.writeFileSync(
        dbPath,
        JSON.stringify({
          ledgerItems: [
            { id: "item_1", name: "土豆", dailyRecords: {} },
            { id: "item_2", name: "柿子", dailyRecords: {} }
          ]
        }),
        "utf8"
      );
      const dailyDayPath = path.join(path.dirname(dbPath), "ledgers", "daily", "2026", "07");
      fs.mkdirSync(dailyDayPath, { recursive: true });
      // item_1 当天文件损坏
      fs.writeFileSync(path.join(dailyDayPath, "01.json"), "{ corrupted", "utf8");
      // item_2 当天文件正常
      fs.writeFileSync(
        path.join(dailyDayPath, "02.json"),
        JSON.stringify({ item_2: { inQuantity: 5, inPrice: 1, inAmount: 5, outQuantity: 0 } }),
        "utf8"
      );

      const data = await StorageService.load();

      expect(data.ledgerItems[0].dailyRecords).toEqual({});
      expect(data.ledgerItems[1].dailyRecords["2026-07-02"]).toBeDefined();
    });
  });

  describe("save", () => {
    it("writes the config skeleton to db.json with ledgerItems' dailyRecords stripped out", async () => {
      const success = await StorageService.save({
        ledgers: [{ id: "KID", name: "幼儿备餐" }],
        ledgerItems: [{ id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3 } } }]
      });

      expect(success).toBe(true);
      const raw = JSON.parse(fs.readFileSync(process.env.LOCAL_DB_PATH!, "utf8"));
      expect(raw.ledgers).toEqual([{ id: "KID", name: "幼儿备餐" }]);
      expect(raw.ledgerItems[0].dailyRecords).toEqual({});
    });

    it("splits ledgerItems' dailyRecords out into per-day YYYY/MM/DD.json files", async () => {
      await StorageService.save({
        ledgerItems: [
          { id: "item_1", name: "土豆", dailyRecords: { "2026-07-03": { inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 } } }
        ]
      });

      const dayFile = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "ledgers", "daily", "2026", "07", "03.json");
      expect(fs.existsSync(dayFile)).toBe(true);
      const dayContent = JSON.parse(fs.readFileSync(dayFile, "utf8"));
      expect(dayContent.item_1).toEqual({ inQuantity: 3, inPrice: 2, inAmount: 6, outQuantity: 0 });
    });

    it("creates a timestamped backup snapshot alongside the main file", async () => {
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
  });

  describe("[V5.82.0] atomic writes (crash-safety)", () => {
    it("leaves no leftover .tmp- temp files in the data directory after a normal save", async () => {
      await StorageService.save({ ledgers: [{ id: "KID", name: "幼儿备餐" }] });

      const dataDir = path.dirname(process.env.LOCAL_DB_PATH!);
      const leftoverTemp = fs.readdirSync(dataDir).filter((f) => f.includes(".tmp-"));
      expect(leftoverTemp).toEqual([]);
    });

    it("REGRESSION: does not touch/corrupt the existing db.json if the write is interrupted before the atomic rename", async () => {
      const dbPath = process.env.LOCAL_DB_PATH!;
      const originalContent = JSON.stringify({ ledgers: [{ id: "ORIGINAL", name: "原始数据" }] });
      fs.writeFileSync(dbPath, originalContent, "utf8");

      // 模拟"进程崩溃/断电恰好发生在写临时文件阶段"：第一次 fs.writeFileSync 调用（写入临时文件）直接抛错，
      // renameSync 永远不会被执行到，验证原始 db.json 绝不会被替换成一份不完整的内容
      const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
        throw new Error("模拟磁盘写入中断");
      });

      const success = await StorageService.save({ ledgers: [{ id: "NEW", name: "新数据" }] });

      expect(success).toBe(false);
      expect(fs.readFileSync(dbPath, "utf8")).toBe(originalContent);
      writeSpy.mockRestore();
    });

    it("REGRESSION: concurrent save() calls never interleave — the final db.json always matches one complete payload, never a corrupted mix", async () => {
      const [resultA, resultB] = await Promise.all([
        StorageService.save({ ledgers: [{ id: "A", name: "台账A" }] }),
        StorageService.save({ ledgers: [{ id: "B", name: "台账B" }] })
      ]);

      expect(resultA).toBe(true);
      expect(resultB).toBe(true);

      const finalContent = JSON.parse(fs.readFileSync(process.env.LOCAL_DB_PATH!, "utf8"));
      const matchesA = JSON.stringify(finalContent.ledgers) === JSON.stringify([{ id: "A", name: "台账A" }]);
      const matchesB = JSON.stringify(finalContent.ledgers) === JSON.stringify([{ id: "B", name: "台账B" }]);
      expect(matchesA || matchesB).toBe(true);
    });
  });

  describe("[V5.82.0] write lock (internal mutex serializes save()/restore())", () => {
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
    it("overwrites the main db.json with the content of the given backup and returns the parsed data", async () => {
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      const backupContent = JSON.stringify({ ledgers: [{ id: "RESTORED", name: "已恢复" }] });
      fs.writeFileSync(path.join(backupDir, "db_2026-07-01T00-00-00-000Z.json"), backupContent);

      const result = await StorageService.restore("db_2026-07-01T00-00-00-000Z.json");

      expect(result.ledgers).toEqual([{ id: "RESTORED", name: "已恢复" }]);
      const mainFileContent = JSON.parse(fs.readFileSync(process.env.LOCAL_DB_PATH!, "utf8"));
      expect(mainFileContent.ledgers).toEqual([{ id: "RESTORED", name: "已恢复" }]);
    });

    it("returns null when the requested backup file does not exist", async () => {
      const result = await StorageService.restore("db_2099-01-01T00-00-00-000Z.json");
      expect(result).toBeNull();
    });

    it("SECURITY REGRESSION: rejects a path-traversal backupName and does not touch any file outside the backups directory", async () => {
      // 在备份目录之外放一个"敏感文件"作为穿越目标，验证它绝对不会被读取或覆盖
      const sensitiveFile = path.join(tmpDir, "sensitive.txt");
      fs.writeFileSync(sensitiveFile, "top-secret-content");
      const sensitiveContentBefore = fs.readFileSync(sensitiveFile, "utf8");

      const result = await StorageService.restore("../../sensitive.txt");

      expect(result).toBeNull();
      // 主数据库文件不应该被这次非法请求写入任何内容
      expect(fs.existsSync(process.env.LOCAL_DB_PATH!)).toBe(false);
      // 目标敏感文件内容必须完全未被改动
      expect(fs.readFileSync(sensitiveFile, "utf8")).toBe(sensitiveContentBefore);
    });

    it("SECURITY REGRESSION: rejects a backupName containing a forward slash even without '..'", async () => {
      const result = await StorageService.restore("subdir/db_evil.json");
      expect(result).toBeNull();
    });

    it("still accepts a legitimate backup filename matching the expected db_<timestamp>.json pattern", async () => {
      const backupDir = path.join(path.dirname(process.env.LOCAL_DB_PATH!), "backups");
      fs.writeFileSync(path.join(backupDir, "db_2026-07-03T08-52-47-296Z.json"), JSON.stringify({ ledgers: [] }));

      const result = await StorageService.restore("db_2026-07-03T08-52-47-296Z.json");

      expect(result).toEqual({ ledgers: [] });
    });
  });
});
