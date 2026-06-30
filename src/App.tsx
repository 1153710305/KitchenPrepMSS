/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useMemo } from "react";
import { FoodCategory, TargetGroup, GroupMonthlyReport, DynamicGroup, DynamicCategory } from "./types.ts";
import { UI_TEXT, ADMIN_PASSWORD, LOGIN_PASSWORD, TARGET_GROUP_LABELS, FOOD_CATEGORY_LABELS } from "./constants.ts";
import { PrepReportService } from "./store.ts";
import { TableGrid } from "./components/TableGrid.tsx";
import { StatisticsPanel } from "./components/StatisticsPanel.tsx";
import { HeadcountPanel } from "./components/HeadcountPanel.tsx";
import { AiAssistant } from "./components/AiAssistant.tsx";
import { AdminBackend } from "./components/AdminBackend.tsx";
import { LogBroker } from "./utils.ts";
import { LedgerSystem } from "./components/LedgerSystem.tsx";
import { LedgerService } from "./ledgerStore.ts";
import { 
  Settings, 
  RefreshCw, 
  ShieldAlert, 
  FolderDown, 
  FolderUp, 
  Database,
  LogOut,
  Lock,
  Menu,
  X
} from "lucide-react";

/**
 * @description 后厨备餐备料记账统计系统主入口组件
 */
