/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description utils.ts 通用工具函数集合的单元测试：日期计算、拼音模糊匹配、金额计算、月度汇总、CSV 导出、LogBroker 发布订阅。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDaysInMonth,
  getDatesBetween,
  matchPinyin,
  getItemMonthlySummary,
  createSystemLog,
  convertItemsToCsv,
  LogBroker
} from "@/src/utils.ts";
import { PreparedItem, FoodCategory, TargetGroup } from "@/src/types/types.ts";

describe("getDaysInMonth", () => {
  it("returns 31 days for January", () => {
    expect(getDaysInMonth(2026, 1)).toHaveLength(31);
    expect(getDaysInMonth(2026, 1)[0]).toBe("1");
    expect(getDaysInMonth(2026, 1)[30]).toBe("31");
  });

  it("returns 28 days for February in a non-leap year", () => {
    expect(getDaysInMonth(2026, 2)).toHaveLength(28);
  });

  it("returns 29 days for February in a leap year", () => {
    expect(getDaysInMonth(2024, 2)).toHaveLength(29);
  });

  it("returns 30 days for April", () => {
    expect(getDaysInMonth(2026, 4)).toHaveLength(30);
  });
});

describe("getDatesBetween", () => {
  it("returns a single date when start equals end", () => {
    expect(getDatesBetween("2026-07-03", "2026-07-03")).toEqual(["2026-07-03"]);
  });

  it("returns an inclusive range across days", () => {
    expect(getDatesBetween("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03"
    ]);
  });

  it("crosses a month boundary correctly", () => {
    const dates = getDatesBetween("2026-06-29", "2026-07-02");
    expect(dates).toEqual(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]);
  });

  it("crosses a year boundary correctly", () => {
    const dates = getDatesBetween("2025-12-30", "2026-01-02");
    expect(dates).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });

  it("returns an empty array when either date is missing", () => {
    expect(getDatesBetween("", "2026-07-03")).toEqual([]);
    expect(getDatesBetween("2026-07-03", "")).toEqual([]);
  });

  it("returns an empty array when either date is invalid", () => {
    expect(getDatesBetween("not-a-date", "2026-07-03")).toEqual([]);
    expect(getDatesBetween("2026-07-03", "not-a-date")).toEqual([]);
  });

  it("returns an empty array when start is after end", () => {
    expect(getDatesBetween("2026-07-05", "2026-07-01")).toEqual([]);
  });
});

describe("matchPinyin", () => {
  it("matches on empty query (matches everything)", () => {
    expect(matchPinyin("大米", "")).toBe(true);
    expect(matchPinyin("大米", "   ")).toBe(true);
  });

  it("matches literal Chinese substring", () => {
    expect(matchPinyin("大米", "大米")).toBe(true);
    expect(matchPinyin("大米粥", "大米")).toBe(true);
  });

  it("matches full pinyin", () => {
    expect(matchPinyin("大米", "dami")).toBe(true);
  });

  it("matches pinyin first-letter abbreviation", () => {
    expect(matchPinyin("大米", "dm")).toBe(true);
  });

  it("is case-insensitive for the query", () => {
    expect(matchPinyin("大米", "DM")).toBe(true);
  });

  it("returns false for a non-matching query", () => {
    expect(matchPinyin("大米", "xyz")).toBe(false);
  });
});

describe("getItemMonthlySummary", () => {
  const makeItem = (dailyData: PreparedItem["dailyData"]): PreparedItem => ({
    id: "item_1",
    name: "土豆",
    category: "VEGETABLE",
    targetGroup: "KID",
    unit: "斤",
    dailyData
  });

  it("sums quantity and amount across the given days", () => {
    const item = makeItem({
      "1": { quantity: 2, price: 3, amount: 6 },
      "2": { quantity: 1, price: 3, amount: 3 }
    });
    expect(getItemMonthlySummary(item, ["1", "2"])).toEqual({ totalQty: 3, totalCost: 9 });
  });

  it("skips days with no entry", () => {
    const item = makeItem({ "1": { quantity: 2, price: 3, amount: 6 } });
    expect(getItemMonthlySummary(item, ["1", "2", "3"])).toEqual({ totalQty: 2, totalCost: 6 });
  });

  it("returns zero totals when there is no data at all", () => {
    const item = makeItem({});
    expect(getItemMonthlySummary(item, ["1", "2"])).toEqual({ totalQty: 0, totalCost: 0 });
  });
});

