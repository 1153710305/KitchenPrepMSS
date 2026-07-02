/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 前端应用挂载入口：将根组件 App 挂载到 index.html 的 root 节点，并引入全局样式表。
 */

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
