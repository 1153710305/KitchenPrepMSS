/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description useAppData（App 顶层核心数据加载与多端同步 Hook）单元测试：首屏并行初始化与进度推进、首航空库清理浏览器缓存、备餐报表订阅回调对悬空 activeGroup/activeCategory 的自适应回退、
 * 以及每 10 秒心跳静默同步——重点覆盖 [V5.45.0] 修复过的心跳与本地保存竞态守卫（丢弃与本地写入竞态的过期心跳响应，避免刚保存的数据被静默覆盖）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppData } from "./useAppData.ts";
import { PrepReportService } from "../services/store.ts";
import { LedgerService } from "../services/ledgerStore.ts";
import { SyncHelper } from "../services/syncHelper.ts";
import { RawMaterialsDictService } from "../services/rawMaterialDict.ts";

function resetAllServices() {
  PrepReportService.setReportsInMemory([]);
  PrepReportService.setActiveGroupsInMemory([]);
  PrepReportService.setActiveCategoriesInMemory([]);
  (PrepReportService as any).changeListeners = [];
  LedgerService.setLedgersInMemory([]);
  LedgerService.setLedgerItemsInMemory([]);
  (LedgerService as any).changeListeners = [];
  RawMaterialsDictService.setRawMaterialsDictInMemory([]);
  (SyncHelper as any).isInitialized = false;
  (SyncHelper as any).onReadyQueue = [];
  (SyncHelper as any).lastLocalMutationAt = 0;
}

