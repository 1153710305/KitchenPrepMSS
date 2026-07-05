/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description SyncHelper（客户端与后端持久化层同步协调器）单元测试：初始化安全锁与回调队列、阶段三增量写协议的
 * 去抖动批量提交（同 key 去重合并为最后一次、不同 key 自然合批为一次请求）、flush 失败重试、
 * 以及心跳静默同步竞态守卫（lastLocalMutationAt）的回归测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncHelper } from "./syncHelper.ts";

function resetSyncHelper() {
  (SyncHelper as any).isInitialized = false;
  (SyncHelper as any).onReadyQueue = [];
  (SyncHelper as any).pendingOps = new Map();
  if ((SyncHelper as any).debounceTimer) {
    clearTimeout((SyncHelper as any).debounceTimer);
  }
  (SyncHelper as any).debounceTimer = null;
  (SyncHelper as any).lastLocalMutationAt = 0;
  (SyncHelper as any).retryCount = 0;
}

describe("SyncHelper", () => {
  beforeEach(() => {
    resetSyncHelper();
  });

  afterEach(() => {
    resetSyncHelper();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("setInitialized / runWhenInitialized", () => {
    it("runs the callback immediately when already initialized", () => {
      SyncHelper.setInitialized(true);
      const fn = vi.fn();
      SyncHelper.runWhenInitialized(fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("queues the callback and runs it once initialization unlocks", () => {
      const fn = vi.fn();
      SyncHelper.runWhenInitialized(fn);
      expect(fn).not.toHaveBeenCalled();

      SyncHelper.setInitialized(true);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("drains and clears the entire queue on unlock, running each callback exactly once", () => {
      const calls: number[] = [];
      SyncHelper.runWhenInitialized(() => calls.push(1));
      SyncHelper.runWhenInitialized(() => calls.push(2));
      SyncHelper.runWhenInitialized(() => calls.push(3));

      SyncHelper.setInitialized(true);

      expect(calls).toEqual([1, 2, 3]);

      // 再次解锁（幂等调用）不应重复触发已经清空的队列
      SyncHelper.setInitialized(true);
      expect(calls).toEqual([1, 2, 3]);
    });
  });

  describe("queueChange (initialization guard + debounce batching)", () => {
    it("is blocked and makes no network request before initialization completes", () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      vi.advanceTimersByTime(500);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("dedupes rapid successive writes to the same entity+key into a single last-write-wins op", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchSpy);
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "A" } });
      vi.advanceTimersByTime(100);
      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "B" } });
      vi.advanceTimersByTime(100);
      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "C" } });

      // 前两次调用都被防抖取消，尚未真正发出请求
      expect(fetchSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.protocolVersion).toBe(2);
      expect(body.ops).toEqual([{ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "C" } }]);
    });

    it("batches ops with different entity+key into the same request within one debounce window", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchSpy);
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      SyncHelper.queueChange({ entity: "rawMaterial", op: "upsert", key: "土豆", data: { name: "土豆" } });

      await vi.advanceTimersByTimeAsync(200);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.ops).toHaveLength(2);
      expect(body.ops.map((op: any) => op.entity).sort()).toEqual(["ledger", "rawMaterial"]);
    });

    it("does not throw when the save request fails", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      await expect(vi.advanceTimersByTimeAsync(200)).resolves.not.toThrow();
    });

    it("REGRESSION: retries a failed flush (bounded), so a transient network blip does not silently lose the op", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn()
        .mockRejectedValueOnce(new Error("transient failure"))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchSpy);
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "A" } });
      await vi.advanceTimersByTimeAsync(200); // 首次 flush 失败
      await vi.advanceTimersByTimeAsync(200); // 重试 flush 成功

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [, secondOptions] = fetchSpy.mock.calls[1];
      expect(JSON.parse(secondOptions.body).ops).toEqual([{ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID", name: "A" } }]);
    });

    it("REGRESSION: gives up after MAX_RETRY consecutive failures instead of retrying forever", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchSpy);
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      // 首次 flush + 最多 MAX_RETRY(3) 次重试 = 最多 4 次调用后应停止
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(200);
      }

      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(4);
      const callsAfterGivingUp = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterGivingUp);
    });
  });

  describe("lastLocalMutationAt heartbeat race guard (regression)", () => {
    it("is 0 before any local mutation has ever been triggered", () => {
      expect(SyncHelper.getLastLocalMutationAt()).toBe(0);
    });

    it("does not update the timestamp when blocked by the initialization guard", () => {
      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      expect(SyncHelper.getLastLocalMutationAt()).toBe(0);
    });

    it("stamps the current time the moment a real local mutation is triggered, before the debounce even fires", () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      SyncHelper.setInitialized(true);
      const before = Date.now();

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });

      // 时间戳应在触发的一瞬间同步写入，不需要等待 200ms 的防抖计时器触发
      expect(SyncHelper.getLastLocalMutationAt()).toBeGreaterThanOrEqual(before);
    });

    it("regression: a heartbeat GET issued before a local save resolves after it must be detected as stale by comparing timestamps", async () => {
      // 复现 [V5.45.0] 修复过的心跳同步竞态：心跳发出 GET 请求的那一刻先记录下来，
      // 如果这之后发生了真实的本地写入（lastLocalMutationAt 更新），
      // 消费方（useAppData 的心跳回调）就应当据此判断该次心跳响应已过期、丢弃不覆盖内存。
      // 这里只验证 SyncHelper 暴露的时间戳本身具备这个判别能力，具体丢弃逻辑在 useAppData 侧测试覆盖。
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      SyncHelper.setInitialized(true);

      const heartbeatRequestStartedAt = Date.now();

      // 心跳请求发出之后，用户触发了一次真实的本地保存
      vi.advanceTimersByTime(50);
      SyncHelper.queueChange({ entity: "report", op: "upsert", key: { targetGroup: "KID", year: 2026, month: 7 } });

      expect(SyncHelper.getLastLocalMutationAt()).toBeGreaterThan(heartbeatRequestStartedAt);
    });
  });
});
