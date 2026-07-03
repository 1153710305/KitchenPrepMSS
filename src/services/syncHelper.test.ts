/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description SyncHelper（客户端与后端持久化层同步协调器）单元测试：初始化安全锁与回调队列、防抖批量提交、以及心跳静默同步竞态守卫（lastLocalMutationAt）的回归测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncHelper } from "./syncHelper.ts";

function resetSyncHelper() {
  (SyncHelper as any).isInitialized = false;
  (SyncHelper as any).onReadyQueue = [];
  (SyncHelper as any).memoryFetcher = null;
  if ((SyncHelper as any).debounceTimer) {
    clearTimeout((SyncHelper as any).debounceTimer);
  }
  (SyncHelper as any).debounceTimer = null;
  (SyncHelper as any).lastLocalMutationAt = 0;
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

  describe("triggerSyncToServer (initialization guard + debounce)", () => {
    it("is blocked and makes no network request before initialization completes", () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      SyncHelper.triggerSyncToServer({ reports: [] });
      vi.advanceTimersByTime(500);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("debounces rapid successive calls into a single POST request", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchSpy);
      SyncHelper.setInitialized(true);

      SyncHelper.triggerSyncToServer({ reports: [{ a: 1 }] });
      vi.advanceTimersByTime(100);
      SyncHelper.triggerSyncToServer({ reports: [{ a: 2 }] });
      vi.advanceTimersByTime(100);
      SyncHelper.triggerSyncToServer({ reports: [{ a: 3 }] });

      // 前两次调用都被防抖取消，尚未真正发出请求
      expect(fetchSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ reports: [{ a: 3 }] });
    });

    it("falls back to the registered memoryFetcher when no explicit data is passed", async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetchSpy);
      SyncHelper.setInitialized(true);
      SyncHelper.registerMemoryFetcher(() => ({ reports: [{ fromFetcher: true }] }));

      SyncHelper.triggerSyncToServer();
      await vi.advanceTimersByTimeAsync(200);

      const [, options] = fetchSpy.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ reports: [{ fromFetcher: true }] });
    });

    it("does not throw when the save request fails", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      SyncHelper.setInitialized(true);

      SyncHelper.triggerSyncToServer({});
      await expect(vi.advanceTimersByTimeAsync(200)).resolves.not.toThrow();
    });
  });

  describe("lastLocalMutationAt heartbeat race guard (regression)", () => {
    it("is 0 before any local mutation has ever been triggered", () => {
      expect(SyncHelper.getLastLocalMutationAt()).toBe(0);
    });

    it("does not update the timestamp when blocked by the initialization guard", () => {
      SyncHelper.triggerSyncToServer({});
      expect(SyncHelper.getLastLocalMutationAt()).toBe(0);
    });

    it("stamps the current time the moment a real local mutation is triggered, before the debounce even fires", () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      SyncHelper.setInitialized(true);
      const before = Date.now();

      SyncHelper.triggerSyncToServer({});

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
      SyncHelper.triggerSyncToServer({ reports: [{ justSaved: true }] });

      expect(SyncHelper.getLastLocalMutationAt()).toBeGreaterThan(heartbeatRequestStartedAt);
    });
  });
});