describe("createSystemLog", () => {
  it("assembles a SystemLog object with the given fields", () => {
    const log = createSystemLog("INFO", "TestModule", "hello");
    expect(log.level).toBe("INFO");
    expect(log.module).toBe("TestModule");
    expect(log.message).toBe("hello");
    expect(log.details).toBeUndefined();
    expect(log.id).toMatch(/^log_/);
    expect(() => new Date(log.timestamp).toISOString()).not.toThrow();
  });

  it("includes details when provided", () => {
    const log = createSystemLog("ERROR", "TestModule", "boom", "stack trace here");
    expect(log.details).toBe("stack trace here");
  });

  it("generates unique ids across calls", () => {
    const a = createSystemLog("INFO", "M", "a");
    const b = createSystemLog("INFO", "M", "b");
    expect(a.id).not.toBe(b.id);
  });
});

describe("convertItemsToCsv", () => {
  const makeItem = (name: string, dailyData: PreparedItem["dailyData"]): PreparedItem => ({
    id: `item_${name}`,
    name,
    category: "VEGETABLE",
    targetGroup: "KID",
    unit: "斤",
    dailyData
  });

  it("starts with a UTF-8 BOM to prevent Excel garbling", () => {
    const csv = convertItemsToCsv([], ["1"], "蔬菜");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("includes a header row with per-day columns and totals", () => {
    const csv = convertItemsToCsv([], ["1", "2"], "蔬菜");
    const lines = csv.split("\n");
    expect(lines[0]).toContain("1号");
    expect(lines[0]).toContain("2号");
    expect(lines[0]).toContain("总数量");
    expect(lines[1]).toContain("数量");
    expect(lines[1]).toContain("单价");
    expect(lines[1]).toContain("金额(元)");
  });

  it("renders one data row per item with row totals", () => {
    const item = makeItem("土豆", { "1": { quantity: 2, price: 3, amount: 6 } });
    const csv = convertItemsToCsv([item], ["1"], "蔬菜");
    const lines = csv.split("\n");
    expect(lines[2]).toContain("土豆 (斤)");
    expect(lines[2]).toContain("2");
    expect(lines[2]).toContain("6");
  });

  it("escapes embedded double quotes in cell content", () => {
    const item = makeItem('特殊"名称', {});
    const csv = convertItemsToCsv([item], ["1"], "蔬菜");
    expect(csv).toContain('特殊""名称');
  });

  it("treats missing daily entries as zero without throwing", () => {
    const item = makeItem("柿子", {});
    expect(() => convertItemsToCsv([item], ["1", "2"], "蔬菜")).not.toThrow();
  });
});

describe("LogBroker", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers published logs to subscribed listeners", () => {
    const received: string[] = [];
    const unsubscribe = LogBroker.subscribe((log) => received.push(log.message));

    LogBroker.publish("INFO", "TestModule", "first message");

    expect(received).toEqual(["first message"]);
    unsubscribe();
  });

  it("stops delivering to a listener after it unsubscribes", () => {
    const received: string[] = [];
    const unsubscribe = LogBroker.subscribe((log) => received.push(log.message));
    unsubscribe();

    LogBroker.publish("INFO", "TestModule", "should not arrive");

    expect(received).toEqual([]);
  });

  it("does not let one listener's exception block the others", () => {
    const received: string[] = [];
    const unsubscribeBad = LogBroker.subscribe(() => {
      throw new Error("listener boom");
    });
    const unsubscribeGood = LogBroker.subscribe((log) => received.push(log.message));

    expect(() => LogBroker.publish("INFO", "TestModule", "still arrives")).not.toThrow();
    expect(received).toEqual(["still arrives"]);

    unsubscribeBad();
    unsubscribeGood();
  });

  it("forwards the published log to the backend via POST /api/log", () => {
    LogBroker.publish("ERROR", "TestModule", "failure happened", "stack details");

    expect(fetch).toHaveBeenCalledWith(
      "/api/log",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );
    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.level).toBe("ERROR");
    expect(body.category).toBe("TestModule");
    expect(body.message).toContain("failure happened");
    expect(body.message).toContain("stack details");
  });

  it("does not throw when the backend log upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(() => LogBroker.publish("WARN", "TestModule", "network will fail")).not.toThrow();
    // 等待被 .catch() 内部吞掉的拒绝落地，避免出现未处理的 rejection 警告
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
