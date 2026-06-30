/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { PrepReportService } from "../store.ts";
import { LedgerService } from "../ledgerStore.ts";
import { DynamicGroup, DynamicCategory, GroupMonthlyReport, FoodCategory } from "../types.ts";
import { LogView } from "./LogView.tsx";
import { LogBroker, getDaysInMonth, convertAllGroupsToCsv } from "../utils.ts";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { 
  Users, 
  Settings, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  PlusCircle, 
  FolderHeart, 
  CalendarDays, 
  ShieldAlert, 
  Sparkles, 
  ChevronLeft,
  FileSpreadsheet,
  FileJson,
  RotateCcw
} from "lucide-react";

/**
 * @description 管理后台配置页入参接口 (AdminBackendProps)
 */
interface AdminBackendProps {
  /** 当前系统的完整月度报表集 */
  reports: GroupMonthlyReport[];
  /** 当前激活的一级人群列表 */
  activeGroupsList: DynamicGroup[];
  /** 当前激活的二级食材大类列表 */
  activeCategoriesList: DynamicCategory[];
  /** 退出后台回到备餐主大厅的回调 */
  onClose: () => void;
  /** 初始化演示数据的重算回调 */
  onResetToSeeds: (data: GroupMonthlyReport[]) => void;
  /** 安全导入备份包的重算回调 */
  onImportBackup: (data: GroupMonthlyReport[]) => void;
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
 * @description 智能后厨配置管理后台组件，支持一级餐位人群及二级食材大类的增删改查(CRUD)，附带实时监控日志与行政核销中心
 */
export const AdminBackend: React.FC<AdminBackendProps> = ({
  reports,
  activeGroupsList,
  activeCategoriesList,
  onClose,
  onResetToSeeds,
  onImportBackup
}) => {
  // ================= 状态声明部分 =================

  // --- 导航状态 ---
  /** 
   * @description 当前激活的子功能页面。'groups'代表客群管理，'categories'代表大类管理，'maintenance'代表数据维护，'logs'代表内核日志 
   */
  const [activeTab, setActiveTab] = useState<"groups" | "categories" | "dictionary" | "maintenance" | "logs">("groups");

  // --- 自定义确认弹窗状态 ---
  /** 
   * @description 物理弹窗配置状态，用以解决 native confirm() 在 iframe 预览被拦截的问题 
   */
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    type: "info"
  });

  // --- 一级人群管理相关内部状态 ---
  /** 
   * @description 人群标识Key输入值 (英数大写) 
   */
  const [groupKeyInput, setGroupKeyInput] = useState<string>("");
  /** 
   * @description 人群中文名输入值 
   */
  const [groupLabelInput, setGroupLabelInput] = useState<string>("");
  /** 
   * @description 人群外观展示 Emoji 表情符号 
   */
  const [groupEmojiInput, setGroupEmojiInput] = useState<string>("🍽️");
  /** 
   * @description 处于编辑态的 Group 标识 Key，为 null 代表当前是新增模式 
   */
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);

  // --- 二级大类管理相关内部状态 ---
  /** 
   * @description 食材供应分类标识Key输入值 (英数大写) 
   */
  const [catKeyInput, setCatKeyInput] = useState<string>("");
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
   * @description 一级人群操作异常文字提示 
   */
  const [groupError, setGroupError] = useState<string | null>(null);
  /** 
   * @description 二级食材大类操作异常文字提示 
   */
  const [catError, setCatError] = useState<string | null>(null);

  // --- 原料字典管理相关内部状态 ---
  const [dictItems, setDictItems] = useState(() => RawMaterialsDictService.getItems());
  const [dictNameInput, setDictNameInput] = useState<string>("");
  const [dictCategoryInput, setDictCategoryInput] = useState<FoodCategory>(FoodCategory.VEGETABLE);
  const [dictUnitInput, setDictUnitInput] = useState<string>("斤");
  const [dictRemarkInput, setDictRemarkInput] = useState<string>("");
  // 换算单位与换算比例配置
  const [dictConversionUnitInput, setDictConversionUnitInput] = useState<string>("");
  const [dictConversionRatioInput, setDictConversionRatioInput] = useState<string>("");
  const [editingDictName, setEditingDictName] = useState<string | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);

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

  // ================= 一级受众人群 C.R.U.D. 执行方法 =================

  /**
   * @description 提交保存一级客户人群配置
   * @param e 表单提交事件
   */
  const handleSaveGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupError(null);

    if (!groupLabelInput.trim()) {
      setGroupError("受众人群显名标签不能为空！");
      return;
    }

    const targetKey = editingGroupKey || ("GROUP_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4)).toUpperCase();

    try {
      await PrepReportService.saveGroup(targetKey, groupLabelInput, groupEmojiInput);
      LogBroker.publish("INFO", "AdminBackend", `配置后台成功落盘一级餐卡人群：${groupLabelInput} (${targetKey})`);
      
      setGroupKeyInput("");
      setGroupLabelInput("");
      setGroupEmojiInput("🍽️");
      setEditingGroupKey(null);
    } catch (err: any) {
      setGroupError(err.message || "存储人群配置时发生了未知错误");
    }
  };

  /**
   * @description 启动对人群项的编辑回填
   * @param group 目标人群数据对象
   */
  const handleStartEditGroup = (group: DynamicGroup) => {
    setGroupError(null);
    setEditingGroupKey(group.key);
    setGroupKeyInput(group.key);
    setGroupLabelInput(group.label);
    setGroupEmojiInput(group.emoji);
  };

  /**
   * @description 彻底物理删除群组，使用自定义弹框取代 window.confirm()
   * @param key 目标人群标识 Key
   */
  const handleDeleteGroup = (key: string) => {
    const group = activeGroupsList.find((g) => g.key === key);
    const label = group ? group.label : key;

    showConfirm(
      "危险：彻底删除受众人群",
      `您确定要彻底物理移出一级备餐客群「${label}」吗？此动作会级联抹除系统内部该人群在所有品类下的月度记账矩阵明细，使其所有日度录入金额永久清置丢失！此过程不可逆转，确定继续？`,
      async () => {
        try {
          await PrepReportService.deleteGroup(key);
          LogBroker.publish("WARN", "AdminBackend", `配置后台物理移除了群组: ${key}`);
          if (editingGroupKey === key) {
            setEditingGroupKey(null);
            setGroupKeyInput("");
            setGroupLabelInput("");
            setGroupEmojiInput("🍽️");
          }
        } catch (err: any) {
          setGroupError(err.message || "删除人群配置失败");
        }
      },
      "danger"
    );
  };

  /**
   * @description 终止并清空当前人群编辑状态
   */
  const handleCancelGroupEdit = () => {
    setEditingGroupKey(null);
    setGroupKeyInput("");
    setGroupLabelInput("");
    setGroupEmojiInput("🍽️");
    setGroupError(null);
  };
  // ================= 原料字典管理 C.R.U.D. 执行方法 =================

  /**
   * @description 提交保存原料字典配置
   */
  const handleSaveDictSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDictError(null);

    const name = dictNameInput.trim();
    if (!name) {
      setDictError("原料名称不能为空！");
      return;
    }

    const conversionUnit = dictConversionUnitInput.trim() || undefined;
    const conversionRatio = dictConversionRatioInput.trim() ? Number(dictConversionRatioInput) : undefined;

    if (conversionRatio !== undefined && isNaN(conversionRatio)) {
      setDictError("换算比例必须是有效的数值！");
      return;
    }

    try {
      if (editingDictName) {
        await RawMaterialsDictService.updateMaterial(
          editingDictName, 
          name, 
          dictCategoryInput, 
          dictUnitInput, 
          dictRemarkInput,
          conversionUnit,
          conversionRatio
        );
      } else {
        await RawMaterialsDictService.addMaterial(
          name, 
          dictCategoryInput, 
          dictUnitInput, 
          dictRemarkInput,
          conversionUnit,
          conversionRatio
        );
      }
      setDictItems([...RawMaterialsDictService.getItems()]);
      setDictNameInput("");
      setDictUnitInput("斤");
      setDictRemarkInput("");
      setDictConversionUnitInput("");
      setDictConversionRatioInput("");
      setDictCategoryInput(FoodCategory.VEGETABLE);
      setEditingDictName(null);
    } catch (err: any) {
      setDictError(err.message || "保存原料时发生错误");
    }
  };

  /**
   * @description 启动对原料项的编辑回填
   */
  const handleStartEditDict = (item: any) => {
    setDictError(null);
    setEditingDictName(item.name);
    setDictNameInput(item.name);
    setDictCategoryInput(item.category);
    setDictUnitInput(item.unit);
    setDictRemarkInput(item.remark || "");
    setDictConversionUnitInput(item.conversionUnit || "");
    setDictConversionRatioInput(item.conversionRatio !== undefined ? String(item.conversionRatio) : "");
  };

  /**
   * @description 删除原料记录
   */
  const handleDeleteDict = (name: string) => {
    showConfirm(
      "危险：删除原料字典项",
      `您确定要删除原料「${name}」吗？这不会自动删除已有台账明细，但该原料在以后录入时将无法通过下拉快速查找。确定继续？`,
      async () => {
        await RawMaterialsDictService.deleteMaterial(name);
        setDictItems([...RawMaterialsDictService.getItems()]);
        if (editingDictName === name) {
          setEditingDictName(null);
          setDictNameInput("");
          setDictUnitInput("斤");
          setDictRemarkInput("");
          setDictConversionUnitInput("");
          setDictConversionRatioInput("");
          setDictCategoryInput(FoodCategory.VEGETABLE);
        }
      },
      "warn"
    );
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

      setCatKeyInput("");
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
            setCatKeyInput("");
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
    setCatKeyInput("");
    setCatLabelInput("");
    setCatError(null);
  };

  // ================= 数据维护与备份迁移方法 =================

  /**
   * @description 导出全人群备餐备份包 (JSON本地文件)
   */
  const handleExportBackup = () => {
    try {
      const dataStr = JSON.stringify(reports, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `后厨备餐账目全套备份_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      LogBroker.publish("INFO", "AdminBackend", `配置后台：已成功生成并下载全套 JSON 数据备份包。`);
    } catch (err: any) {
      LogBroker.publish("ERROR", "AdminBackend", "生成备份数据包失败：", err.message);
    }
  };

  /**
   * @description 导入已存的预算及食材配置备份包 (JSON)
   * @param e 控件文件改变事件
   */
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed) && parsed.length > 0 && parsed[0].targetGroup) {
          PrepReportService.importReports(parsed).then(() => {
            onImportBackup(parsed);
            LogBroker.publish("INFO", "AdminBackend", "配置后台：已安全覆盖导入备餐底盘，重绘前端。");
          });
        } else {
          throw new Error("识别标志缺失：JSON数据并非合规的后厨月度备份。");
        }
      } catch (err: any) {
        alert(`导入数据失败：${err.message}`);
        LogBroker.publish("ERROR", "AdminBackend", "数据包反序列化校验拦截:", err.message);
      }
    };
    reader.readAsText(file);
  };

  /**
   * @description 统一清空全受众人群当月预算与账目记录 (用 React 弹窗完美代替 confirm)
   */
  const handleClearMonth = () => {
    showConfirm(
      "安全核销：清空当月记账数据",
      "🚨 警告：该操作将清空全人群、全餐饮分类下共计31天的全部日度记账单元格数值（用料用量、参考单价、计算总价均物理归零），保留食材和客群名录骨架。此操作不可逆，确定继续？",
      () => {
        PrepReportService.clearAllMonthlyCells().then(() => {
          LogBroker.publish("WARN", "AdminBackend", "已完成底册各类别极速记账单元格全清置零。");
        });
      },
      "danger"
    );
  };

  /**
   * @description 恢复演示内置蔬菜、粮油及肉类出厂默认数据种子 (用 React 弹窗替代 confirm)
   */
  const handleResetToSeeds = () => {
    showConfirm(
      "出厂复位：重新恢复演示种子",
      "您确定要执行系统复位并导入示例数据吗？这会抹除您当前建立的所有客群标签、大类分类及所有自定义录入，并重新装载预设的标准中式后厨演示人设与各品类示范月度底账！",
      () => {
        PrepReportService.factoryReset().then((data) => {
          onResetToSeeds(data);
          LogBroker.publish("INFO", "AdminBackend", "配置后台：全局销毁本地缓存并重绘了出厂预置种子。");
        });
      },
      "warn"
    );
  };

  /**
   * @description 物理彻底清空购销库存台账全量数据 (用 React 弹窗替代 confirm)
   */
  const handleClearLedgerAll = () => {
    showConfirm(
      "安全核销：清空购销台账数据",
      "🚨 警告：该操作将物理清除整个原料购销库存系统下的所有台账、采购原料采购项目、以及所有的历史出入库与当前库存数据，使台账全库归零！此操作不可逆，确定继续？",
      () => {
        LedgerService.clearAllLedgerData().then(() => {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
          LogBroker.publish("WARN", "AdminBackend", "已完成购销库存台账的物理清空全库操作。");
        });
      },
      "danger"
    );
  };

  /**
   * @description 恢复购销台账系统至出厂初始种子数据 (用 React 弹窗替代 confirm)
   */
  const handleResetLedgerSeeds = () => {
    showConfirm(
      "出厂复位：恢复购销台账预设",
      "您确定要执行购销台账系统复位并导入初始预设吗？这会抹除您当前建立的所有台账、自定义采购原料以及录入的出入库数据，并重新装载幼儿、教师、幼儿晚餐、在校生四个默认台账及预设原料种子！",
      () => {
        LedgerService.factoryResetLedger().then(() => {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
          LogBroker.publish("INFO", "AdminBackend", "配置后台：已重新合成并加载购销台账系统的出厂种子数据。");
        });
      },
      "warn"
    );
  };

  /**
   * @description 将所有的表格汇总并导出为 Excel 兼容 CSV 宽表格
   */
  const handleExportAllGroupsCsv = () => {
    try {
      const year = reports[0]?.year || new Date().getFullYear();
      const month = reports[0]?.month || new Date().getMonth() + 1;
      const days = getDaysInMonth(year, month);
      const csvText = convertAllGroupsToCsv(reports, days, activeGroupsList, activeCategoriesList);
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `后厨全餐位客群备菜账目月度汇总明细_${year}年${month}月_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      LogBroker.publish("INFO", "AdminBackend", `配置后台：成功将所有餐卡客群的日度记账矩阵汇总打包导出为 Excel CSV。`);
    } catch (err: any) {
      LogBroker.publish("ERROR", "AdminBackend", "导出餐卡人群汇总大宽表发生错误：", err.message);
    }
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
            <span>返回后厨记账主厅</span>
          </button>
          
          <div className="h-4 w-[1px] bg-slate-700" />
          <div className="flex items-center space-x-2">
            <Settings className="text-emerald-400 animate-spin-slow" size={18} />
            <h2 className="text-sm font-extrabold tracking-tight">后厨配置中央管理后台</h2>
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
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${
                  activeTab === "groups"
                    ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                    : "text-slate-600 hover:bg-slate-50 border-transparent"
                }`}
              >
                <Users size={15} className="mr-3 shrink-0" />
                <span>一级受众管理</span>
              </button>

              <button
                onClick={() => setActiveTab("categories")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${
                  activeTab === "categories"
                    ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                    : "text-slate-600 hover:bg-slate-50 border-transparent"
                }`}
              >
                <FolderHeart size={15} className="mr-3 shrink-0" />
                <span>二级大类管理</span>
              </button>

              <button
                onClick={() => setActiveTab("dictionary")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${
                  activeTab === "dictionary"
                    ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                    : "text-slate-600 hover:bg-slate-50 border-transparent"
                }`}
              >
                <FileSpreadsheet size={15} className="mr-3 shrink-0" />
                <span>原料字典管理</span>
              </button>

              <button
                onClick={() => setActiveTab("maintenance")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${
                  activeTab === "maintenance"
                    ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                    : "text-slate-600 hover:bg-slate-50 border-transparent"
                }`}
              >
                <ShieldAlert size={15} className="mr-3 shrink-0" />
                <span>数据维护核销</span>
              </button>

              <button
                onClick={() => setActiveTab("logs")}
                className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all border-r-4 ${
                  activeTab === "logs"
                    ? "bg-teal-50 border-teal-500 text-teal-700 font-bold"
                    : "text-slate-600 hover:bg-slate-50 border-transparent"
                }`}
              >
                <CalendarDays size={15} className="mr-3 shrink-0" />
                <span>系统审计日志</span>
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
          
          {/* 一级人群管理 Tab 页 */}
          {activeTab === "groups" && (
            <div className="space-y-6 max-w-4xl animate-fade-in">
              <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div className="flex items-center space-x-2.5">
                    <Users className="text-teal-600" size={18} />
                    <h3 className="text-sm font-bold text-slate-900">一级餐位人群标签（级联决策根）</h3>
                  </div>
                  <span className="text-[10px] bg-teal-50 text-teal-700 font-mono px-2 py-0.5 rounded-full font-extrabold">
                    {activeGroupsList.length} 项聚焦
                  </span>
                </div>

                {/* 人群列表 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                  {activeGroupsList.map((group) => {
                    const isUnderEdit = editingGroupKey === group.key;
                    return (
                      <div 
                        key={group.key}
                        className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-all ${
                          isUnderEdit 
                            ? "bg-teal-50/50 border-teal-300 shadow-xs" 
                            : "bg-slate-50 border-slate-150 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-base p-1 bg-white rounded shadow-2xs">{group.emoji}</span>
                          <div>
                            <span className="font-bold text-slate-800">{group.label}</span>
                            <span className="text-[10px] font-mono text-slate-400 block mt-0.5">ID: {group.key}</span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleStartEditGroup(group)}
                            className="p-1.5 text-slate-500 hover:text-teal-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                            title="编辑修改标签"
                            disabled={isUnderEdit}
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteGroup(group.key)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                            title="删除该人群及其所有报表"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 新增/编辑表单 */}
                <form onSubmit={handleSaveGroupSubmit} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-3">
                    <Sparkles size={13} className="text-teal-600" />
                    {editingGroupKey ? "编辑受众人群标签属性" : "新增一级客户餐卡受众群体"}
                  </h4>

                  {groupError && (
                    <div className="text-[11px] bg-rose-50 text-rose-600 p-2.5 rounded border border-rose-100 mb-3 flex items-center space-x-1.5">
                      <ShieldAlert size={12} className="shrink-0" />
                      <span>{groupError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">唯一识别Key</label>
                      <input
                        type="text"
                        value={editingGroupKey ? groupKeyInput : "系统自动分配（只读）"}
                        disabled={true}
                        className="w-full bg-slate-100 text-xs text-slate-500 p-2 border border-slate-200 rounded outline-none font-mono opacity-70"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">餐客群中文显示名称</label>
                      <input
                        type="text"
                        placeholder="如: 学前班膳食"
                        value={groupLabelInput}
                        onChange={(e) => setGroupLabelInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">外观展示Emoji</label>
                      <select
                        value={groupEmojiInput}
                        onChange={(e) => setGroupEmojiInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                      >
                        {["🍽️", "👶", "🎒", "👩‍🏫", "🏫", "👨‍🍳", "🍲", "🍚", "🍎", "🥛", "🥯", "🍗", "🥪", "🥗", "🍇", "🍊"].map((em) => (
                          <option key={em} value={em}>{em}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end items-center mt-3.5 space-x-2">
                    {editingGroupKey && (
                      <button
                        type="button"
                        onClick={handleCancelGroupEdit}
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
                      {editingGroupKey ? <Check size={12} /> : <PlusCircle size={12} />}
                      <span>{editingGroupKey ? "保存修改" : "确认新增群体"}</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* 食材大类管理 Tab 页 */}
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
                        className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-all ${
                          isUnderEdit 
                            ? "bg-teal-50/50 border-teal-300 shadow-xs" 
                            : "bg-slate-50 border-slate-150 hover:bg-slate-100"
                        }`}
                      >
                        <div>
                          <span className="font-extrabold text-slate-800">{cat.label}类</span>
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
                          <button
                            onClick={() => handleDeleteCat(cat.key)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                            title="删除该分类及其所有底栏菜品"
                          >
                            <Trash2 size={12} />
                          </button>
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
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">大类英数字Key(系统唯一值)</label>
                      <input
                        type="text"
                        placeholder="如: SPICE"
                        value={catKeyInput}
                        onChange={(e) => setCatKeyInput(e.target.value)}
                        disabled={editingCatKey !== null}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none uppercase font-mono disabled:opacity-50"
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
            <div className="space-y-6 max-w-4xl animate-fade-in">
              <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div className="flex items-center space-x-2.5">
                    <FileSpreadsheet className="text-teal-600" size={18} />
                    <h3 className="text-sm font-bold text-slate-900">核心原料库字典管理</h3>
                  </div>
                  <span className="text-[10px] bg-teal-50 text-teal-700 font-mono px-2 py-0.5 rounded-full font-extrabold">
                    {dictItems.length} 项原料已注册
                  </span>
                </div>

                {/* 原料卡片列表 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
                  {dictItems.map((item) => {
                    const isUnderEdit = editingDictName === item.name;
                    return (
                      <div 
                        key={item.name}
                        className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-all ${
                          isUnderEdit 
                            ? "bg-teal-50/50 border-teal-300 shadow-xs" 
                            : "bg-slate-50 border-slate-150 hover:bg-slate-100"
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-extrabold text-slate-800 truncate block">{item.name}</span>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.2 rounded">
                              {item.unit}
                            </span>
                            <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.2 rounded font-medium">
                              {item.category}
                            </span>
                            {item.remark && (
                              <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.2 rounded font-bold border border-amber-200 max-w-[120px] truncate" title={item.remark}>
                                {item.remark}
                              </span>
                            )}
                            {item.conversionUnit && item.conversionRatio && (
                              <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.2 rounded font-bold border border-emerald-200">
                                换算: {item.conversionRatio}{item.conversionUnit}/{item.unit}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            onClick={() => handleStartEditDict(item)}
                            className="p-1 text-slate-500 hover:text-teal-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                            title="编辑原料"
                            disabled={isUnderEdit}
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDeleteDict(item.name)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer transition-all"
                            title="删除原料"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 新增/编辑原料表单 */}
                <form onSubmit={handleSaveDictSubmit} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-3">
                    <Sparkles size={13} className="text-teal-600" />
                    {editingDictName ? "修改已有原料属性定义" : "增添全新食品与备品原料记录"}
                  </h4>

                  {dictError && (
                    <div className="text-[11px] bg-rose-50 text-rose-600 p-2.5 rounded border border-rose-100 mb-3 flex items-center space-x-1.5">
                      <ShieldAlert size={12} className="shrink-0" />
                      <span>{dictError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">原料品名(如: 大米)</label>
                      <input
                        type="text"
                        placeholder="如: 西蓝花"
                        value={dictNameInput}
                        onChange={(e) => setDictNameInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">所属二级食材大类</label>
                      <select
                        value={dictCategoryInput}
                        onChange={(e) => setDictCategoryInput(e.target.value as FoodCategory)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                      >
                        {activeCategoriesList.map((cat) => (
                          <option key={cat.key} value={cat.key}>
                            {cat.label} ({cat.key})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">默认单位(如: 袋/箱/瓶)</label>
                      <input
                        type="text"
                        placeholder="如: 袋"
                        value={dictUnitInput}
                        onChange={(e) => setDictUnitInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">备注(规格，如: 25kg/袋)</label>
                      <input
                        type="text"
                        placeholder="如: 25kg/袋"
                        value={dictRemarkInput}
                        onChange={(e) => setDictRemarkInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">换算单位(选填，如: 斤)</label>
                      <input
                        type="text"
                        placeholder="如: 斤"
                        value={dictConversionUnitInput}
                        onChange={(e) => setDictConversionUnitInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">换算比例(袋/箱折合数，如: 50)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="如: 50"
                        value={dictConversionRatioInput}
                        onChange={(e) => setDictConversionRatioInput(e.target.value)}
                        className="w-full bg-white text-xs text-slate-800 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end items-center mt-3.5 space-x-2">
                    {editingDictName && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDictName(null);
                          setDictNameInput("");
                          setDictUnitInput("斤");
                          setDictRemarkInput("");
                          setDictConversionUnitInput("");
                          setDictConversionRatioInput("");
                          setDictCategoryInput(FoodCategory.VEGETABLE);
                        }}
                        className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs cursor-pointer font-bold transition-all"
                      >
                        取消编辑
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs cursor-pointer font-bold flex items-center space-x-1 shadow-sm"
                    >
                      {editingDictName ? <Check size={12} /> : <PlusCircle size={12} />}
                      <span>{editingDictName ? "保存原料属性" : "添加至原料库"}</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* 数据维护与行政核销中心 Tab 页 */}
          {activeTab === "maintenance" && (
            <div className="space-y-6 max-w-4xl animate-fade-in">
              <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div className="flex items-center space-x-2.5">
                    <ShieldAlert className="text-amber-600" size={18} />
                    <h3 className="text-sm font-bold text-slate-900">数据行政维护与多维备份核销中心 (Administrative Data Care & Backups)</h3>
                  </div>
                  <span className="text-[10px] bg-amber-50 text-amber-700 font-mono px-2.5 py-0.5 rounded-full font-extrabold tracking-wide">
                    ADMIN-AUTHORIZED INSTRUCTIONS ONLY
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  
                  {/* CSV 导出汇总 */}
                  <button
                    onClick={handleExportAllGroupsCsv}
                    className="flex flex-col items-center justify-center p-4 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="一键将所有餐卡人群在所有类目下的31日备菜矩阵打包导出为一份Excel兼容的CSV大宽表"
                  >
                    <div className="w-9 h-9 bg-emerald-500 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <FileSpreadsheet size={18} />
                    </div>
                    <span className="text-xs font-bold">按人群导出全表 (CSV)</span>
                    <span className="text-[9px] text-emerald-600 font-medium">适合 Excel 宏观核算与多维透视</span>
                  </button>

                  {/* JSON 备份导出 */}
                  <button
                    onClick={handleExportBackup}
                    className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="导出当前后厨全量人群、分类以及记账数值的JSON备份包"
                  >
                    <div className="w-9 h-9 bg-slate-600 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <FileJson size={18} />
                    </div>
                    <span className="text-xs font-bold">导出备份数据 (JSON)</span>
                    <span className="text-[9px] text-slate-500">用于跨设备或异地系统备份还原</span>
                  </button>

                  {/* JSON 备份导入 */}
                  <label
                    className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="导入此前下载好的 JSON 格式数据备份文件包"
                  >
                    <div className="w-9 h-9 bg-slate-600 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <RotateCcw size={18} className="rotate-180" />
                    </div>
                    <span className="text-xs font-bold">导入备份数据 (JSON)</span>
                    <span className="text-[9px] text-slate-500">自动解析、安全校验并覆盖底册</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportBackup}
                      className="hidden"
                    />
                  </label>

                  {/* 清空当月录入 (用 React 自定义弹框完美支持 iframe) */}
                  <button
                    onClick={handleClearMonth}
                    className="flex flex-col items-center justify-center p-4 bg-rose-50 hover:bg-rose-100/80 border border-rose-200 text-rose-800 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="一键将所有受众人群、所有大品类的全部日度数量、单价、金额物理归零清屏"
                  >
                    <div className="w-9 h-9 bg-rose-500 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <Trash2 size={18} />
                    </div>
                    <span className="text-xs font-bold text-rose-700">清空当月录入数据</span>
                    <span className="text-[9px] text-rose-500 font-semibold">月度账单结转或重新起草</span>
                  </button>

                  {/* 恢复演示种子数据 (用 React 自定义弹框完美支持 iframe) */}
                  <button
                    onClick={handleResetToSeeds}
                    className="flex flex-col items-center justify-center p-4 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="清除当前所有配置，拉回系统出厂预设的教工、幼儿等三大类品目和示例账目"
                  >
                    <div className="w-9 h-9 bg-amber-500 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <Sparkles size={18} />
                    </div>
                    <span className="text-xs font-bold text-amber-700">恢复演示种子数据</span>
                    <span className="text-[9px] text-amber-500 font-semibold">一键重置、装载标准中式后厨样本</span>
                  </button>

                  {/* 清空原料购销台账数据 */}
                  <button
                    onClick={handleClearLedgerAll}
                    className="flex flex-col items-center justify-center p-4 bg-rose-50 hover:bg-rose-100/80 border border-rose-200 text-rose-800 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="一键将所有原料台账下的入库、出库、金额以及当前库存物理清除清空"
                  >
                    <div className="w-9 h-9 bg-rose-600 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <Trash2 size={18} />
                    </div>
                    <span className="text-xs font-bold text-rose-700">清空购销台账数据</span>
                    <span className="text-[9px] text-rose-500 font-semibold">物理清空全库、重新开始台账录入</span>
                  </button>

                  {/* 恢复购销台账种子预设 */}
                  <button
                    onClick={handleResetLedgerSeeds}
                    className="flex flex-col items-center justify-center p-4 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 rounded-lg cursor-pointer transition-all text-center space-y-2 h-32 shadow-2xs group"
                    title="清除所有自定义台账和原料，恢复幼儿、教师、幼儿晚餐、在校生四个初始台账及预设原料"
                  >
                    <div className="w-9 h-9 bg-amber-600 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-all">
                      <Sparkles size={18} />
                    </div>
                    <span className="text-xs font-bold text-amber-700">恢复购销台账初始预设</span>
                    <span className="text-[9px] text-amber-500 font-semibold">装载幼儿/教师等四大初始购销台账</span>
                  </button>

                </div>
              </section>
            </div>
          )}

          {/* 系统调试审计日志 Tab 页 */}
          {activeTab === "logs" && (
            <div className="space-y-6 max-w-4xl animate-fade-in">
              <section className="border border-slate-200 bg-white rounded-xl p-5 shadow-xs">
                <div className="flex items-center space-x-2.5 border-b border-slate-100 pb-3 mb-4">
                  <CalendarDays className="text-teal-600 hover:animate-pulse" size={18} />
                  <h3 className="text-sm font-extrabold text-slate-900">系统进程通信与内核性能日志 (审计区)</h3>
                </div>
                
                <LogView />
              </section>
            </div>
          )}

        </main>
      </div>

      {/* 自定义安全确认弹窗 (Custom Beautiful State Confirmation Modal) */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden transform transition-all animate-scale-in">
            <div className="p-5 space-y-4">
              <div className="flex items-start space-x-3">
                <div className={`p-2.5 rounded-full shrink-0 ${
                  confirmModal.type === "danger" 
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
                className={`px-4 py-1.5 text-white rounded text-xs font-bold cursor-pointer shadow-xs transition-colors ${
                  confirmModal.type === "danger"
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