export default function App() {
  // ================= 状态声明部分 =================

  /** 当前加载好的月度多客群报表数组 */
  const [reports, setReports] = useState<GroupMonthlyReport[]>([]);
  /** 当前激活聚焦决策的一级餐位人群唯一标识Key，默认 TEACHER */
  const [activeGroup, setActiveGroup] = useState<string>("TEACHER");
  /** 当前选中的二级食材品类。当设置为 null 时，代表“合计汇总”汇总表 */
  const [activeCategory, setActiveCategory] = useState<string | null>("VEGETABLE");
  
  /** 当前备餐查看选中的年份与月份 */
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);
  
  /** 系统离线架构自检与加载态指示 */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /** 自动同步极速轻量气泡提示文字 */
  const [saveToast, setSaveToast] = useState<string | null>(null);

  /** 移动端侧边栏开启状态 */
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

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
  /** 动态从底层存储库嗅探的一级人群分组 */
  const [activeGroupsList, setActiveGroupsList] = useState<DynamicGroup[]>([]);
  /** 动态从底层存储库嗅探的二级食材大类 */
  const [activeCategoriesList, setActiveCategoriesList] = useState<DynamicCategory[]>([]);
  /** 订阅的购销台账原料列表 */
  const [ledgerItemsList, setLedgerItemsList] = useState<any[]>([]);

  // ================= 动态配置计算属性 =================

  /**
   * @description 动态生成一级人群的中文显名映射字典，便于性能及状态归纳
   */
  const dynamicGroupLabels = useMemo(() => {
    const map: Record<string, string> = {};
    activeGroupsList.forEach((g) => {
      map[g.key] = g.label;
    });
    return map;
  }, [activeGroupsList]);

  /**
   * @description 动态生成一级人群的外观展示表情映射字典
   */
  const dynamicGroupEmojis = useMemo(() => {
    const map: Record<string, string> = {};
    activeGroupsList.forEach((g) => {
      map[g.key] = g.emoji;
    });
    return map;
  }, [activeGroupsList]);

  /**
   * @description 动态生成品类分类的中文名映射字典
   */
  const dynamicCategoryLabels = useMemo(() => {
    const map: Record<string, string> = {};
    activeCategoriesList.forEach((c) => {
      map[c.key] = c.label;
    });
    return map;
  }, [activeCategoriesList]);

  // ================= 数据加载及广播同步 =================

  // 1. 系统初始化，挂载并预检底层存储结构，同时订阅状态变动
  useEffect(() => {
    let active = true;
    PrepReportService.initStore().then((data) => {
      if (active) {
        setReports(data);
        const groups = PrepReportService.getActiveGroups();
        const cats = PrepReportService.getActiveCategories();
        setActiveGroupsList(groups);
        setActiveCategoriesList(cats);

        // 如果动态列表已经就绪，并且默认或先前的选中项不存在了，自适应调平到首项
        if (groups.length > 0 && !groups.some((g) => g.key === activeGroup)) {
          setActiveGroup(groups[0].key);
        }
        if (cats.length > 0 && activeCategory && !cats.some((c) => c.key === activeCategory)) {
          setActiveCategory(cats[0].key);
        }

        setIsLoading(false);
        LogBroker.publish("INFO", "App", "备餐管理控制中心完成数据模型全量自检引导");
      }
    });

    // 监听服务数据重大变动回调，实现各版块自动重算
    const unsubscribe = PrepReportService.subscribe((updated) => {
      if (active) {
        setReports(updated);
        const groups = PrepReportService.getActiveGroups();
        const cats = PrepReportService.getActiveCategories();
        setActiveGroupsList(groups);
        setActiveCategoriesList(cats);

        // 防止配置后台因级联删除而导致的悬空逻辑
        const groupKeys = groups.map((g) => g.key);
        const catKeys = cats.map((c) => c.key);

        setActiveGroup((prev) => {
          if (groupKeys.includes(prev)) return prev;
          return groupKeys[0] || "TEACHER";
        });

        setActiveCategory((prev) => {
          if (prev === null) return null;
          if (catKeys.includes(prev)) return prev;
          return catKeys[0] || "VEGETABLE";
        });

        // 触发自动存盘微气泡
        triggerSaveToast();
      }
    });

    // 监听原料台账数据的变动，为了能在 aside 底栏展示统计金额
    const unsubscribeLedger = LedgerService.subscribe((_ledgers, updatedItems) => {
      if (active) {
        setLedgerItemsList(updatedItems);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeLedger();
    };
  }, []);

  /** 
   * @description 触发极速防抖自动保存通知标签气泡
   */
  const triggerSaveToast = () => {
    setSaveToast(UI_TEXT.saveSuccess);
    const timer = setTimeout(() => {
      setSaveToast(null);
    }, 2500);
    return () => clearTimeout(timer);
  };

  const currentReport = useMemo(() => {
    if (activeGroup === "ANALYTICS" || activeGroup === "LEDGER") return null;
    return PrepReportService.getOrCreateReport(activeGroup, selectedYear, selectedMonth);
  }, [reports, activeGroup, selectedYear, selectedMonth]);

  // ================= 记账控制交互事务 =================

  /**
   * @description 单元格数值变动，通过底层Service无卡顿保存并更新内存状态物
   * @param itemId 行食材ID标识
   * @param day 日索引("1"-"31")
   * @param quantity 备菜数量数值
   * @param price 备菜单价值
   */
  const handleCellUpdate = (itemId: string, day: string, quantity: number, price: number) => {
    // 针对高强度记账性能进行了全流程非阻塞优化：单元格细节输入采用 TableGrid onBlur 机制打印操作日志
    PrepReportService.updateCell(itemId, day, quantity, price).catch((err) => {
      LogBroker.publish("ERROR", "App", "执行单元格物理变动写入时发生致命碰撞", String(err));
    });
  };

  /**
   * @description 就餐人数变动回调，通过底层 Service 保存并进行非阻塞热重绘
   * @param groupKey 一级目标受众人群唯一键
   * @param day 具体日期 ("1"-"31")
   * @param count 就餐人数数量
   */
  const handleHeadcountUpdate = (groupKey: string, day: string, count: number) => {
    PrepReportService.updateHeadcount(groupKey as TargetGroup, day, count).catch((err) => {
      LogBroker.publish("ERROR", "App", "执行就餐人数变动写入时发生致命碰撞", String(err));
    });
  };

  /**
   * @description 获取受众人群的中文名称（支持动态添加的人群）
   */
  const getGroupLabel = (groupKey: string) => {
    const g = activeGroupsList.find((g) => g.key === groupKey);
    return g ? g.label : (TARGET_GROUP_LABELS[groupKey as TargetGroup] || groupKey);
  };

  /**
   * @description 获取食材大类的中文名称（支持动态添加的分类）
   */
  const getCategoryLabel = (catKey: string) => {
    const c = activeCategoriesList.find((c) => c.key === catKey);
    return c ? c.label : (FOOD_CATEGORY_LABELS[catKey as FoodCategory] || catKey);
  };

  /**
   * @description 新增某种具体食材条目槽行
   * @param targetGroup 餐位受众人群分类
   * @param category 食材供应大品类
   * @param name 食物细分称呼（如: 土豆）
   * @param unit 记量单位
   */
  const handleAddItem = (targetGroup: TargetGroup, category: FoodCategory, name: string, unit: string) => {
    PrepReportService.addPreparedItem(targetGroup, category, name, unit).then(() => {
      const operator = isAdminMode ? "系统管理员" : "普通记账员";
      const groupLabel = getGroupLabel(targetGroup);
      const catLabel = getCategoryLabel(category);
      LogBroker.publish(
        "INFO",
        "App",
        `【新增备餐条目】操作员 [${operator}] 在「${groupLabel}」的 [${catLabel}类] 下成功新增了细分食材项目「${name}」（单位：${unit}）。`
      );
    }).catch((err) => {
      LogBroker.publish("ERROR", "App", "食材原料行新增阻滞:", String(err));
    });
  };

  /**
   * @description 彻底移除某种备餐具体食材大行
   * @param itemId 行食材ID
   */
  const handleDeleteItem = (itemId: string) => {
    const itemToDelete = reports.flatMap((r) => r.items).find((i) => i.id === itemId);
    if (!itemToDelete) return;

    if (confirm(`您确定要从此品类中永久删除该项备餐清单吗？对应的历史录入单金额将被瞬间清除。`)) {
      const operator = isAdminMode ? "系统管理员" : "普通记账员";
      const groupLabel = getGroupLabel(itemToDelete.targetGroup);
      const catLabel = getCategoryLabel(itemToDelete.category);

      PrepReportService.deletePreparedItem(itemId).then(() => {
        LogBroker.publish(
          "WARN",
          "App",
          `【删除备餐条目】操作员 [${operator}] 从「${groupLabel}」的 [${catLabel}类] 中彻底删除了细分食材项目「${itemToDelete.name}」（包括其月度所有的每日备量与价格明细）。`
        );
      }).catch((err) => {
        LogBroker.publish("ERROR", "App", "项目物理删除冲突:", String(err));
      });
    }
  };

  /**
   * @description 单元格一建列统一复制，自适应快速调价
   * @param targetGroup 受众人群分类
   * @param category 食材供应种类
   * @param day 作用的特定天
   * @param price 覆盖的单价新价格
   */
  const handleBatchPriceUpdate = (targetGroup: TargetGroup, category: FoodCategory, day: string, price: number) => {
    PrepReportService.batchUpdatePriceCol(targetGroup, category, day, price).then(() => {
      const operator = isAdminMode ? "系统管理员" : "普通记账员";
      const groupLabel = getGroupLabel(targetGroup);
      const catLabel = getCategoryLabel(category);
      LogBroker.publish(
        "INFO",
        "App",
        `【批量批量调价】操作员 [${operator}] 一键将「${groupLabel}」的 [${catLabel}类] 在 [${day}号] 的所有食材单价统一设定为 [¥${price}] 元/单位。`
      );
    }).catch((err) => {
      LogBroker.publish("ERROR", "App", "批量列价格重组失败:", String(err));
    });
  };

  // ================= 记账管理授权事务 =================

  /**
   * @description 首页系统登录校验
   */
  const handleLoginSubmit = (e: React.FormEvent) => {
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
  const handleVerifyPasswordSubmit = (e: React.FormEvent) => {
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

  // ================= 辅助指标运算 =================

  /**
   * @description 计算当前选择分组备餐全品类在全月的累积费用总支出
   */
  const activeGroupReportTotal = useMemo(() => {
    if (!currentReport) return 0;
    let sum = 0;
    currentReport.items.forEach((item) => {
      Object.keys(item.dailyData).forEach((day) => {
        sum += item.dailyData[day]?.amount || 0;
      });
    });
    return Math.round(sum * 100) / 100;
  }, [currentReport]);

  /**
   * @description 计算后厨所有受众人群全品类在全月的累积费用总支出（宏观总额）
   */
  const allGroupsReportTotal = useMemo(() => {
    let sum = 0;
    reports.forEach((report) => {
      report.items.forEach((item) => {
        Object.keys(item.dailyData).forEach((day) => {
          sum += item.dailyData[day]?.amount || 0;
        });
      });
    });
    return Math.round(sum * 100) / 100;
  }, [reports]);

  /**
   * @description 计算原料购销台账所有原料的累计入库总额 (全账期)
   */
  const allLedgersTotalAmount = useMemo(() => {
    return ledgerItemsList.reduce((sum, item) => {
      let itemSum = 0;
      Object.values(item.dailyRecords || {}).forEach((record: any) => {
        itemSum += record.inAmount || 0;
      });
      return sum + itemSum;
    }, 0);
  }, [ledgerItemsList]);

  // ================= 首页系统安全验证屏 =================
  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 font-sans p-4 relative overflow-hidden">
        {/* 晶莹剔透的环境光背景装饰，增加美学科技质感 */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md bg-slate-950 rounded-2xl shadow-2xl border border-slate-800 p-8 space-y-6 relative z-10 animate-fade-in">
          {/* Logo 与顶条 */}
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Lock className="text-white" size={24} />
            </div>
            <h2 className="text-lg md:text-xl font-black text-white tracking-tight pt-2">
              后厨备菜管理与统计系统
            </h2>
            <p className="text-xs text-slate-400">
              智能高效的日度矩阵记账及膳食营养辅助决策面板
            </p>
          </div>

          {/* 表单 */}
          <form onSubmit={handleLoginSubmit} className="space-y-4 pt-2">
            {loginError && (
              <div className="text-xs bg-rose-950/40 text-rose-400 p-3 rounded-lg border border-rose-900/60 flex items-center space-x-2 animate-pulse">
                <ShieldAlert size={14} className="shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-widest">
                系统登录密码 (存储于 .env 安全配置)
              </label>
              <input
                type="password"
                placeholder="请输入系统首页访问密码"
                value={loginPasswordInput}
                onChange={(e) => setLoginPasswordInput(e.target.value)}
                className="w-full bg-slate-900 text-sm text-slate-100 p-3 border border-slate-800 rounded-lg focus:border-emerald-500 outline-none transition-all focus:bg-slate-900/80 placeholder-slate-500"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-emerald-500 text-white font-bold text-sm rounded-lg cursor-pointer transition-all shadow-lg hover:shadow-emerald-500/10 hover:scale-[1.01] flex items-center justify-center space-x-1.5"
            >
              <span>安全解锁进入</span>
            </button>
          </form>

          {/* 安全提示信息 */}
          <div className="pt-4 border-t border-slate-900 text-center">
            <span className="text-[11px] text-slate-500">
              管理员建议：默认首页登录口令为 <code className="bg-slate-900 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-bold">guest</code>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ================= 管理行政后台隔离屏渲染 =================
  if (isAdminMode) {
    return (
      <AdminBackend
        reports={reports}
        activeGroupsList={activeGroupsList}
        activeCategoriesList={activeCategoriesList}
        onClose={() => setIsAdminMode(false)}
        onResetToSeeds={(data) => setReports(data)}
        onImportBackup={(data) => setReports(data)}
      />
    );
  }

  // ================= 前台报表交互展示屏 =================
  return (
    <div className="flex flex-col h-screen w-full bg-[#f1f5f9] text-slate-800 font-sans select-none overflow-hidden">
      
      {/* 顶部主横幅控制中心 (符合高密度设计风格 Deep Slate Colors) */}
      <header className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 bg-slate-900 text-white border-b border-slate-700 shrink-0 relative z-50">
        <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
          {/* 汉堡包按钮 (在 lg 以下显示) */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden p-1.5 hover:bg-slate-800 rounded text-slate-300 cursor-pointer transition-colors"
            title="展开/收起侧边栏"
          >
            {isSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          
          <div className="w-7 h-7 sm:w-8 sm:h-8 bg-emerald-500 rounded flex items-center justify-center font-extrabold text-base sm:text-lg text-white shrink-0">K</div>
          <h1 className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold tracking-tight truncate">
            后厨备菜管理系统 <span className="hidden md:inline text-slate-400 font-normal text-xs sm:text-sm ml-2">v2.5</span>
          </h1>
        </div>

        <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
          
          {/* 配置管理后台高权入口 */}
          <button
            onClick={handleAdminAccessAttempt}
            className="flex items-center gap-1 px-2 py-1 sm:px-3.5 sm:py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 font-bold text-[10px] sm:text-xs text-white rounded cursor-pointer transition-all shadow-sm hover:shadow"
            title="进入管理后台"
          >
            <Settings size={11} className="animate-spin-slow" />
            <span><span className="hidden sm:inline">进入</span>管理后台</span>
          </button>

          {/* 安全登出系统 */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 bg-slate-800 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-900/60 font-bold text-[10px] sm:text-xs text-slate-300 hover:text-rose-200 rounded cursor-pointer transition-all shadow-sm"
            title="安全退出当前后厨记账系统并锁定首页面"
          >
            <LogOut size={11} />
            <span className="hidden md:inline">安全登出</span>
          </button>

          {/* 自动保存状态展示器 */}
          {saveToast && (
            <span className="text-[9px] sm:text-[10px] bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded border border-emerald-500/40 animate-fade-in font-medium font-sans shrink-0">
              {saveToast}
            </span>
          )}

          <div className="hidden xl:flex items-center space-x-2 text-xs text-slate-400">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse mr-1"></span>
            <span>物理热同步</span>
          </div>
        </div>
      </header>

      {/* 主面板内容区 (遵循高密双分 Aside + Main 左右骨架排布布局) */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* 移动端侧边栏遮罩层 */}
        {isSidebarOpen && (
          <div 
            className="lg:hidden fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-30 transition-opacity duration-300" 
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        
        {/* 左侧侧边栏 Sidebar: 受众人群分组与多维分析决策顶级菜单栏 */}
        <aside className={`
          bg-white border-r border-slate-200 flex flex-col shrink-0 justify-between
          transition-transform duration-300 ease-in-out
          fixed lg:static inset-y-0 left-0 z-40 w-52 h-full lg:h-auto
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}>
          <div className="flex flex-col flex-1 min-h-0 font-sans">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">活动餐位分组</span>
              <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono font-extrabold">{activeGroupsList.length}群目</span>
            </div>
            
            <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto scrollbar-thin flex flex-col">
              <div className="flex-1">
                {activeGroupsList.map((g) => {
                  const isSelected = activeGroup === g.key;
                  return (
                    <button
                      key={g.key}
                      onClick={() => {
                        setActiveGroup(g.key);
                        setIsSidebarOpen(false); // 点击后折叠侧边栏
                        LogBroker.publish("INFO", "App", `切换聚焦后厨受众人群: ${g.label}`);
                      }}
                      className={`w-full flex items-center px-4 py-3 text-xs font-semibold cursor-pointer transition-all ${
                        isSelected
                          ? "bg-emerald-50 border-r-4 border-emerald-500 text-emerald-700 font-bold"
                          : "text-slate-600 hover:bg-slate-50 border-r-4 border-transparent"
                      }`}
                    >
                      <span className="mr-3 text-base">{g.emoji}</span>
                      <span>{g.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 多维分析决策顶级独立入口，隔离至独立菜单项中 */}
              <div className="border-t border-slate-100 pt-2 mt-auto space-y-1">
                <div>
                  <div className="px-4 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    多维统计决策
                  </div>
                  <button
                    onClick={() => {
                      setActiveGroup("ANALYTICS");
                      setIsSidebarOpen(false); // 点击后折叠侧边栏
                      LogBroker.publish("INFO", "App", "激活宏观决策:「每日就餐人数与人均餐费多维度分析」入口页。");
                    }}
                    className={`w-full flex items-center px-4 py-3 text-xs font-bold cursor-pointer transition-all ${
                      activeGroup === "ANALYTICS"
                        ? "bg-sky-50 border-r-4 border-sky-500 text-sky-700 font-black"
                        : "text-slate-600 hover:bg-slate-50 border-r-4 border-transparent"
                    }`}
                  >
                    <span className="mr-3 text-base">📊</span>
                    <span>人数与餐费分析</span>
                  </button>
                </div>

                <div>
                  <div className="px-4 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    仓库与库存台账
                  </div>
                  <button
                    onClick={() => {
                      setActiveGroup("LEDGER");
                      setIsSidebarOpen(false); // 点击后折叠侧边栏
                      LogBroker.publish("INFO", "App", "激活原料购销台账及仓储库存模块。");
                    }}
                    className={`w-full flex items-center px-4 py-3 text-xs font-bold cursor-pointer transition-all ${
                      activeGroup === "LEDGER"
                        ? "bg-emerald-50 border-r-4 border-emerald-500 text-emerald-700 font-black"
                        : "text-slate-600 hover:bg-slate-50 border-r-4 border-transparent"
                    }`}
                  >
                    <span className="mr-3 text-base">📋</span>
                    <span>原料购销台账</span>
                  </button>
                </div>
              </div>
            </nav>
          </div>

          {/* 备餐底栏：实时滚动费用指示牌 */}
          <div className="p-4 border-t border-slate-100">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="text-[10px] text-slate-500 mb-1 font-bold font-sans">
                {activeGroup === "ANALYTICS" 
                  ? "全客群月度采购支出" 
                  : activeGroup === "LEDGER"
                    ? "台账原料累计入库"
                    : "当前受众全月采购支出"}
              </div>
              <div className="text-base font-extrabold text-slate-900 font-mono tracking-tight">
                ¥{(activeGroup === "ANALYTICS" 
                  ? allGroupsReportTotal 
                  : activeGroup === "LEDGER"
                    ? allLedgersTotalAmount
                    : activeGroupReportTotal).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </aside>

        {/* 核心右侧工作记账盘与二级品类选项页签 */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]">
          {activeGroup === "LEDGER" ? (
            <LedgerSystem />
          ) : (
            <>
              <div className="flex items-center px-4 bg-white border-b border-slate-200 justify-between shrink-0 h-12">
                {activeGroup === "ANALYTICS" ? (
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      📊 后厨决策分析中心：每日就餐人数与全客群人均单耗走势看板
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1 overflow-x-auto h-full scrollbar-none">
                    {activeCategoriesList.map((cat) => {
                      const isSelected = activeCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => {
                            setActiveCategory(cat.key);
                            LogBroker.publish("INFO", "App", `切换食材主分类大类: ${cat.label}类`);
                          }}
                          className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer h-full flex items-center whitespace-nowrap ${
                            isSelected
                              ? "border-emerald-500 text-emerald-600 font-extrabold"
                              : "border-transparent text-slate-400 hover:text-slate-600"
                          }`}
                        >
                          {cat.label}品类
                        </button>
                      );
                    })}
                
                    <div className="h-4 w-[1px] bg-slate-200 mx-2 shrink-0" />
                
                    <button
                      onClick={() => {
                        setActiveCategory(null);
                        LogBroker.publish("INFO", "App", "激活宏观视图:「全品类预算/记账金额汇总报表」。");
                      }}
                      className={`px-5 py-2 text-xs font-bold transition-all relative shrink-0 border-b-2 cursor-pointer h-full flex items-center ${
                        activeCategory === null
                          ? "border-emerald-600 text-emerald-700 font-extrabold"
                          : "border-transparent text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      合计汇总表
                    </button>
                  </div>
                )}

                {/* 账期选择器 */}
                {activeGroup !== "LEDGER" && activeGroup !== "ANALYTICS" && (
                  <div className="flex items-center space-x-2 shrink-0 ml-4">
                    <span className="text-xs font-semibold text-slate-500 flex items-center gap-1 animate-fade-in">
                      <CalendarDays size={14} className="text-slate-400" />
                      查看账期:
                    </span>
                    <input
                      type="month"
                      value={`${selectedYear}-${String(selectedMonth).padStart(2, "0")}`}
                      onChange={(e) => {
                        if (e.target.value) {
                          const [y, m] = e.target.value.split("-").map(Number);
                          setSelectedYear(y);
                          setSelectedMonth(m);
                          LogBroker.publish("INFO", "App", `切换账期至: ${y}年${m}月`);
                        }
                      }}
                      className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded px-2.5 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:bg-white focus:border-emerald-500 transition-all"
                    />
                  </div>
                )}
              </div>

          {/* 报表卡片容器（已根据指示，将进程日志等剥离到管理配置后台） */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin">
            
            {activeGroup === "ANALYTICS" ? (
              /* 情形 A: 多维度决策分析，不放在任何受众下面，一屏展示极其纯粹 */
              <HeadcountPanel
                reports={reports}
                activeGroup={activeGroup}
                activeGroupsList={activeGroupsList}
                onHeadcountUpdate={handleHeadcountUpdate}
                isAdminMode={isAdminMode}
              />
            ) : (
              /* 情形 B: 普通受众视图，显示具体品类记账表与 AI 助手 */
              <>
                {/* 1. 顶部流动预算占比与高消耗统计折线趋势看板 */}
                {currentReport && (
                  <StatisticsPanel
                    report={currentReport}
                    selectedCategory={activeCategory as FoodCategory | null}
                  />
                )}

                {/* 2. 核心日金额/录选数字表格单元 */}
                {currentReport && (
                  <TableGrid
                    report={currentReport}
                    selectedCategory={activeCategory as FoodCategory | null}
                    onCellUpdate={handleCellUpdate}
                    onAddItem={handleAddItem as any}
                    onDeleteItem={handleDeleteItem}
                    onBatchPriceUpdate={handleBatchPriceUpdate as any}
                    isAdminMode={isAdminMode}
                    activeGroupsList={activeGroupsList}
                    activeCategoriesList={activeCategoriesList}
                  />
                )}

                {/* 3. AI双脑深度配搭控本专家机器人 */}
                {currentReport && (
                  <AiAssistant
                    activeGroupReport={currentReport}
                  />
                )}
              </>
            )}

          </div>
        </>
      )}
    </main>
      </div>

      {/* 各项备餐审计说明页脚 */}
      <footer className="px-6 py-2 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between shrink-0 text-[10px] text-slate-500 select-none font-sans">
        <div className="flex space-x-6">
          <div className="flex items-center uppercase tracking-widest font-sans">
            <span className="font-bold text-slate-900 mr-2 underline decoration-emerald-500 decoration-2">当前聚焦:</span> 
            {activeGroup === "ANALYTICS" 
              ? "多维餐费与人数分析中心" 
              : `${dynamicGroupLabels[activeGroup]} / ${activeCategory ? dynamicCategoryLabels[activeCategory] : "合计汇总"} / 全月日对数核算`
            }
          </div>
          <div className="flex items-center uppercase tracking-widest font-sans">
            <span className="font-bold text-slate-900 mr-2 underline decoration-emerald-500 decoration-2">操作权限:</span> 
            高密热加载模式（管理员已授权）
          </div>
        </div>
        <div className="flex items-center space-x-1 font-mono text-[9px] text-slate-400">
          <span>HOST: PORT_3000</span>
          <span>|</span>
          <span>SYSTEM_HOT_CONNECTED</span>
        </div>
      </footer>

      {/* 🔐 管理后台行政口令校验遮罩层 */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full mx-4 overflow-hidden">
            {/* 顶条 */}
            <div className="bg-slate-900 text-slate-100 px-5 py-4 flex items-center space-x-2.5">
              <ShieldAlert className="text-emerald-400 shrink-0" size={18} />
              <h3 className="text-sm font-extrabold tracking-tight">行政管理授权认证</h3>
            </div>

            {/* 表单 */}
            <form onSubmit={handleVerifyPasswordSubmit} className="p-5 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                进入配置后台可进行一级餐位客群、二级食材大类的管理，以及执行一键清空、备份和初始化。请输入安全验证密码以继续。
              </p>

              {passwordError && (
                <div className="text-[11px] bg-rose-50 text-rose-600 p-2.5 rounded border border-rose-100 flex items-center space-x-1.5">
                  <ShieldAlert size={12} className="shrink-0 animate-bounce" />
                  <span>{passwordError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">
                  授权管理密码 (默认密码: admin)
                </label>
                <input
                  type="password"
                  placeholder="请输入后台管理员密码"
                  value={enteredPassword}
                  onChange={(e) => setEnteredPassword(e.target.value)}
                  className="w-full bg-slate-50 text-xs text-slate-800 p-2.5 border border-slate-300 rounded focus:border-emerald-500 outline-none transition-all focus:bg-white"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="px-3.5 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 rounded text-xs font-semibold cursor-pointer transition-all"
                >
                  取消返回
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold cursor-pointer transition-all shadow-sm"
                >
                  校验进入
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
