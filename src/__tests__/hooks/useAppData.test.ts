/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description useAppData（App 顶层核心数据加载与多端同步 Hook）单元测试：首屏并行初始化与进度推进、首航空库清理浏览器缓存、
 * 一二级配置订阅回调对悬空 activeGroup/activeCategory 的自适应回退。
 * [2026-07-07 76f8061] 原先"每 10 秒心跳静默拉取全量状态覆盖内存"的轮询机制已随"按月懒加载 + 304 缓存"改造被移除
 * （轮询整份状态与按需分月加载的设计目标冲突），本文件不再包含对应测试；多端数据一致性现在依赖各写操作自身的
 * SyncHelper.refreshNow() 主动刷新 + 乐观并发版本冲突检测（fetchWithVersion 的 X-Base-Version/409），
 * 不再有"其它浏览器/设备的修改会在 10 秒内自动同步过来"的能力，需要手动刷新页面才能看到其它端的最新变更。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppData } from "@/src/hooks/useAppData.ts";
import { PrepReportService } from "@/src/services/store.ts";
import { LedgerService } from "@/src/services/ledgerStore.ts";
import { SyncHelper } from "@/src/services/syncHelper.ts";
import { RawMaterialsDictService } from "@/src/services/rawMaterialDict.ts";

function resetAllServices() {
  PrepReportService.setActiveGroupsInMemory([]);
  PrepReportService.setActiveCategoriesInMemory([]);
  (PrepReportService as any).changeListeners = [];
  LedgerService.setLedgersInMemory([]);
  LedgerService.setLedgerItemsInMemory([]);
  (LedgerService as any).changeListeners = [];
  RawMaterialsDictService.setRawMaterialsDictInMemory([]);
  (SyncHelper as any).isInitialized = false;
  (SyncHelper as any).onReadyQueue = [];
}

describe("useAppData", () => {
  beforeEach(() => {
    resetAllServices();
    vi.spyOn(PrepReportService, "initStore").mockResolvedValue(undefined);
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

  it("falls back activeGroup to the first available option when the current selection becomes stale via a group update", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // 模拟一级人群配置发生变动（如级联删除导致当前选中项悬空）
    act(() => {
      PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿" } as any]);
      PrepReportService.forceNotify();
    });

    expect(result.current.activeGroup).toBe("KID");
  });

  it("falls back an already-selected activeCategory to the first available option when it becomes stale (activeCategory starts as null = 合计汇总, never auto-populated from empty)", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    act(() => {
      result.current.setActiveCategory("OLD_CATEGORY");
    });
    expect(result.current.activeCategory).toBe("OLD_CATEGORY");

    act(() => {
      PrepReportService.setActiveCategoriesInMemory([{ key: "MEAT", label: "肉类" } as any]);
      PrepReportService.forceNotify();
    });

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
        PrepReportService.setActiveGroupsInMemory([{ key: "KID", label: "幼儿", emoji: "👶" }]);
        PrepReportService.forceNotify();
      });
    }).not.toThrow();
  });
});
