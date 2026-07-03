/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description useLedgerData（台账主面板数据加载/订阅 Hook）单元测试：首屏内存快照读取、订阅生命周期、activeLedgerId 在当前台账被移除后自动回退到第一个可用台账（stale-closure 防护）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLedgerData } from "./useLedgerData.ts";
import { LedgerService } from "../services/ledgerStore.ts";
import type { Ledger } from "../types/ledgerTypes.ts";

const makeLedger = (id: string, name: string): Ledger => ({ id, name, createdAt: "2026-01-01T00:00:00.000Z" });

function resetLedgerService() {
  LedgerService.setLedgersInMemory([]);
  LedgerService.setLedgerItemsInMemory([]);
  (LedgerService as any).changeListeners = [];
}

describe("useLedgerData", () => {
  beforeEach(() => {
    resetLedgerService();
  });

  afterEach(() => {
    resetLedgerService();
    vi.restoreAllMocks();
  });

  it("seeds activeLedgerId from the first ledger already in memory on mount", () => {
    LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐"), makeLedger("STU", "在校生备餐")]);

    const { result } = renderHook(() => useLedgerData());

    expect(result.current.activeLedgerId).toBe("KID");
  });

  it("receives ledgers/items updates pushed through the LedgerService subscription", async () => {
    const { result } = renderHook(() => useLedgerData());

    act(() => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      LedgerService.forceNotify();
    });

    await waitFor(() => {
      expect(result.current.ledgers).toEqual([makeLedger("KID", "幼儿备餐")]);
    });
  });

  it("unsubscribes on unmount so it no longer receives updates", () => {
    const { result, unmount } = renderHook(() => useLedgerData());
    unmount();

    act(() => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      LedgerService.forceNotify();
    });

    // 卸载后不应再收到任何更新，ledgers 应保持挂载时的初始空值
    expect(result.current.ledgers).toEqual([]);
  });

  it("falls back to the first remaining ledger once the active one is deleted (stale-closure fix)", async () => {
    LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐"), makeLedger("STU", "在校生备餐")]);
    const { result } = renderHook(() => useLedgerData());

    expect(result.current.activeLedgerId).toBe("KID");

    act(() => {
      result.current.setActiveLedgerId("STU");
    });
    expect(result.current.activeLedgerId).toBe("STU");

    // 模拟当前选中的 STU 台账被删除，只剩 KID
    act(() => {
      LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐")]);
      LedgerService.forceNotify();
    });

    await waitFor(() => {
      expect(result.current.activeLedgerId).toBe("KID");
    });
  });

  it("leaves activeLedgerId untouched when it is still present after an update", async () => {
    LedgerService.setLedgersInMemory([makeLedger("KID", "幼儿备餐"), makeLedger("STU", "在校生备餐")]);
    const { result } = renderHook(() => useLedgerData());

    act(() => {
      result.current.setActiveLedgerId("STU");
    });

    act(() => {
      LedgerService.forceNotify();
    });

    await waitFor(() => {
      expect(result.current.activeLedgerId).toBe("STU");
    });
  });
});
