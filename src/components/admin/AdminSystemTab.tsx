/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { DownloadCloud, Trash2, AlertTriangle, ShieldAlert } from "lucide-react";

interface AdminSystemTabProps {
  showConfirm: (title: string, message: string, onConfirm: () => void, type: "warn" | "danger" | "info") => void;
}

/**
 * @description 系统维护选项卡，提供高危系统操作入口（导出数据库、清空流水记录）
 */
export const AdminSystemTab: React.FC<AdminSystemTabProps> = ({ showConfirm }) => {
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);

  // 处理导出数据库
  const handleExportDb = async () => {
    const password = window.prompt("【系统安全】请输入管理员密码以导出数据库文件：");
    if (!password) return;

    try {
      setExporting(true);
      const res = await fetch(`/api/system/export-db?password=${encodeURIComponent(password)}`);
      if (res.ok) {
        // 创建下载链接
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        
        // 尝试从 Content-Disposition 头获取文件名，如果没有则使用默认名称
        const contentDisposition = res.headers.get("Content-Disposition");
        let filename = `kpmss_${new Date().toISOString().split('T')[0]}.sqlite`;
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
          if (filenameMatch && filenameMatch[1]) {
            filename = filenameMatch[1];
          }
        }
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        alert("数据库文件导出成功！");
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || "密码错误或导出失败，被服务器拒绝。");
      }
    } catch (err: any) {
      alert("导出请求异常：" + err.message);
    } finally {
      setExporting(false);
    }
  };

  // 处理清空台账流水
  const handleClearRecords = () => {
    showConfirm(
      "【高危操作】清空所有台账流水记录",
      "您确定要一键清空系统内【所有台账】的每天进出库记录以及【所有备餐】的历史报表吗？\n注意：此操作将清空所有的流水明细、库存结余及历史备餐记录，回到新学期第一天的原始状态（保留各类食材、字典和人员等原始配置参数）。此操作不可逆！",
      async () => {
        const password = window.prompt("【系统安全】再次确认：请输入管理员密码以执行清空：");
        if (!password) return;

        try {
          setClearing(true);
          const res = await fetch("/api/system/clear-records", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-password": password
            }
          });

          if (res.ok) {
            alert("✅ 所有台账流水记录已成功清空！系统即将刷新页面以同步最新数据。");
            window.location.reload();
          } else {
            const errorData = await res.json().catch(() => ({}));
            alert(errorData.error || "密码错误或操作失败，被服务器拒绝。");
          }
        } catch (err: any) {
          alert("清空请求异常：" + err.message);
        } finally {
          setClearing(false);
        }
      },
      "danger"
    );
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-amber-500" size={20} />
            <h2 className="text-sm font-bold text-slate-800">系统维护中心</h2>
          </div>
          <span className="text-[10px] bg-red-50 text-red-700 font-mono px-2 py-0.5 rounded-full font-extrabold">
            高危操作区
          </span>
        </div>
        
        <p className="text-xs text-slate-500 mb-6">
          提供系统底层级别的运维和安全操作。以下功能均受管理员密码严格保护。
        </p>

        <div className="space-y-4">
          {/* 卡片：导出数据库 */}
          <div className="border border-slate-200 rounded-lg p-4 flex items-start gap-4 hover:border-emerald-300 transition-colors bg-slate-50">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-full shrink-0 mt-1">
              <DownloadCloud size={18} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-800 mb-1">导出数据库文件备份</h3>
              <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                将当前服务器上存储的所有系统数据（包含配置、台账、备餐报表等完整内容）打包为一个物理数据库文件下载到本地计算机。常用于灾难级数据备份或服务器迁移。
              </p>
              <button
                onClick={handleExportDb}
                disabled={exporting}
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <>正在导出...</>
                ) : (
                  <>
                    <DownloadCloud size={14} />
                    一键导出数据备份
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 卡片：清空台账流水 */}
          <div className="border border-red-200 rounded-lg p-4 flex items-start gap-4 hover:border-red-400 transition-colors bg-red-50/50">
            <div className="p-2 bg-red-100 text-red-600 rounded-full shrink-0 mt-1">
              <Trash2 size={18} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-red-800 mb-1">系统大扫除（清空流水与报表）</h3>
              <div className="bg-white/80 p-2.5 rounded border border-red-100 mb-3">
                <p className="text-xs text-slate-700 leading-relaxed flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                  <span>
                    本功能将<strong>一键清空系统内所有台账下属的每日进出库记录、所有历史备餐报表，并将库存归零</strong>。<br />
                    常用于新学期、新季度初的账目归零。此操作<strong>仅清除流水记录</strong>，您配置好的所有底表大类、原材料基础信息（单位/规格/初始库存等）均会安全保留。
                  </span>
                </p>
              </div>
              <button
                onClick={handleClearRecords}
                disabled={clearing}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearing ? (
                  <>清理执行中...</>
                ) : (
                  <>
                    <Trash2 size={14} />
                    危险：立即执行数据清空
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
