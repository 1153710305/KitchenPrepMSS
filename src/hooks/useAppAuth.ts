/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 封装 App 顶层的首页登录态与管理员密码校验逻辑的自定义 Hook。
 */

import { useState, type FormEvent } from "react";
import { ADMIN_PASSWORD, LOGIN_PASSWORD } from "../constants/constants.ts";
import { LogBroker } from "../utils.ts";

/**
 * @description useAppAuth 返回值接口
 */
export interface UseAppAuthResult {
  /** 系统安全登录状态，从 localStorage 读取记忆 */
  isLoggedIn: boolean;
  /** 首页登录输入的验证密码 */
  loginPasswordInput: string;
  setLoginPasswordInput: (val: string) => void;
  /** 首页登录授权错误 */
  loginError: string | null;
  /** 标志当前是否处于管理配置后台模式 */
  isAdminMode: boolean;
  setIsAdminMode: (val: boolean) => void;
  /** 是否展现管理员授权输入密码弹窗 */
  isPasswordModalOpen: boolean;
  setIsPasswordModalOpen: (val: boolean) => void;
  /** 输入的授权管理员密码 */
  enteredPassword: string;
  setEnteredPassword: (val: string) => void;
  /** 授权错误日志 */
  passwordError: string | null;
  /** 首页系统登录校验 */
  handleLoginSubmit: (e: FormEvent) => void;
  /** 安全注销登录态 */
  handleLogout: () => void;
  /** 呼唤管理员授权弹框 */
  handleAdminAccessAttempt: () => void;
  /** 验证授权管理密码并进入后台 */
  handleVerifyPasswordSubmit: (e: FormEvent) => void;
}

/**
 * @description 管理首页登录态与管理员后台密码校验的自定义 Hook
 */
export function useAppAuth(): UseAppAuthResult {
  /** 系统安全登录状态，从 localStorage 读取记忆 */
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => localStorage.getItem("kitchen_sys_logged_in") === "true");
  /** 首页登录输入的验证密码 */
  const [loginPasswordInput, setLoginPasswordInput] = useState<string>("");
  /** 首页登录授权错误 */
  const [loginError, setLoginError] = useState<string | null>(null);

  /** 标志当前是否处于管理配置后台模式 */
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  /** 是否展现管理员授权输入密码弹窗 */
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);
  /** 输入的授权管理员密码 */
  const [enteredPassword, setEnteredPassword] = useState<string>("");
  /** 授权错误日志 */
  const [passwordError, setPasswordError] = useState<string | null>(null);

  /**
   * @description 首页系统登录校验
   */
  const handleLoginSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (loginPasswordInput === LOGIN_PASSWORD) {
      setIsLoggedIn(true);
      localStorage.setItem("kitchen_sys_logged_in", "true");
      setLoginError(null);
      LogBroker.publish("INFO", "App", "登录验证：首页系统登录密码校验成功，进入系统。");
    } else {
      setLoginError("首页登录口令不正确。请输入正确的系统登录密码 (默认: guest)！");
      LogBroker.publish("WARN", "App", "安全警报：首页登录尝试输入错误密码，拒绝授信。");
    }
  };

  /**
   * @description 安全注销登录态
   */
  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem("kitchen_sys_logged_in");
    setLoginPasswordInput("");
    setLoginError(null);
    LogBroker.publish("INFO", "App", "安全登出：已安全注销当前的系统访问会话。");
  };

  /**
   * @description 呼唤管理员授权弹框
   */
  const handleAdminAccessAttempt = () => {
    setIsPasswordModalOpen(true);
    setEnteredPassword("");
    setPasswordError(null);
  };

  /**
   * @description 验证授权管理密码并进入后台
   */
  const handleVerifyPasswordSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (enteredPassword === ADMIN_PASSWORD) {
      setIsPasswordModalOpen(false);
      setIsAdminMode(true);
      LogBroker.publish("INFO", "App", "安全控制：管理员密码验证成功，已进入配置管理后台。");
    } else {
      setPasswordError("密码验证失败，口令不正确。请输入默认管理员密码！");
      LogBroker.publish("WARN", "App", `安全警报：试图使用错误口令越权进入后台，已被安全拦截。`);
    }
  };

  return {
    isLoggedIn,
    loginPasswordInput,
    setLoginPasswordInput,
    loginError,
    isAdminMode,
    setIsAdminMode,
    isPasswordModalOpen,
    setIsPasswordModalOpen,
    enteredPassword,
    setEnteredPassword,
    passwordError,
    handleLoginSubmit,
    handleLogout,
    handleAdminAccessAttempt,
    handleVerifyPasswordSubmit
  };
}
