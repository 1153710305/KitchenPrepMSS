/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 管理配置后台的主外壳组件：提供侧边栏 Tab 导航（一级受众管理、二级大类管理、原料字典管理、台账人员与供货商），并承载二级大类的增删改查表单及跨 Tab 共用的自定义确认弹窗。
 */

import React, { useState } from "react";
import { PrepReportService } from "../../services/store.ts";
import { DynamicCategory } from "../../types/types.ts";
import { LogBroker } from "../../utils.ts";
import { AdminDictTab } from "./AdminDictTab.tsx";
import { AdminGroupsTab } from "./AdminGroupsTab.tsx";
import { AdminLedgerHelpersTab } from "./AdminLedgerHelpersTab.tsx";
import { AdminSystemTab } from "./AdminSystemTab.tsx";
import {
  Users,
  Settings,
  Trash2,
  Edit2,
  Check,
  X,
  PlusCircle,
  FolderHeart,
  ShieldAlert,
  Sparkles,
  ChevronLeft,
  FileSpreadsheet,
  Lock,
  Database
} from "lucide-react";

/**
 * @description 管理后台配置页入参接口 (AdminBackendProps)
 */
interface AdminBackendProps {
  /** 当前激活的二级食材大类列表 */
  activeCategoriesList: DynamicCategory[];
  /** 退出后台回到备餐主大厅的回调 */
  onClose: () => void;
}

/**
 * @description 自定义安全确认弹窗状态结构接口 (ConfirmModalState)
 */
interface ConfirmModalState {
  /** 弹窗是否开启 */
  isOpen: boolean;
  /** 弹窗标题 */
  title: string;
  /** 提示详情文本 */
  message: string;
  /** 点击确认后的执行回调函数 */
  onConfirm: () => void;
  /** 警示级别：danger高危、warn中危、info常规 */
  type: "warn" | "danger" | "info";
}

/**
 * @description 智能食堂配置管理后台组件，支持一级餐位人群及二级食材大类的增删改查(CRUD)，附带实时监控日志与行政核销中心
 */