describe("useAppData", () => {
  beforeEach(() => {
    resetAllServices();
    vi.spyOn(PrepReportService, "initStore").mockResolvedValue([]);
    vi.spyOn(LedgerService, "initLedgerStore").mockResolvedValue({ ledgers: [], items: [] });
    vi.spyOn(SyncHelper, "loadFromServer").mockResolvedValue(null);
    vi.spyOn(RawMaterialsDictService, "initDictFromServer").mockReturnValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  });

  afterEach(() => {
    resetAllServices();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("completes the parallel first-screen load, unlocks the sync helper, and turns off loading", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppData());

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.isLoading).toBe(false);
    expect((SyncHelper as any).isInitialized).toBe(true);
  });

  it("clears localStorage/sessionStorage when the server reports a first boot", async () => {
    vi.useFakeTimers();
    vi.spyOn(SyncHelper, "loadFromServer").mockResolvedValue({ isFirstBoot: true } as any);
    localStorage.setItem("some_leftover_cache_key", "x");

    renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(localStorage.getItem("some_leftover_cache_key")).toBeNull();
  });

  it("does not clear storage on a normal (non-first-boot) load", async () => {
    vi.useFakeTimers();
    vi.spyOn(SyncHelper, "loadFromServer").mockResolvedValue({} as any);
    localStorage.setItem("some_leftover_cache_key", "x");

    renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(localStorage.getItem("some_leftover_cache_key")).toBe("x");
  });

  it("falls back activeGroup/activeCategory to the first available option when the current selection becomes stale via a report update", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // 模拟备餐报表服务的一二级配置发生变动（如级联删除导致当前选中项悬空）
    act(() => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿" } as any]);
      PrepReportService.setActiveCategoriesInMemory([{ key: "MEAT", label: "肉类" } as any]);
      PrepReportService.forceNotify();
    });

    expect(result.current.activeGroup).toBe("KID");
    expect(result.current.activeCategory).toBe("MEAT");
  });

  it("does not disturb activeGroup when it is 'LEDGER' (special sentinel, never auto-reassigned)", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    act(() => {
      result.current.setActiveGroup("LEDGER");
    });

    act(() => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿" } as any]);
      PrepReportService.forceNotify();
    });

    expect(result.current.activeGroup).toBe("LEDGER");
  });

  it("mirrors ledger item updates into ledgerItemsList via the LedgerService subscription", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    act(() => {
      LedgerService.setLedgerItemsInMemory([{ id: "item_1", name: "土豆" } as any]);
      LedgerService.forceNotify();
    });

    expect(result.current.ledgerItemsList).toEqual([{ id: "item_1", name: "土豆" }]);
  });

  describe("heartbeat silent sync (10s interval)", () => {
    it("applies fresh server data and force-notifies when nothing changed locally during the request", async () => {
      vi.useFakeTimers();
      renderHook(() => useAppData());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      const freshLedgers = [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }];
      vi.spyOn(SyncHelper, "loadFromServer").mockResolvedValue({ ledgers: freshLedgers } as any);
      const forceNotifySpy = vi.spyOn(LedgerService, "forceNotify");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(LedgerService.getLedgers()).toEqual(freshLedgers);
      expect(forceNotifySpy).toHaveBeenCalled();
    });

    it("REGRESSION [V5.45.0]: discards a heartbeat response that raced with a newer local save, instead of clobbering the freshly-saved data", async () => {
      // 复现场景：心跳的 GET 请求已经发出（loadFromServer 开始 resolve 前的这段时间），
      // 但用户在这段等待期间完成了一次真实的本地保存（lastLocalMutationAt 被刷新到晚于请求发起时刻）。
      // 正确行为：整轮心跳响应都应当被丢弃，不应用 setLedgersInMemory 覆盖内存，也不应 forceNotify。
      vi.useFakeTimers();
      renderHook(() => useAppData());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // 保存一份"陈旧"的心跳响应数据，与当前内存内容不同，以便能观察到是否被错误应用
      const staleLedgers = [{ id: "STALE", name: "陈旧数据", createdAt: "2026-01-01T00:00:00.000Z" }];
      vi.spyOn(SyncHelper, "loadFromServer").mockImplementation(async () => {
        // loadFromServer 被调用的这一刻，模拟一次比它更晚完成的本地保存正好在此刻抢先写入
        (SyncHelper as any).lastLocalMutationAt = Date.now() + 1;
        return { ledgers: staleLedgers } as any;
      });
      const setLedgersInMemorySpy = vi.spyOn(LedgerService, "setLedgersInMemory");
      const forceNotifySpy = vi.spyOn(LedgerService, "forceNotify");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(setLedgersInMemorySpy).not.toHaveBeenCalled();
      expect(forceNotifySpy).not.toHaveBeenCalled();
      expect(LedgerService.getLedgers()).not.toEqual(staleLedgers);
    });

    it("does not force-notify when the fresh data is identical to what is already in memory (no-op fast path)", async () => {
      vi.useFakeTimers();
      const seedLedgers = [{ id: "KID", name: "幼儿备餐", createdAt: "2026-01-01T00:00:00.000Z" }];
      LedgerService.setLedgersInMemory(seedLedgers);
      renderHook(() => useAppData());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      vi.spyOn(SyncHelper, "loadFromServer").mockResolvedValue({ ledgers: seedLedgers } as any);
      const forceNotifySpy = vi.spyOn(LedgerService, "forceNotify");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(forceNotifySpy).not.toHaveBeenCalled();
    });

    it("swallows a heartbeat fetch failure without crashing", async () => {
      vi.useFakeTimers();
      renderHook(() => useAppData());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      vi.spyOn(SyncHelper, "loadFromServer").mockRejectedValue(new Error("network down"));

      await expect(
        act(async () => {
          await vi.advanceTimersByTimeAsync(10000);
        })
      ).resolves.not.toThrow();
    });
  });

  it("stops the heartbeat interval from firing again after unmount", async () => {
    vi.useFakeTimers();
    const loadFromServerSpy = vi.spyOn(SyncHelper, "loadFromServer").mockResolvedValue(null);

    const { unmount } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // 首屏加载本身也会调用一次 loadFromServer，先清空调用记录，只关注卸载后是否还会触发心跳
    loadFromServerSpy.mockClear();

    // renderHook 的 unmount() 自身已经做好了必要的 act() 包裹，这里直接调用即可，
    // 无需再手动嵌套一层 act()（嵌套会触发 RTL 的 "overlapping act() calls" 警告）
    unmount();

    await act(async () => {
      // 卸载后再推进 20 秒（两个心跳周期），若 clearInterval 生效，loadFromServer 不应再被调用
      await vi.advanceTimersByTimeAsync(20000);
    });

    expect(loadFromServerSpy).not.toHaveBeenCalled();
  });

  it("does not throw when other components keep mutating shared service state after this hook has unmounted", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    unmount();

    // 卸载后再触发通知也不应抛出任何异常（内部的 active 标志位与已取消订阅双重防护生效）
    expect(() => {
      act(() => {
        PrepReportService.setReportsInMemory([{ targetGroup: "KID", year: 2026, month: 7, items: [] } as any]);
        PrepReportService.forceNotify();
      });
    }).not.toThrow();
  });
});
