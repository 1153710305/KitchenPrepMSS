/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description useAppAuth（首页登录态与管理员密码校验 Hook）单元测试：登录/登出的 localStorage 持久化、密码校验成功与失败路径、管理员授权弹窗的开关流转。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppAuth } from "@/src/hooks/useAppAuth.ts";
import { ADMIN_PASSWORD, LOGIN_PASSWORD } from "@/src/constants/constants.ts";

describe("useAppAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    // 登录/登出等动作会经由 LogBroker.publish 触发真实 fetch("/api/log", ...) 上报，
    // 测试环境无相对 URL 基址且无真实后端，这里挡掉真实网络请求以保持输出干净
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("initial state", () => {
    it("starts logged out when localStorage has no session flag", () => {
      const { result } = renderHook(() => useAppAuth());
      expect(result.current.isLoggedIn).toBe(false);
    });

    it("restores a logged-in session from localStorage on mount", () => {
      localStorage.setItem("kitchen_sys_logged_in", "true");
      const { result } = renderHook(() => useAppAuth());
      expect(result.current.isLoggedIn).toBe(true);
    });
  });

  describe("handleLoginSubmit", () => {
    it("logs in and persists the session when the password matches", () => {
      const { result } = renderHook(() => useAppAuth());

      act(() => {
        result.current.setLoginPasswordInput(LOGIN_PASSWORD);
      });
      act(() => {
        result.current.handleLoginSubmit({ preventDefault: () => {} } as any);
      });

      expect(result.current.isLoggedIn).toBe(true);
      expect(result.current.loginError).toBeNull();
      expect(localStorage.getItem("kitchen_sys_logged_in")).toBe("true");
    });

    it("sets an error and does not log in when the password is wrong", () => {
      const { result } = renderHook(() => useAppAuth());

      act(() => {
        result.current.setLoginPasswordInput("wrong-password");
      });
      act(() => {
        result.current.handleLoginSubmit({ preventDefault: () => {} } as any);
      });

      expect(result.current.isLoggedIn).toBe(false);
      expect(result.current.loginError).toMatch(/不正确/);
      expect(localStorage.getItem("kitchen_sys_logged_in")).toBeNull();
    });
  });

  describe("handleLogout", () => {
    it("clears the session, the password input, and the localStorage flag", () => {
      localStorage.setItem("kitchen_sys_logged_in", "true");
      const { result } = renderHook(() => useAppAuth());

      act(() => {
        result.current.setLoginPasswordInput("leftover input");
      });
      act(() => {
        result.current.handleLogout();
      });

      expect(result.current.isLoggedIn).toBe(false);
      expect(result.current.loginPasswordInput).toBe("");
      expect(localStorage.getItem("kitchen_sys_logged_in")).toBeNull();
    });
  });

  describe("admin password flow", () => {
    it("opens the password modal and clears any prior state on access attempt", () => {
      const { result } = renderHook(() => useAppAuth());

      act(() => {
        result.current.setEnteredPassword("leftover");
      });
      act(() => {
        result.current.handleAdminAccessAttempt();
      });

      expect(result.current.isPasswordModalOpen).toBe(true);
      expect(result.current.enteredPassword).toBe("");
      expect(result.current.passwordError).toBeNull();
    });

    it("grants admin mode and closes the modal when the password matches", () => {
      const { result } = renderHook(() => useAppAuth());
      act(() => {
        result.current.handleAdminAccessAttempt();
      });

      act(() => {
        result.current.setEnteredPassword(ADMIN_PASSWORD);
      });
      act(() => {
        result.current.handleVerifyPasswordSubmit({ preventDefault: () => {} } as any);
      });

      expect(result.current.isAdminMode).toBe(true);
      expect(result.current.isPasswordModalOpen).toBe(false);
    });

    it("sets a password error and keeps the modal open when the password is wrong", () => {
      const { result } = renderHook(() => useAppAuth());
      act(() => {
        result.current.handleAdminAccessAttempt();
      });

      act(() => {
        result.current.setEnteredPassword("wrong-admin-password");
      });
      act(() => {
        result.current.handleVerifyPasswordSubmit({ preventDefault: () => {} } as any);
      });

      expect(result.current.isAdminMode).toBe(false);
      expect(result.current.isPasswordModalOpen).toBe(true);
      expect(result.current.passwordError).toMatch(/不正确/);
    });
  });
});