export const AdminBackend: React.FC<AdminBackendProps> = ({
  activeCategoriesList,
  onClose
}) => {
  // ================= 状态声明部分 =================

  // --- 导航状态 ---
  /**
   * @description 当前激活的子功能页面。'groups'代表客群管理，'categories'代表大类管理，'dictionary'代表字典管理，'ledger_helpers'代表台账常用字典配置，'system'代表系统维护
   */
  const [activeTab, setActiveTab] = useState<"groups" | "categories" | "dictionary" | "ledger_helpers" | "system">("groups");

  // --- 自定义确认弹窗状态 ---
  /** 
   * @description 物理弹窗配置状态，用以解决 native confirm() 在 iframe 预览被拦截的问题 
   */
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => { },
    type: "info"
  });



  // --- 二级大类管理相关内部状态 ---
  /** 
   * @description 生成二级大类系统唯一 Key 的辅助函数 
   */
  const generateUniqueCatKey = () => "CAT_" + Math.random().toString(36).substr(2, 6).toUpperCase() + "_" + Math.floor(Math.random() * 100);

  /** 
   * @description 食材供应分类标识Key输入值 (英数大写) 
   */
  const [catKeyInput, setCatKeyInput] = useState<string>(() => "CAT_" + Math.random().toString(36).substr(2, 6).toUpperCase() + "_" + Math.floor(Math.random() * 100));
  /** 
   * @description 食材供应分类中文显示名称 
   */
  const [catLabelInput, setCatLabelInput] = useState<string>("");
  /** 
   * @description 处于编辑态的 Category 标识 Key，为 null 代表新增模式 
   */
  const [editingCatKey, setEditingCatKey] = useState<string | null>(null);

  // --- 联动警告状态 ---

  /** 
   * @description 二级食材大类操作异常文字提示 
   */
  const [catError, setCatError] = useState<string | null>(null);



  // ================= 核心工具函数 =================

  /**
   * @description 触发美化的安全确认弹窗
   * @param title 弹窗主标题
   * @param message 提示消息
   * @param onConfirm 确认后的回调函数
   * @param type 危险类型，danger为红色高危，warn为黄色警示，info为蓝色正常
   */
  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    type: "warn" | "danger" | "info" = "info"
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
      type
    });
  };

  // ================= 二级食材大类 C.R.U.D. 执行方法 =================

  /**
   * @description 提交保存二级食材品类大类
   * @param e 表单提交事件
   */
  const handleSaveCatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatError(null);

    if (!catKeyInput.trim()) {
      setCatError("食材大类标识Key必须填写且保证英数格式！");
      return;
    }
    if (!catLabelInput.trim()) {
      setCatError("食材大类文字名称不能为空！");
      return;
    }

    const targetKey = catKeyInput.trim().toUpperCase();

    if (!editingCatKey) {
      const isExist = activeCategoriesList.some(c => c.key === targetKey);
      if (isExist) {
        setCatError(`标识Key "${targetKey}" 已被其它食材类别占用，请指定全新标识。`);
        return;
      }
    }

    try {
      await PrepReportService.saveCategory(targetKey, catLabelInput);
      LogBroker.publish("INFO", "AdminBackend", `配置后台成功存储了二级食材大类：${catLabelInput} (${targetKey})`);

      setCatKeyInput(generateUniqueCatKey());
      setCatLabelInput("");
      setEditingCatKey(null);
    } catch (err: any) {
      setCatError(err.message || "存储食材大类配置时发生了未知错误");
    }
  };

  /**
   * @description 启动对食材品类的编辑回填
   * @param cat 目标大类数据对象
   */
  const handleStartEditCat = (cat: DynamicCategory) => {
    setCatError(null);
    setEditingCatKey(cat.key);
    setCatKeyInput(cat.key);
    setCatLabelInput(cat.label);
  };

  /**
   * @description 彻底物理删除食材品类大类，使用自定义弹窗
   * @param key 目标大类标识 Key
   */
  const handleDeleteCat = (key: string) => {
    const cat = activeCategoriesList.find((c) => c.key === key);
    const label = cat ? cat.label : key;

    showConfirm(
      "危险：彻底物理删除食材品类",
      `您确定要永久抹除大品类「${label}类」吗？这将自动级联清理各客群名下属于该品类的所有底栏食材清单，以及相关的每日记账流水记录！此清理方案无法撤销，确定执行吗？`,
      async () => {
        try {
          await PrepReportService.deleteCategory(key);
          LogBroker.publish("WARN", "AdminBackend", `配置后台物理剔除了餐饮品类：${key}`);
          if (editingCatKey === key) {
            setEditingCatKey(null);
            setCatKeyInput(generateUniqueCatKey());
            setCatLabelInput("");
          }
        } catch (err: any) {
          setCatError(err.message || "移除大品类失败");
        }
      },
      "danger"
    );
  };

  /**
   * @description 终止并清空品类编辑状态
   */
  const handleCancelCatEdit = () => {
    setEditingCatKey(null);
    setCatKeyInput(generateUniqueCatKey());
    setCatLabelInput("");
    setCatError(null);
  };

  // ================= 界面渲染视图部分 =================
  return (
    <div className="flex flex-col h-screen bg-slate-100 w-full font-sans select-none overflow-hidden">

      {/* 顶部二级暗灰快速行政控制条 */}
      <header className="sticky top-0 bg-slate-900 text-slate-100 flex items-center justify-between px-6 py-4 shadow-md border-b border-slate-800 z-50 shrink-0">
        <div className="flex items-center space-x-3">
          <button
            onClick={onClose}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded text-xs transition cursor-pointer font-medium text-slate-200"
            title="关闭后台返回记账矩阵"
          >
            <ChevronLeft size={14} />
            <span>返回食堂记账主厅</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-700" />
          <div className="flex items-center space-x-2">
            <Settings className="text-emerald-400 animate-spin-slow" size={18} />
            <h2 className="text-sm font-extrabold tracking-tight">食堂配置中央管理后台</h2>
          </div>
        </div>

        <div className="text-[10px] bg-slate-950 border border-slate-800 text-slate-400 rounded px-2.5 py-1">
          当前已授权: <span className="font-bold text-emerald-400">ADMINISTRATOR</span>
        </div>
      </header>

      {/* 核心双分骨架排布 (Aside + Main) */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* 左侧导航菜单栏 Sidebar */}
        <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0 justify-between font-sans">
          <div className="flex flex-col flex-1 min-h-0">
            <div className="p-4 border-b border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">功能快捷菜单</span>
            </div>

            <nav className="flex-1 py-2 space-y-1 overflow-y-auto">
              <button
                onClick={() => setActiveTab("groups")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${activeTab === "groups"
                  ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50 border-transparent"
                  }`}
              >
                <Users size={15} className="mr-3 shrink-0" />
                <span>一级受众管理</span>
              </button>

              <button
                onClick={() => setActiveTab("categories")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${activeTab === "categories"
                  ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50 border-transparent"
                  }`}
              >
                <FolderHeart size={15} className="mr-3 shrink-0" />
                <span>二级大类管理</span>
              </button>

              <button
                onClick={() => setActiveTab("dictionary")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${activeTab === "dictionary"
                  ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50 border-transparent"
                  }`}
              >
                <FileSpreadsheet size={15} className="mr-3 shrink-0" />
                <span>原料字典管理</span>
              </button>

              <button
                onClick={() => setActiveTab("ledger_helpers")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${activeTab === "ledger_helpers"
                  ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50 border-transparent"
                  }`}
              >
                <Settings size={15} className="mr-3 shrink-0" />
                <span>台账人员与供货商</span>
              </button>

              <button
                onClick={() => setActiveTab("system")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${activeTab === "system"
                  ? "bg-red-50 border-red-500 text-red-700 font-bold"
                  : "text-slate-600 hover:bg-slate-50 border-transparent"
                  }`}
              >
                <Database size={15} className="mr-3 shrink-0" />
                <span>系统维护</span>
              </button>
            </nav>
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50">
            <div className="text-[10px] text-slate-500 font-bold">后台连接状态</div>
            <div className="flex items-center space-x-1.5 mt-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-[10px] text-slate-700 font-semibold">物理缓存隔离运行中</span>
            </div>
          </div>
        </aside>

        {/* 右侧核心功能工作盘 */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6 bg-slate-50">
          {activeTab === "groups" && <AdminGroupsTab />}
          {activeTab === "dictionary" && <AdminDictTab showConfirm={showConfirm} />}
          {activeTab === "ledger_helpers" && <AdminLedgerHelpersTab showConfirm={showConfirm} />}
          {activeTab === "system" && <AdminSystemTab showConfirm={showConfirm} />}
          {activeTab === "categories" && (
            <div className="space-y-6 max-w-4xl animate-fade-in">
              <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div className="flex items-center space-x-2.5">
                    <FolderHeart className="text-teal-600" size={18} />
                    <h3 className="text-sm font-bold text-slate-900">二级食材供应品类（记账大分类）</h3>
                  </div>
                  <span className="text-[10px] bg-teal-50 text-teal-700 font-mono px-2 py-0.5 rounded-full font-extrabold">
                    {activeCategoriesList.length} 项大类
                  </span>
                </div>

                {/* 品类列表 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                  {activeCategoriesList.map((cat) => {
                    const isUnderEdit = editingCatKey === cat.key;
                    return (
                      <div
                        key={cat.key}
                        className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-all ${isUnderEdit
                          ? "bg-teal-50/50 border-teal-300 shadow-xs"
                          : "bg-slate-50 border-slate-150 hover:bg-slate-100"
                          }`}
                      >
                        <div>
                          <span className="font-extrabold text-slate-800 flex items-center gap-1.5">
                            {cat.label}类
                            {cat.isDefault && (
                              <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.2 rounded font-bold" title="系统默认大类，不允许删除">
                                默认
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 block mt-0.5">ID: {cat.key}</span>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleStartEditCat(cat)}
                            className="p-1.5 text-slate-500 hover:text-teal-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                            title="编辑大类名称"
                            disabled={isUnderEdit}
                          >
                            <Edit2 size={12} />
                          </button>
                          {cat.isDefault ? (
                            <span className="p-1.5 text-slate-300 cursor-not-allowed" title="系统默认大类，不允许删除">
                              <Lock size={12} />
                            </span>
                          ) : (
                            <button
                              onClick={() => handleDeleteCat(cat.key)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                              title="删除该分类及其所有底栏菜品"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 新增/编辑大类表单 */}
                <form onSubmit={handleSaveCatSubmit} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-3">
                    <Sparkles size={13} className="text-teal-600" />
                    {editingCatKey ? "编辑食材大类属性名称" : "新增二级食材供应核心大类"}
                  </h4>

                  {catError && (
                    <div className="text-[11px] bg-rose-50 text-rose-600 p-2.5 rounded border border-rose-100 mb-3 flex items-center space-x-1.5">
                      <ShieldAlert size={12} className="shrink-0" />
                      <span>{catError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">大类唯一Key (系统自动分配)</label>
                      <input
                        type="text"
                        value={catKeyInput}
                        disabled={true}
                        className="w-full bg-slate-100 text-slate-400 text-xs p-2 border border-slate-355 rounded outline-none font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">品类中文显示标签</label>
                      <input
                        type="text"
                        placeholder="如: 水果类, 粮油调料"
                        value={catLabelInput}
                        onChange={(e) => setCatLabelInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end items-center mt-3.5 space-x-2">
                    {editingCatKey && (
                      <button
                        type="button"
                        onClick={handleCancelCatEdit}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-800 rounded text-xs cursor-pointer flex items-center space-x-1"
                      >
                        <X size={12} />
                        <span>取消编辑</span>
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs cursor-pointer font-bold flex items-center space-x-1 shadow-sm"
                    >
                      {editingCatKey ? <Check size={12} /> : <PlusCircle size={12} />}
                      <span>{editingCatKey ? "保存类别" : "建立供应大类"}</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* 原料大底库字典管理 Tab 页 */}
          {activeTab === "dictionary" && (
            <AdminDictTab activeCategoriesList={activeCategoriesList} />
          )}

          {/* 台账常用人员与供货商字典 Tab 页 */}
          {activeTab === "ledger_helpers" && (
            <AdminLedgerHelpersTab />
          )}

        </main>
      </div>

      {/* 自定义安全确认弹窗 (Custom Beautiful State Confirmation Modal) */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden transform transition-all animate-scale-in">
            <div className="p-5 space-y-4">
              <div className="flex items-start space-x-3">
                <div className={`p-2.5 rounded-full shrink-0 ${confirmModal.type === "danger"
                  ? "bg-rose-50 text-rose-600 border border-rose-100"
                  : confirmModal.type === "warn"
                    ? "bg-amber-50 text-amber-600 border border-amber-100"
                    : "bg-teal-50 text-teal-600 border border-teal-100"
                  }`}>
                  {confirmModal.type === "danger" ? (
                    <Trash2 size={20} />
                  ) : confirmModal.type === "warn" ? (
                    <ShieldAlert size={20} />
                  ) : (
                    <Check size={20} />
                  )}
                </div>
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight leading-6">
                    {confirmModal.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed break-words">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 px-5 py-3.5 flex items-center justify-end space-x-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-3.5 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-800 rounded text-xs font-medium cursor-pointer transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className={`px-4 py-1.5 text-white rounded text-xs font-bold cursor-pointer shadow-xs transition-colors ${confirmModal.type === "danger"
                  ? "bg-rose-600 hover:bg-rose-700 animate-pulse"
                  : confirmModal.type === "warn"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-teal-600 hover:bg-teal-700"
                  }`}
              >
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
