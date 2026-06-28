/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from "react";
import { SystemLog } from "../types.ts";
import { LogBroker } from "../utils.ts";
import { UI_TEXT } from "../constants.ts";
import { Terminal, ShieldAlert, CheckCircle, Info, Trash2, ArrowDownCircle } from "lucide-react";

/**
 * @description 日志实时展示组件
 */
export const LogView: React.FC = () => {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [filterLevel, setFilterLevel] = useState<"ALL" | "INFO" | "WARN" | "ERROR">("ALL");
  const logEndRef = useRef<HTMLDivElement>(null);

  // 挂载 LogBroker 日志热拦截器
  useEffect(() => {
    // 启动提示
    LogBroker.publish("INFO", "LogView", "监控日志组件启动成功，正在嗅探系统总线接口");

    const unsubscribe = LogBroker.subscribe((newLog) => {
      setLogs((prev) => [...prev, newLog].slice(-100)); // 仅维护最新100条，避免物理卡顿
    });

    return () => unsubscribe();
  }, []);

  // 每次重写列表，自动滚屏
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  /** @description 过滤后的日志 */
  const filteredLogs = logs.filter((log) => {
    if (filterLevel === "ALL") return true;
    return log.level === filterLevel;
  });

  /** @description 格式化时间 */
  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 shadow-xl text-neutral-200 mt-6 font-mono overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-3 mb-3">
        <div className="flex items-center gap-2 text-amber-400">
          <Terminal size={18} id="log-terminal-icon" />
          <span className="font-semibold text-sm tracking-wide">{UI_TEXT.sysLogTitle}</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {/* 日志分级过滤器 */}
          <div className="flex rounded-md bg-neutral-800 p-0.5 border border-neutral-700">
            {(["ALL", "INFO", "WARN", "ERROR"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2.5 py-1 rounded-sm text-[11px] font-medium transition-all cursor-pointer ${
                  filterLevel === lvl
                    ? "bg-neutral-700 text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {lvl === "ALL" ? "全部" : lvl}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setLogs([]);
              LogBroker.publish("INFO", "LogView", "控制台日志已清空");
            }}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-950/40 text-red-400 hover:bg-red-900/40 rounded-md border border-red-900/30 transition-all cursor-pointer"
            title={UI_TEXT.logClearBtn}
          >
            <Trash2 size={12} />
            <span>清空</span>
          </button>
        </div>
      </div>

      {/* 日志消息滚动容器 */}
      <div className="h-44 overflow-y-auto text-xs space-y-2 pr-2 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
        {filteredLogs.length === 0 ? (
          <div className="text-neutral-500 text-center py-10 italic text-[11px]">
            暂无匹配的系统进程及性能分析日志...
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`p-2 rounded border transition-colors ${
                log.level === "ERROR"
                  ? "bg-red-950/20 border-red-900/30 text-red-300"
                  : log.level === "WARN"
                      ? "bg-amber-950/20 border-amber-950 text-amber-300"
                      : "bg-neutral-800/20 border-neutral-800 text-neutral-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2 text-[10px] text-neutral-500 mb-1">
                <span className="flex items-center gap-1 font-semibold uppercase">
                  {log.level === "ERROR" && <ShieldAlert size={10} className="text-red-500" />}
                  {log.level === "WARN" && <ShieldAlert size={10} className="text-amber-500" />}
                  {log.level === "INFO" && <Info size={10} className="text-sky-500" />}
                  {log.level}
                </span>
                <span>{log.module}</span>
                <span>{formatTime(log.timestamp)}</span>
              </div>
              <p className="text-[11px] leading-relaxed break-words">{log.message}</p>
              {log.details && (
                <div className="mt-1.5 p-1 bg-black/40 rounded text-[10px] text-neutral-400 border border-neutral-800 break-all overflow-x-auto whitespace-pre">
                  {log.details}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      <div className="flex items-center justify-between border-t border-neutral-800 pt-2.5 mt-2 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <CheckCircle size={10} className="text-emerald-500" />
          全量总线就绪: 100% 宿主内自适应
        </span>
        <span className="flex items-center gap-1">
          <ArrowDownCircle size={10} />
          显示上限: 100 条
        </span>
      </div>
    </div>
  );
};
