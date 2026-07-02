/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { LogBroker } from "../../utils.ts";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * @description 高鲁棒性 React 渲染崩溃捕获组件，隔离异常子树，保证整站稳定性并上报物理日志
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // 更新 state 使下一次渲染能够显示降级 UI
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // 自动通过 LogBroker 异步把详细报错堆栈上报写到服务器的物理日志文件中
    const details = `Error: ${error.message}\nStack: ${error.stack}\nComponent Stack: ${errorInfo.componentStack}`;
    LogBroker.publish("ERROR", "ErrorBoundary", details);
    console.error("[React Render Error] 捕获到子组件渲染严重崩溃:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // 强制刷新当前视窗对齐状态
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-slate-50 border border-slate-200 rounded-2xl max-w-2xl mx-auto my-8 space-y-4 shadow-sm font-sans">
          <div className="flex items-center gap-3 text-rose-600">
            <ShieldAlert size={26} className="shrink-0" />
            <h2 className="text-base font-black">
              {this.props.fallbackTitle || "该板块组件由于运行内部错误发生了崩溃"}
            </h2>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            系统已自动捕获并记录了该异常到服务器本地物理日志文件中。您可以尝试重试刷新或联系食堂系统管理员。
          </p>

          {this.state.error && (
            <details className="p-3 bg-slate-100 rounded-lg text-[10px] font-mono text-slate-700 max-h-48 overflow-y-auto cursor-pointer select-text">
              <summary className="font-bold text-slate-800 outline-none select-none">
                查看错误详细堆栈 (诊断信息)
              </summary>
              <pre className="mt-2 whitespace-pre-wrap leading-normal font-mono select-text cursor-text">
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div className="pt-2">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw size={13} />
              <span>重新加载并尝试恢复</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
