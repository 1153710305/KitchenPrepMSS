/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description SyncHelper（客户端与后端持久化层同步协调器）单元测试：初始化安全锁与回调队列、阶段三增量写协议的
 * 去抖动批量提交（同 key 去重合并为最后一次、不同 key 自然合批为一次请求）、flush 失败重试、
 * 以及 hasPendingSync/waitForPendingSync 的回归测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncHelper } from "@/src/services/syncHelper.ts";

function resetSyncHelper() {
  (SyncHelper as any).isInitialized = false;
  (SyncHelper as any).onReadyQueue = [];
  (SyncHelper as any).pendingOps = new Map();
  if ((SyncHelper as any).debounceTimer) {
    clearTimeout((SyncHelper as any).debounceTimer);
  }
  (SyncHelper as any).debounceTimer = null;
  (SyncHelper as any).retryCount = 0;
  (SyncHelper as any).isFlushing = false;
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
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ success: true }) });
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
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ success: true }) });
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
        .mockResolvedValueOnce({ ok: true, headers: new Headers(), json: async () => ({ success: true }) });
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

  describe("hasPendingSync / waitForPendingSync [V5.89.0]", () => {
    // 真实的用户可感知问题：本地保存后 UI 认为"已保存"，但增量同步还在 200ms 防抖排队或已发出请求尚未
    // 收到服务器确认，此时若恰好触发了一次 refreshNow()（如切换查看月份），用一份滞后的服务器快照覆盖内存，
    // 刚保存的记录会被短暂"冲掉"——表现为"细表/台账里刚加入的记录显示有延迟"。
    it("reports no pending sync before any mutation has been queued", () => {
      expect(SyncHelper.hasPendingSync()).toBe(false);
    });

    it("reports pending sync while an op is queued waiting for the 200ms debounce to fire", () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({}) }));
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      expect(SyncHelper.hasPendingSync()).toBe(true);
    });

    it("reports pending sync while the flush request is in flight, and clears once it resolves", async () => {
      vi.useFakeTimers();
      let resolveFetch: (value: any) => void;
      const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(fetchPromise));
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });
      await vi.advanceTimersByTimeAsync(200); // 触发防抖 flush，发出请求但尚未收到响应
      expect(SyncHelper.hasPendingSync()).toBe(true);

      resolveFetch!({ ok: true, headers: new Headers(), json: async () => ({}) });
      await vi.advanceTimersByTimeAsync(0);
      expect(SyncHelper.hasPendingSync()).toBe(false);
    });

    it("waitForPendingSync resolves immediately when there is nothing pending", async () => {
      let resolved = false;
      SyncHelper.waitForPendingSync().then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(true);
    });

    it("waitForPendingSync only resolves after the queued op has actually been flushed and confirmed", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({}) }));
      SyncHelper.setInitialized(true);

      SyncHelper.queueChange({ entity: "ledger", op: "upsert", key: "KID", data: { id: "KID" } });

      let resolved = false;
      SyncHelper.waitForPendingSync().then(() => { resolved = true; });

      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false); // 还在 200ms 防抖排队中，不应提前放行

      await vi.advanceTimersByTimeAsync(250); // 跨过防抖 + flush 网络请求
      expect(resolved).toBe(true);
    });
  });
});
