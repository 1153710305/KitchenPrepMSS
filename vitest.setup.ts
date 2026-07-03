/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Vitest 全局测试环境初始化：引入 jest-dom 断言扩展，并在每个用例结束后自动清理 React Testing Library 渲染出的 DOM，避免测试间相互污染。
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
