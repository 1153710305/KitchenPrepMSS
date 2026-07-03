/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description useTableTheme（备餐采购细表主题切换 Hook）单元测试：默认主题回退、LocalStorage 持久化读写、主题样式映射查找。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTableTheme, THEME_MAP } from "./useTableTheme.ts";

describe("useTableTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to emerald when localStorage has no saved theme", () => {
    const { result } = renderHook(() => useTableTheme());
    expect(result.current.theme).toBe("emerald");
    expect(result.current.activeTheme).toBe(THEME_MAP.emerald);
  });

  it("restores a previously saved theme from localStorage", () => {
    localStorage.setItem("prep_table_theme", "purple");
    const { result } = renderHook(() => useTableTheme());
    expect(result.current.theme).toBe("purple");
    expect(result.current.activeTheme).toBe(THEME_MAP.purple);
  });

  it("switches the theme and persists the new value to localStorage", () => {
    const { result } = renderHook(() => useTableTheme());

    act(() => {
      result.current.handleThemeChange("charcoal");
    });

    expect(result.current.theme).toBe("charcoal");
    expect(result.current.activeTheme).toBe(THEME_MAP.charcoal);
    expect(localStorage.getItem("prep_table_theme")).toBe("charcoal");
  });
});
