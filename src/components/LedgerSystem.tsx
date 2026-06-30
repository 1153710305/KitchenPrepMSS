/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useMemo } from "react";
import { Ledger, LedgerItem, DailyStockRecord } from "../ledgerTypes.ts";
import { LedgerService } from "../ledgerStore.ts";
import { LEDGER_UI_TEXT, LEDGER_HEADERS } from "../ledgerConstants.ts";
import { LogBroker } from "../utils.ts";
import { SearchableSelect } from "./SearchableSelect.tsx";
import { RawMaterialsDictService } from "../rawMaterialDict.ts";
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Calendar, 
  Download, 
  Printer, 
  Check, 
  AlertCircle,
  FileText,
  Bookmark,
  PlusCircle,
  X,
  LayoutGrid,
  TrendingUp,
  Award,
  Save
} from "lucide-react";

/**
 * @description 原料购销台账及库存仓储系统主面板组件
 */
export function LedgerSystem() {
  // ================= 状态声明部分 =================
  
  /** 系统中所有的台账列表 */
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  /** 所有的采购原料项目列表 */
  const [ledgerItems, setLedgerItems] = useState<LedgerItem[]>([]);
  /** 当前选中的台账唯一标识ID */
  const [activeLedgerId, setActiveLedgerId] = useState<string>("");
  /** 当前选中的台账展现样式，style1总表(日清单)，style2单原料流水(月卡片) */
  const [ledgerStyle, setLedgerStyle] = useState<"style1" | "style2">("style1");
  /** 样式二下当前选中聚焦进行流水查看的原料ID */
  const [activeItemId, setActiveItemId] = useState<string>("");

  /** 当前选择进行数据同步的日期 (格式 YYYY-MM-DD，默认今天) */
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });
  
  /** 界面操作的当前选项卡: "entry" | "invoice" */
  const [activeTab, setActiveTab] = useState<"entry" | "invoice">("entry");
  /** 新建台账弹窗名称输入 */
  const [newLedgerName, setNewLedgerName] = useState<string>("");
  /** 重命名台账的目标ID */
  const [renameLedgerId, setRenameLedgerId] = useState<string | null>(null);
  /** 重命名台账的新名字输入 */
  const [renameLedgerName, setRenameLedgerName] = useState<string>("");
  
  // 批量签字人填报状态
  const [batchOutHandler, setBatchOutHandler] = useState<string>("");
  const [batchOutRecipient, setBatchOutRecipient] = useState<string>("");

  // 新增原料明细相关表单状态
  const [isAddMaterialOpen, setIsAddMaterialOpen] = useState<boolean>(false);
  const [newMaterialName, setNewMaterialName] = useState<string>("");
  const [newMaterialUnit, setNewMaterialUnit] = useState<string>("斤");
  const [newMaterialSpec, setNewMaterialSpec] = useState<string>("");
  const [newMaterialStock, setNewMaterialStock] = useState<number>(0);
  
  // 编辑原料明细相关状态
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editMaterialName, setEditMaterialName] = useState<string>("");
  const [editMaterialUnit, setEditMaterialUnit] = useState<string>("斤");
  const [editMaterialSpec, setEditMaterialSpec] = useState<string>("");
  const [editMaterialStock, setEditMaterialStock] = useState<number>(0);
  
  /** 自动同步成功小气泡的文字 */
  const [saveToast, setSaveToast] = useState<string | null>(null);
  /** 系统交互时的报错提示 */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 仅供打印使用的纯净弹出视图状态: null | "in" | "out" */
  const [printDocType, setPrintDocType] = useState<null | "in" | "out">(null);

  // --- 批量确认录入模式相关状态 ---
  /** 当前选定台账与日期是否正处于“录入中”状态 */
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(false);
  /** 处于录入模式时，存储的当前日采购及出库草稿数据 */
  const [draftRecords, setDraftRecords] = useState<Record<string, DailyStockRecord>>({});

  /** 从全局原料大字典获取的可供选择下拉项 */
  const dictOptions = useMemo(() => {
    return RawMaterialsDictService.getItems().map((item) => ({
      value: item.name,
      label: item.name,
      unit: item.unit,
      category: item.category
    }));
  }, [isAddMaterialOpen, editingMaterialId]);

  // ================= 数据加载及订阅变动 =================

  useEffect(() => {
    LedgerService.initLedgerStore().then((data) => {
      setLedgers(data.ledgers);
      setLedgerItems(data.items);
      if (data.ledgers.length > 0) {
        setActiveLedgerId(data.ledgers[0].id);
      }
    });

    const unsubscribe = LedgerService.subscribe((updatedLedgers, updatedItems) => {
      setLedgers(updatedLedgers);
      setLedgerItems(updatedItems);
      // 使用函数式更新，避免 activeLedgerId 的 stale closure 问题
      setActiveLedgerId((currentId) => {
        if (updatedLedgers.length > 0 && !updatedLedgers.some((l) => l.id === currentId)) {
          return updatedLedgers[0].id;
        }
        return currentId;
      });
    });

    return () => unsubscribe();
  }, []);

  // ================= 计算属性与动态过滤 =================

  /** 当前被选中的台账对象 */
  const activeLedger = useMemo(() => {
    return ledgers.find((l) => l.id === activeLedgerId) || null;
  }, [ledgers, activeLedgerId]);

  /** 过滤出属于当前选中台账的采购原料项目 */
  const currentLedgerItems = useMemo(() => {
    return ledgerItems.filter((item) => item.ledgerId === activeLedgerId);
  }, [ledgerItems, activeLedgerId]);

  // 当切换台账时，自动把样式二的聚焦原料设为该台账的第一个原料项目
  useEffect(() => {
    if (currentLedgerItems.length > 0) {
      setActiveItemId(currentLedgerItems[0].id);
    } else {
      setActiveItemId("");
    }
  }, [activeLedgerId, currentLedgerItems.length]);

  // 当切换台账或修改日期时，退出录入模式并清理内存草稿
  useEffect(() => {
    setIsRecordingMode(false);
    setDraftRecords({});
  }, [activeLedgerId, selectedDate]);

  /** 解析选定日期的年份与月份 */
  const dateParts = useMemo(() => {
    const p = selectedDate.split("-");
    return {
      year: parseInt(p[0] || "2026"),
      month: parseInt(p[1] || "06"),
      day: p[2] || "01"
    };
  }, [selectedDate]);

  /** 根据年月动态计算当月的实际天数列表（如：["01", "02", ..., "30"]） */
  const daysArray = useMemo(() => {
    const arr = [];
    const daysInMonth = new Date(dateParts.year, dateParts.month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push(String(d).padStart(2, "0"));
    }
    return arr;
  }, [dateParts]);

  /** 样式二下单个原料当月每天的历史库存结余计算映射表 */
  const dailyStockBalances = useMemo(() => {
    if (!activeItemId) return {};
    const item = ledgerItems.find((i) => i.id === activeItemId);
    if (!item) return {};
    
    const balances: Record<string, number> = {};
    const currentMonthPrefix = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}`;
    
    // 计算当月之前的历史期初库存（从初始库存出发，加减所有早于本月的出入库记录）
    let monthStartBalance = item.initialStock || 0;
    Object.entries(item.dailyRecords).forEach(([dateKey, record]) => {
      if (dateKey < currentMonthPrefix) {
        monthStartBalance += (record.inQuantity || 0) - (record.outQuantity || 0);
      }
    });
    
    // 从当月期初库存开始，逐日正向累计出入库变动，推算每天结余
    let accum = Math.round(monthStartBalance * 100) / 100;
    daysArray.forEach((dayStr) => {
      const dayDateStr = `${currentMonthPrefix}-${dayStr}`;
      const record = item.dailyRecords[dayDateStr] || { inQuantity: 0, outQuantity: 0 };
      accum = accum + (record.inQuantity || 0) - (record.outQuantity || 0);
      balances[dayDateStr] = Math.round(accum * 100) / 100;
    });
    
    return balances;
  }, [activeItemId, ledgerItems, daysArray, dateParts]);

  /** 当日有入库行为的项目列表 (用于生成入库单) */
  const dailyInwardItems = useMemo(() => {
    return currentLedgerItems
      .map((item) => ({
        ...item,
        record: item.dailyRecords[selectedDate] || { 
          inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "",
          certification: "", sensoryProperty: "", supplier: "", buyer: "", inspector: "", keeper: "", outHandler: "", outRecipient: ""
        }
      }))
      .filter((item) => item.record.inQuantity > 0);
  }, [currentLedgerItems, selectedDate]);

  /** 当日有出库行为的项目列表 (用于生成出库单) */
  const dailyOutwardItems = useMemo(() => {
    return currentLedgerItems
      .map((item) => ({
        ...item,
        record: item.dailyRecords[selectedDate] || { 
          inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "",
          certification: "", sensoryProperty: "", supplier: "", buyer: "", inspector: "", keeper: "", outHandler: "", outRecipient: ""
        }
      }))
      .filter((item) => item.record.outQuantity > 0);
  }, [currentLedgerItems, selectedDate]);

  /** 当日总入库金额 */
  const dailyInTotalAmount = useMemo(() => {
    return dailyInwardItems.reduce((sum, item) => sum + item.record.inAmount, 0);
  }, [dailyInwardItems]);

  // ================= 事务处理方法 =================

  /**
   * @description 触发自动保存提示气泡
   */
  const triggerSaveToast = () => {
    setSaveToast(LEDGER_UI_TEXT.autoSaveSuccess);
    const t = setTimeout(() => setSaveToast(null), 2000);
    return () => clearTimeout(t);
  };

  /**
   * @description 弹出错误信息提示并自动淡出
   */
  const triggerError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  /**
   * @description 新增台账
   */
  const handleAddLedgerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLedgerName.trim()) return;
    LedgerService.addLedger(newLedgerName)
      .then((newLedger) => {
        setActiveLedgerId(newLedger.id);
        setNewLedgerName("");
      })
      .catch((err) => triggerError(err.message));
  };

  /**
   * @description 物理删除台账
   */
  const handleDeleteLedger = (id: string) => {
    if (confirm(LEDGER_UI_TEXT.deleteLedgerConfirm)) {
      LedgerService.deleteLedger(id).catch((err) => triggerError(err.message));
    }
  };

  /**
   * @description 重命名台账
   */
  const handleRenameLedgerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameLedgerId || !renameLedgerName.trim()) return;
    LedgerService.updateLedger(renameLedgerId, renameLedgerName)
      .then(() => {
        setRenameLedgerId(null);
        setRenameLedgerName("");
      })
      .catch((err) => triggerError(err.message));
  };

  /**
   * @description 新增采购原料项目
   */
  const handleAddMaterialSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterialName.trim()) return;
    LedgerService.addLedgerItem(
      activeLedgerId,
      newMaterialName,
      newMaterialUnit,
      newMaterialSpec,
      newMaterialStock
    )
      .then(() => {
        setIsAddMaterialOpen(false);
        setNewMaterialName("");
        setNewMaterialSpec("");
        setNewMaterialStock(0);
      })
      .catch((err) => triggerError(err.message));
  };

  /**
   * @description 保存编辑后的原料配置信息
   */
  const handleSaveEditMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMaterialId || !editMaterialName.trim()) return;
    LedgerService.updateLedgerItem(
      editingMaterialId,
      editMaterialName,
      editMaterialUnit,
      editMaterialSpec,
      editMaterialStock
    )
      .then(() => {
        setEditingMaterialId(null);
      })
      .catch((err) => triggerError(err.message));
  };

  /**
   * @description 物理删除原料采购项目
   */
  const handleDeleteMaterial = (id: string) => {
    if (confirm(LEDGER_UI_TEXT.deleteMaterialConfirm)) {
      LedgerService.deleteLedgerItem(id).catch((err) => triggerError(err.message));
    }
  };

  /**
   * @description 失去焦点时，同步当前单元格的属性改变到本地缓存
   */
  const handleCellBlur = (
    itemId: string,
    dateStr: string,
    fields: Partial<DailyStockRecord>
  ) => {
    LedgerService.updateDailyRecord(itemId, dateStr, fields)
      .then(() => {
        triggerSaveToast();
      })
      .catch((err) => triggerError(err.message));
  };

  /**
   * @description 启动录入模式，优先从本地缓存（LocalStorage）读取未确认的草稿数据
   */
  const handleStartRecording = () => {
    const draftKey = `ledger_draft_${activeLedgerId}_${selectedDate}`;
    const cached = localStorage.getItem(draftKey);
    let initialDraft: Record<string, DailyStockRecord> = {};

    if (cached) {
      try {
        initialDraft = JSON.parse(cached);
        LogBroker.publish("INFO", "LedgerSystem", `成功加载本地未提交的台账录入缓存: ${draftKey}`);
        setSaveToast("已恢复未提交的本地缓存数据");
        setTimeout(() => setSaveToast(null), 2500);
      } catch (err) {
        console.error("加载台账缓存失败:", err);
      }
    } else {
      // 否则从当前已存的 dailyRecords 中读取数据作为初始草稿
      currentLedgerItems.forEach((item) => {
        const record = item.dailyRecords[selectedDate];
        if (record) {
          initialDraft[item.id] = { ...record };
        } else {
          initialDraft[item.id] = {
            inQuantity: 0,
            inPrice: 0,
            inAmount: 0,
            outQuantity: 0,
            note: "",
            certification: "",
            sensoryProperty: "",
            supplier: "",
            buyer: "",
            inspector: "",
            keeper: ""
          };
        }
      });
    }

    setDraftRecords(initialDraft);
    setIsRecordingMode(true);
  };

  /**
   * @description 录入模式下，更新草稿内存与 LocalStorage 缓存
   */
  const handleDraftCellChange = (itemId: string, fields: Partial<DailyStockRecord>) => {
    setDraftRecords((prev) => {
      const current = prev[itemId] || {
        inQuantity: 0,
        inPrice: 0,
        inAmount: 0,
        outQuantity: 0,
        note: "",
        certification: "",
        sensoryProperty: "",
        supplier: "",
        buyer: "",
        inspector: "",
        keeper: ""
      };
      const updatedRecord = { ...current, ...fields };
      // 自动重算入库金额
      if (updatedRecord.inQuantity !== undefined || updatedRecord.inPrice !== undefined) {
        const qty = updatedRecord.inQuantity ?? 0;
        const prc = updatedRecord.inPrice ?? 0;
        updatedRecord.inAmount = Number((qty * prc).toFixed(2));
      }
      
      const newDrafts = { ...prev, [itemId]: updatedRecord };
      // 同步缓存到 localStorage
      const draftKey = `ledger_draft_${activeLedgerId}_${selectedDate}`;
      localStorage.setItem(draftKey, JSON.stringify(newDrafts));
      return newDrafts;
    });
  };

  /**
   * @description 确认提交并同步数据，保存至数据库并清空本地 LocalStorage 缓存
   */
  const handleConfirmRecording = async () => {
    try {
      // 遍历所有项目，调用 LedgerService.updateDailyRecord 批量持久化保存
      const promises = Object.entries(draftRecords).map(([itemId, record]) => {
        return LedgerService.updateDailyRecord(itemId, selectedDate, record);
      });

      await Promise.all(promises);

      // 清除本地缓存
      const draftKey = `ledger_draft_${activeLedgerId}_${selectedDate}`;
      localStorage.removeItem(draftKey);

      setIsRecordingMode(false);
      setDraftRecords({});
      
      setSaveToast("当天采购与台账数据已成功保存并同步！");
      setTimeout(() => setSaveToast(null), 2500);
      LogBroker.publish("INFO", "LedgerSystem", `成功提交保存并同步 ${selectedDate} 的全部台账与入库数据`);
    } catch (err: any) {
      setErrorMessage(err.message || "批量保存台账记录失败");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  /**
   * @description 放弃当前草稿录入（不会清除本地缓存，下次点击录入可找回）
   */
  const handleCancelRecording = () => {
    setIsRecordingMode(false);
    setDraftRecords({});
    LogBroker.publish("INFO", "LedgerSystem", `已暂停 ${selectedDate} 的台账录入，草稿已暂存本地`);
    setSaveToast("录入草稿已暂存本地");
    setTimeout(() => setSaveToast(null), 2000);
  };

  /**
   * @description 一键批量将发料人(出库人)和领料人(接收人)同步应用到今日所有有出入库变动的项目上
   */
  const handleApplyBatchSignatures = () => {
    if (dailyInwardItems.length === 0 && dailyOutwardItems.length === 0) {
      triggerError("今日该台账暂无任何出入库原料变动，无需填写签字。");
      return;
    }

    const promises: Promise<void>[] = [];
    
    // 对有变动的原料项目执行批量浅合并写入
    currentLedgerItems.forEach((item) => {
      const record = item.dailyRecords[selectedDate];
      if (record && (record.inQuantity > 0 || record.outQuantity > 0)) {
        const fieldsToUpdate: Partial<DailyStockRecord> = {};
        if (batchOutHandler.trim()) {
          fieldsToUpdate.outHandler = batchOutHandler.trim();
          fieldsToUpdate.buyer = batchOutHandler.trim(); // 采购员与出库发料人联动
        }
        if (batchOutRecipient.trim()) {
          fieldsToUpdate.outRecipient = batchOutRecipient.trim();
          fieldsToUpdate.inspector = batchOutRecipient.trim(); // 检验员与接收人联动
          fieldsToUpdate.keeper = batchOutRecipient.trim(); // 保管员接收联动
        }
        
        if (Object.keys(fieldsToUpdate).length > 0) {
          promises.push(LedgerService.updateDailyRecord(item.id, selectedDate, fieldsToUpdate));
        }
      }
    });

    Promise.all(promises)
      .then(() => {
        triggerSaveToast();
        setBatchOutHandler("");
        setBatchOutRecipient("");
        LogBroker.publish("INFO", "LedgerSystem", `批量填报今日签字：出库/发料人设定为「${batchOutHandler}」，接收/领料人设定为「${batchOutRecipient}」`);
      })
      .catch((err) => triggerError("批量应用签字时发生异常: " + err.message));
  };

  // ================= 导出与打印核心逻辑 =================

  /**
   * @description 导出当日入库单为 CSV 格式 (添加 UTF-8 BOM 防乱码，完全包含类别、出库人、接收人等属性)
   */
  const handleExportInwardCsv = () => {
    if (!activeLedger) return;
    let csv = "类别(台账),序号,食品原材料品名,规格描述,单位,入库数量,单价(元),入库金额(元),发料出库人(采购员),接收人(检验/保管),食品索证,感官性状,备注\n";
    dailyInwardItems.forEach((item, index) => {
      const record = item.record;
      csv += `${activeLedger.name}台账,${index + 1},${item.name},${item.spec || ""},${item.unit},${record.inQuantity},${record.inPrice},${record.inAmount},${record.outHandler || record.buyer || ""},${record.outRecipient || record.inspector || ""},${record.certification || ""},${record.sensoryProperty || ""},${record.note || ""}\n`;
    });
    csv += `,,,,,合计金额,,${dailyInTotalAmount},,,,,\n`;

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeLedger.name}台账_入库单_${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    LogBroker.publish("INFO", "LedgerSystem", `成功导出「${activeLedger.name}」在 [${selectedDate}] 的当日入库单 CSV。`);
  };

  /**
   * @description 导出当日出库单为 CSV 格式 (添加 UTF-8 BOM 防乱码，包含出库人、接收人等属性)
   */
  const handleExportOutwardCsv = () => {
    if (!activeLedger) return;
    let csv = "类别(台账),序号,食品原材料品名,规格描述,单位,出库数量,发料出库人,接收人(领料),食品索证,感官性状,备注去处\n";
    dailyOutwardItems.forEach((item, index) => {
      const record = item.record;
      csv += `${activeLedger.name}台账,${index + 1},${item.name},${item.spec || ""},${item.unit},${record.outQuantity},${record.outHandler || ""},${record.outRecipient || ""},${record.certification || ""},${record.sensoryProperty || ""},${record.note || ""}\n`;
    });

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeLedger.name}台账_出库单_${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    LogBroker.publish("INFO", "LedgerSystem", `成功导出「${activeLedger.name}」在 [${selectedDate}] 的当日出库单 CSV。`);
  };

  /**
   * @description 唤醒纯净打印覆盖层，并调用浏览器原生打印
   * @param type "in" | "out"
   */
  const triggerPrintDoc = (type: "in" | "out") => {
    setPrintDocType(type);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  // ================= 视图渲染部分 =================

  // 渲染纯净的打印凭证
  if (printDocType) {
    const isPrintIn = printDocType === "in";
    const printItems = isPrintIn ? dailyInwardItems : dailyOutwardItems;
    
    return (
      <div className="fixed inset-0 bg-white z-[9999] overflow-auto p-8 font-sans text-black leading-relaxed">
        {/* 顶部退出预览条 */}
        <div className="mb-6 flex justify-between items-center border-b border-gray-200 pb-4 print:hidden">
          <span className="text-sm text-gray-500 flex items-center gap-1.5">
            <AlertCircle size={16} />
            温馨提示：下方为打印纸质效果预览，请按 Ctrl + P / Cmd + P 确认打印。
          </span>
          <button 
            onClick={() => setPrintDocType(null)}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded cursor-pointer transition-all"
          >
            返回台账主页
          </button>
        </div>

        {/* 凭证大标题 */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-black tracking-widest border-b-2 border-black pb-2 inline-block">
            {activeLedger?.name}台账 —— 原料{isPrintIn ? "入库" : "出库"}单
          </h2>
          <div className="flex justify-between text-xs mt-3 px-1">
            <span>日期：<strong className="underline">{selectedDate}</strong></span>
            <span>台账类别：<strong className="underline">{activeLedger?.name}</strong></span>
            <span>单据编号：<strong className="underline font-mono">NO.{selectedDate.replace(/-/g, "")}{isPrintIn ? "01" : "02"}</strong></span>
          </div>
        </div>

        {/* 凭证明细表格 */}
        <table className="w-full text-left border-collapse border border-black text-xs mb-8">
          <thead>
            <tr className="bg-gray-100 text-center">
              <th className="border border-black px-2 py-2.5 w-12 font-bold">序号</th>
              <th className="border border-black px-3 py-2.5 font-bold">食品原材料品名</th>
              <th className="border border-black px-3 py-2.5 font-bold">规格描述</th>
              <th className="border border-black px-2 py-2.5 w-16 font-bold">单位</th>
              <th className="border border-black px-3 py-2.5 w-24 font-bold">{isPrintIn ? "今日入库数" : "今日出库数"}</th>
              {isPrintIn && (
                <>
                  <th className="border border-black px-3 py-2.5 w-24 font-bold">单价(元)</th>
                  <th className="border border-black px-3 py-2.5 w-28 font-bold">金额(元)</th>
                </>
              )}
              <th className="border border-black px-3 py-2.5 w-24 font-bold">发料出库人</th>
              <th className="border border-black px-3 py-2.5 w-24 font-bold">接收领料人</th>
              <th className="border border-black px-3 py-2.5 w-20 font-bold">食品索证</th>
              <th className="border border-black px-3 py-2.5 w-20 font-bold">感官性状</th>
              <th className="border border-black px-3 py-2.5 font-bold">备注说明/去处</th>
            </tr>
          </thead>
          <tbody>
            {printItems.length === 0 ? (
              <tr>
                <td colSpan={isPrintIn ? 11 : 9} className="border border-black text-center py-6 text-gray-500 italic">
                  今日无{isPrintIn ? "入库" : "出库"}数据记录
                </td>
              </tr>
            ) : (
              printItems.map((item, index) => (
                <tr key={item.id} className="hover:bg-gray-50 text-center">
                  <td className="border border-black px-2 py-2 font-mono">{index + 1}</td>
                  <td className="border border-black px-3 py-2 text-left font-bold">{item.name}</td>
                  <td className="border border-black px-3 py-2 text-left">{item.spec || "-"}</td>
                  <td className="border border-black px-2 py-2">{item.unit}</td>
                  <td className="border border-black px-3 py-2 text-right font-mono font-bold">
                    {isPrintIn ? item.record.inQuantity : item.record.outQuantity}
                  </td>
                  {isPrintIn && (
                    <>
                      <td className="border border-black px-3 py-2 text-right font-mono">¥{item.record.inPrice.toFixed(2)}</td>
                      <td className="border border-black px-3 py-2 text-right font-mono font-bold">¥{item.record.inAmount.toFixed(2)}</td>
                    </>
                  )}
                  <td className="border border-black px-3 py-2">{item.record.outHandler || item.record.buyer || "-"}</td>
                  <td className="border border-black px-3 py-2">{item.record.outRecipient || item.record.inspector || "-"}</td>
                  <td className="border border-black px-3 py-2">{item.record.certification || "-"}</td>
                  <td className="border border-black px-3 py-2">{item.record.sensoryProperty || "-"}</td>
                  <td className="border border-black px-3 py-2 text-left">{item.record.note || "-"}</td>
                </tr>
              ))
            )}
            
            {/* 入库单合计行 */}
            {isPrintIn && printItems.length > 0 && (
              <tr className="bg-gray-50">
                <td colSpan={5} className="border border-black px-3 py-2.5 font-bold text-center">合计金额 (大写)：{new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(dailyInTotalAmount)}</td>
                <td colSpan={1} className="border border-black px-3 py-2.5 font-bold text-right">小写合计:</td>
                <td className="border border-black px-3 py-2.5 text-right font-mono font-black text-sm text-red-600">
                  ¥{dailyInTotalAmount.toFixed(2)}
                </td>
                <td colSpan={4} className="border border-black px-3 py-2"></td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 凭证签章栏 */}
        <div className="grid grid-cols-3 gap-4 text-xs mt-12 px-2">
          <div>
            <span>主管审核签字：____________________</span>
          </div>
          <div className="text-center">
            <span>出库发料人签字：____________________</span>
          </div>
          <div className="text-right">
            <span>接收领料人签字：____________________</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-[#f1f5f9] text-slate-800 font-sans overflow-hidden">
      
      {/* 左侧台账选择名录区 */}
      <div className="w-full lg:w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
            {LEDGER_UI_TEXT.listTitle}
          </span>
          <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-bold">
            {ledgers.length}个台账
          </span>
        </div>

        {/* 台账名录列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {ledgers.map((ledger) => {
            const isSelected = activeLedgerId === ledger.id;
            const isEditing = renameLedgerId === ledger.id;

            return (
              <div 
                key={ledger.id}
                className={`group flex items-center justify-between p-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  isSelected 
                    ? "bg-emerald-50 text-emerald-700 font-bold border-l-4 border-emerald-500" 
                    : "text-slate-600 hover:bg-slate-50 border-l-4 border-transparent"
                }`}
                onClick={() => {
                  if (!isEditing) {
                    setActiveLedgerId(ledger.id);
                    LogBroker.publish("INFO", "LedgerSystem", `切换至原料购销台账: ${ledger.name}`);
                  }
                }}
              >
                {isEditing ? (
                  <form 
                    onSubmit={handleRenameLedgerSubmit}
                    className="flex items-center gap-1.5 w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input 
                      type="text"
                      value={renameLedgerName}
                      onChange={(e) => setRenameLedgerName(e.target.value)}
                      className="flex-1 bg-white border border-emerald-400 px-1.5 py-0.5 rounded text-[11px] outline-none"
                      autoFocus
                      required
                    />
                    <button type="submit" className="p-1 text-emerald-600 hover:text-emerald-700">
                      <Check size={12} />
                    </button>
                    <button type="button" onClick={() => setRenameLedgerId(null)} className="p-1 text-slate-400">
                      <X size={12} />
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="truncate flex items-center gap-1.5">
                      <Bookmark size={12} className={isSelected ? "text-emerald-600" : "text-slate-400"} />
                      {ledger.name}台账
                    </span>
                    <div className="hidden group-hover:flex items-center gap-1">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameLedgerId(ledger.id);
                          setRenameLedgerName(ledger.name);
                        }}
                        className="p-1 text-slate-400 hover:text-emerald-600"
                        title="重命名台账"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteLedger(ledger.id);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        title="物理删除台账"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* 新增台账表单 */}
        <form onSubmit={handleAddLedgerSubmit} className="p-3 border-t border-slate-100 bg-slate-50 flex gap-1.5">
          <input 
            type="text"
            placeholder={LEDGER_UI_TEXT.newLedgerPlaceholder}
            value={newLedgerName}
            onChange={(e) => setNewLedgerName(e.target.value)}
            className="flex-1 bg-white text-[11px] p-2 border border-slate-200 rounded outline-none focus:border-emerald-500"
            required
          />
          <button 
            type="submit" 
            className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer transition-colors"
            title="增加新台账"
          >
            <Plus size={14} />
          </button>
        </form>
      </div>

      {/* 右侧明细录入区 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#f8fafc]">
        
        {/* 页眉日期及样式选择栏 */}
        <div className="p-4 bg-white border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FileText className="text-emerald-600" size={16} />
                「{activeLedger?.name || "未选择"}」购销与库存台账
              </h2>
              {saveToast && (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200 animate-pulse">
                  {saveToast}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">{LEDGER_UI_TEXT.moduleSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* 呈现样式选择 */}
            {activeTab === "entry" && (
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                <button
                  onClick={() => setLedgerStyle("style1")}
                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-md cursor-pointer transition-all ${
                    ledgerStyle === "style1" 
                      ? "bg-white text-emerald-700 shadow-xs" 
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <LayoutGrid size={11} />
                  <span>总表模式 (图一)</span>
                </button>
                <button
                  onClick={() => setLedgerStyle("style2")}
                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-md cursor-pointer transition-all ${
                    ledgerStyle === "style2" 
                      ? "bg-white text-emerald-700 shadow-xs" 
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <TrendingUp size={11} />
                  <span>单原料日流水 (图二)</span>
                </button>
              </div>
            )}

            {/* 日期选择器 */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 w-fit">
              <Calendar size={13} className="text-slate-500" />
              <span className="text-[11px] text-slate-500 font-medium">同步日期：</span>
              <input 
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  LogBroker.publish("INFO", "LedgerSystem", `切换台账数据录入日期为: ${e.target.value}`);
                }}
                className="bg-transparent text-[11px] font-bold text-slate-700 outline-none cursor-pointer text-xs"
              />
            </div>
          </div>
        </div>

        {/* 错误警示 */}
        {errorMessage && (
          <div className="mx-4 mt-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs px-4 py-2.5 rounded-lg flex items-center gap-2 animate-bounce">
            <AlertCircle size={14} className="shrink-0" />
            <span>警告: {errorMessage}</span>
          </div>
        )}

        {/* 核心操作控制导航条 */}
        <div className="px-4 py-2.5 bg-white border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab("entry")}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                activeTab === "entry" 
                  ? "bg-slate-900 text-white shadow-sm" 
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              台账数据录入
            </button>
            <button
              onClick={() => setActiveTab("invoice")}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                activeTab === "invoice" 
                  ? "bg-slate-900 text-white shadow-sm" 
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              当日出入库单 (单据归集)
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {activeTab === "entry" ? (
              <>
                {/* 录入模式控制键 */}
                {!isRecordingMode ? (
                  <button
                    onClick={handleStartRecording}
                    className="flex items-center gap-1 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                  >
                    <Edit3 size={13} />
                    <span>开始录入今日采购数据</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleConfirmRecording}
                      className="flex items-center gap-1 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm animate-pulse"
                    >
                      <Check size={13} />
                      <span>保存并同步今日采购</span>
                    </button>
                    <button
                      onClick={handleCancelRecording}
                      className="flex items-center gap-1 px-3.5 py-1.5 bg-slate-500 hover:bg-slate-600 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                    >
                      <Save size={13} />
                      <span>暂存本地并退出</span>
                    </button>
                  </>
                )}

                {/* 样式二的原料选择下拉框 */}
                {ledgerStyle === "style2" && currentLedgerItems.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-bold text-slate-500">采购项目:</span>
                    <select
                      value={activeItemId}
                      onChange={(e) => setActiveItemId(e.target.value)}
                      className="bg-white border border-slate-200 px-2 py-1.5 rounded outline-none focus:border-emerald-500 text-xs"
                    >
                      {currentLedgerItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                
                <button
                  onClick={() => setIsAddMaterialOpen(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-sm"
                >
                  <PlusCircle size={13} />
                  <span>{LEDGER_UI_TEXT.addMaterialBtn}</span>
                </button>
              </>
            ) : (
              <>
                {/* 批量签字填充控制栏 */}
                <div className="flex items-center gap-1.5 border border-dashed border-emerald-300 rounded-lg p-1 bg-emerald-50/50">
                  <input
                    type="text"
                    placeholder="批量填出库人"
                    value={batchOutHandler}
                    onChange={(e) => setBatchOutHandler(e.target.value)}
                    className="bg-white text-[10px] px-2 py-1.5 rounded w-24 border border-slate-200 outline-none"
                  />
                  <input
                    type="text"
                    placeholder="批量填接收人"
                    value={batchOutRecipient}
                    onChange={(e) => setBatchOutRecipient(e.target.value)}
                    className="bg-white text-[10px] px-2 py-1.5 rounded w-24 border border-slate-200 outline-none"
                  />
                  <button
                    onClick={handleApplyBatchSignatures}
                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded cursor-pointer"
                    title="一键将输入的出库人与接收人填充到今日所有发生出入库项目的签字栏上"
                  >
                    一键应用
                  </button>
                </div>
                
                <div className="h-4 w-px bg-slate-200 mx-1"></div>

                <button
                  onClick={handleExportInwardCsv}
                  disabled={dailyInwardItems.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
                >
                  <Download size={12} />
                  <span>导出入库单</span>
                </button>
                <button
                  onClick={() => triggerPrintDoc("in")}
                  disabled={dailyInwardItems.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
                >
                  <Printer size={12} />
                  <span>打印入库单</span>
                </button>
                <div className="h-4 w-px bg-slate-200 mx-1"></div>
                <button
                  onClick={handleExportOutwardCsv}
                  disabled={dailyOutwardItems.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
                >
                  <Download size={12} />
                  <span>导出出库单</span>
                </button>
                <button
                  onClick={() => triggerPrintDoc("out")}
                  disabled={dailyOutwardItems.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
                >
                  <Printer size={12} />
                  <span>打印出库单</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 主体工作区 */}
        <div className="flex-1 overflow-auto p-4 scrollbar-thin">
          
          {/* Tab 1: 台账数据录入 */}
          {activeTab === "entry" && (
            <>
              {/* 样式一：食品原材料购销总表 (图一样式) */}
              {ledgerStyle === "style1" && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500">【图一样式】原料购销日总表明细</span>
                    <span className="text-[9px] text-slate-400 font-medium">修改任意格后失去焦点自动同步物理库存</span>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[1200px]">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 font-bold uppercase">
                          <th className="px-4 py-3 text-slate-600 font-bold w-40">{LEDGER_HEADERS.materialName}</th>
                          <th className="px-3 py-3 text-center text-slate-600 font-bold w-20">单位</th>
                          <th className="px-3 py-3 text-emerald-800 font-bold bg-emerald-50/30 w-28">{LEDGER_HEADERS.inQuantity}</th>
                          <th className="px-3 py-3 text-emerald-800 font-bold bg-emerald-50/30 w-24">单价(元)</th>
                          <th className="px-3 py-3 text-indigo-800 font-bold bg-indigo-50/30 w-28">{LEDGER_HEADERS.outQuantity}</th>
                          <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.certification}</th>
                          <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.sensoryProperty}</th>
                          <th className="px-3 py-3 text-slate-600 font-bold w-48">{LEDGER_HEADERS.supplier}</th>
                          <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.buyer}</th>
                          <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.inspector}</th>
                          <th className="px-3 py-3 text-slate-600 font-bold w-28">{LEDGER_HEADERS.keeper}</th>
                          <th className="px-3 py-3 text-center text-slate-600 font-bold w-16">管理</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {currentLedgerItems.length === 0 ? (
                          <tr>
                            <td colSpan={12} className="text-center py-12 text-slate-400 italic">
                              该台账暂无采购原料。请点击右上方“新增原料采购项”进行录入填充。
                            </td>
                          </tr>
                        ) : (
                          currentLedgerItems.map((item) => {
                            const isItemEditing = editingMaterialId === item.id;
                            const record: DailyStockRecord = item.dailyRecords[selectedDate] || {
                              inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "",
                              certification: "", sensoryProperty: "", supplier: "", buyer: "", inspector: "", keeper: ""
                            };

                            if (isItemEditing) {
                              return (
                                <tr key={item.id} className="bg-emerald-50/20">
                                  <td colSpan={12} className="px-4 py-3">
                                    <form onSubmit={handleSaveEditMaterial} className="flex flex-wrap items-center gap-3">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-slate-400">原料品名:</span>
                                        <SearchableSelect
                                          options={dictOptions}
                                          value={editMaterialName}
                                          onChange={(val, opt) => {
                                            setEditMaterialName(val);
                                            if (opt && opt.unit) {
                                              setEditMaterialUnit(opt.unit);
                                            }
                                          }}
                                          placeholder="选择原料"
                                          className="w-28"
                                        />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-slate-400">规格:</span>
                                        <input 
                                          type="text" value={editMaterialSpec} onChange={(e) => setEditMaterialSpec(e.target.value)}
                                          className="bg-white border border-slate-300 px-2 py-1 rounded text-xs w-28 outline-none"
                                        />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-slate-400">单位:</span>
                                        <input 
                                          type="text" value={editMaterialUnit} onChange={(e) => setEditMaterialUnit(e.target.value)}
                                          className="bg-white border border-slate-300 px-2 py-1 rounded text-xs w-16 text-center outline-none" required
                                        />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-slate-400">初始库存:</span>
                                        <input 
                                          type="number" step="any" value={editMaterialStock} onChange={(e) => setEditMaterialStock(Number(e.target.value))}
                                          className="bg-white border border-slate-300 px-2 py-1 rounded text-xs w-20 text-right outline-none" required
                                        />
                                      </div>
                                      <button type="submit" className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold cursor-pointer">
                                        保存原料参数
                                      </button>
                                      <button type="button" onClick={() => setEditingMaterialId(null)} className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs cursor-pointer">
                                        取消
                                      </button>
                                    </form>
                                  </td>
                                </tr>
                              );
                            }

                            const draftRecord = draftRecords[item.id];
                            const recordToRender = isRecordingMode ? (draftRecord || {
                              inQuantity: 0, inPrice: 0, inAmount: 0, outQuantity: 0, note: "",
                              certification: "", sensoryProperty: "", supplier: "", buyer: "", inspector: "", keeper: ""
                            }) : record;

                            return (
                              <tr key={item.id} className="hover:bg-slate-50/50">
                                <td className="px-4 py-2.5 font-bold text-slate-800">
                                  {item.name}
                                  <div className="text-[9px] text-slate-400 font-normal mt-0.5">{item.spec || "-"}</div>
                                </td>
                                <td className="px-3 py-2.5 text-center text-slate-500">{item.unit}</td>
                                
                                {/* 采购数量 */}
                                <td className="px-3 py-2 bg-emerald-50/10">
                                  <input 
                                    type="number" step="any"
                                    value={recordToRender.inQuantity || ""}
                                    placeholder={isRecordingMode ? "0" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { inQuantity: Number(e.target.value) })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                                  />
                                </td>
                                
                                {/* 单价 */}
                                <td className="px-3 py-2 bg-emerald-50/10">
                                  <input 
                                    type="number" step="any"
                                    value={recordToRender.inPrice || ""}
                                    placeholder={isRecordingMode ? "¥0.00" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { inPrice: Number(e.target.value) })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                                  />
                                </td>

                                {/* 出库数量 */}
                                <td className="px-3 py-2 bg-indigo-50/10">
                                  <input 
                                    type="number" step="any"
                                    value={recordToRender.outQuantity || ""}
                                    placeholder={isRecordingMode ? "0" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { outQuantity: Number(e.target.value) })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                                  />
                                </td>

                                {/* 食品索证 */}
                                <td className="px-3 py-2">
                                  <input 
                                    type="text"
                                    value={recordToRender.certification || ""}
                                    placeholder={isRecordingMode ? "已索证" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { certification: e.target.value })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                </td>
 
                                {/* 感官性状 */}
                                <td className="px-3 py-2">
                                  <input 
                                    type="text"
                                    value={recordToRender.sensoryProperty || ""}
                                    placeholder={isRecordingMode ? "合格/合格率" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { sensoryProperty: e.target.value })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                </td>
 
                                {/* 供货商及地址 */}
                                <td className="px-3 py-2">
                                  <input 
                                    type="text"
                                    value={recordToRender.supplier || ""}
                                    placeholder={isRecordingMode ? "经销商地址及名称" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { supplier: e.target.value })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                </td>
 
                                {/* 采购员 */}
                                <td className="px-3 py-2">
                                  <input 
                                    type="text"
                                    value={recordToRender.buyer || ""}
                                    placeholder={isRecordingMode ? "采购经办" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { buyer: e.target.value })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                </td>
 
                                {/* 检验员 */}
                                <td className="px-3 py-2">
                                  <input 
                                    type="text"
                                    value={recordToRender.inspector || ""}
                                    placeholder={isRecordingMode ? "检验验收" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { inspector: e.target.value })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                </td>
 
                                {/* 保管员 */}
                                <td className="px-3 py-2">
                                  <input 
                                    type="text"
                                    value={recordToRender.keeper || ""}
                                    placeholder={isRecordingMode ? "库管签字" : "未开启录入"}
                                    disabled={!isRecordingMode}
                                    onChange={(e) => handleDraftCellChange(item.id, { keeper: e.target.value })}
                                    className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                </td>

                                {/* 行编辑 */}
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => {
                                        setEditingMaterialId(item.id);
                                        setEditMaterialName(item.name);
                                        setEditMaterialUnit(item.unit);
                                        setEditMaterialSpec(item.spec || "");
                                        setEditMaterialStock(item.initialStock);
                                      }}
                                      className="p-1 text-slate-400 hover:text-emerald-600 rounded transition-colors"
                                    >
                                      <Edit3 size={11} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteMaterial(item.id)}
                                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 样式二：单原料日出入库流水账 (图二样式) */}
              {ledgerStyle === "style2" && (
                <div className="space-y-4">
                  {activeItemId ? (
                    (() => {
                      const activeItem = ledgerItems.find((i) => i.id === activeItemId);
                      if (!activeItem) return null;
                      
                      // 提取当月有记录的供应商与索证，做成表头绑定（默认提示词从常量文件统一管理）
                      const currentMonthStr = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}`;
                      const sampleRecord = Object.entries(activeItem.dailyRecords).find(
                        ([d, rec]) => d.startsWith(currentMonthStr) && (rec.supplier || rec.certification)
                      )?.[1] || { supplier: "", certification: "" };

                      const draftRecord = draftRecords[activeItem.id];
                      const recordForSelectedDate = activeItem.dailyRecords[selectedDate] || { supplier: "", certification: "" };
                      const currentSupplier = isRecordingMode ? (draftRecord?.supplier ?? "") : (recordForSelectedDate.supplier ?? sampleRecord.supplier ?? "");
                      const currentCertification = isRecordingMode ? (draftRecord?.certification ?? "") : (recordForSelectedDate.certification ?? sampleRecord.certification ?? "");

                      return (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
                          
                          {/* 样式二表头与经销商信息 */}
                          <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <span className="text-[11px] font-bold text-slate-400 block uppercase">采购项目</span>
                              <div className="text-sm font-black text-slate-800 mt-1 flex items-center gap-1.5">
                                <Award size={15} className="text-emerald-600" />
                                {activeItem.name} ({activeItem.unit})
                              </div>
                            </div>
                            
                            <div>
                              <span className="text-[11px] font-bold text-slate-400 block uppercase">经销商/供货商</span>
                              <input 
                                type="text"
                                value={currentSupplier}
                                placeholder={isRecordingMode ? LEDGER_UI_TEXT.defaultSupplierPlaceholder : "未开启录入"}
                                disabled={!isRecordingMode}
                                onChange={(e) => {
                                  handleDraftCellChange(activeItem.id, { supplier: e.target.value });
                                }}
                                className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2.5 py-1 mt-1 rounded text-xs outline-none focus:border-emerald-500"
                              />
                            </div>

                            <div>
                              <span className="text-[11px] font-bold text-slate-400 block uppercase">索证索票情况</span>
                              <input 
                                type="text"
                                value={currentCertification}
                                placeholder={isRecordingMode ? LEDGER_UI_TEXT.defaultCertificationPlaceholder : "未开启录入"}
                                disabled={!isRecordingMode}
                                onChange={(e) => {
                                  handleDraftCellChange(activeItem.id, { certification: e.target.value });
                                }}
                                className="w-full bg-white disabled:bg-slate-50 disabled:text-slate-400 border border-slate-200 px-2.5 py-1 mt-1 rounded text-xs outline-none focus:border-emerald-500"
                              />
                            </div>
                          </div>

                          {/* 月度流水网格 */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs min-w-[1000px]">
                              <thead>
                                <tr className="bg-slate-100/50 text-slate-500 border-b border-slate-200 text-center font-bold">
                                  <th className="px-4 py-2.5 font-bold w-28">日期</th>
                                  <th className="px-3 py-2.5 font-bold bg-emerald-50/20 w-24">采购数量</th>
                                  <th className="px-3 py-2.5 font-bold w-24">采购员</th>
                                  <th className="px-3 py-2.5 font-bold w-28">生产日期</th>
                                  <th className="px-3 py-2.5 font-bold w-24">保质期</th>
                                  <th className="px-3 py-2.5 font-bold w-24">感官性状</th>
                                  <th className="px-3 py-2.5 font-bold w-24">检验员</th>
                                  <th className="px-3 py-2.5 font-bold bg-indigo-50/10 w-24">出库数量</th>
                                  <th className="px-3 py-2.5 font-bold bg-slate-100/80 w-28">当日库存</th>
                                  <th className="px-3 py-2.5 font-bold w-24">保管员</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-center">
                                 {daysArray.map((dayStr) => {
                                  const dayDateStr = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${dayStr}`;
                                  const record = activeItem.dailyRecords[dayDateStr] || {
                                    inQuantity: 0, outQuantity: 0, buyer: "", inspector: "", keeper: "",
                                    produceDate: "", shelfLife: "", sensoryProperty: ""
                                  };
                                  const balance = dailyStockBalances[dayDateStr] ?? activeItem.initialStock;

                                  const isRowEditable = isRecordingMode && dayDateStr === selectedDate;
                                  const draftRecord = draftRecords[activeItem.id];
                                  const recordToRender = isRowEditable ? (draftRecord || {
                                    inQuantity: 0, outQuantity: 0, buyer: "", inspector: "", keeper: "",
                                    produceDate: "", shelfLife: "", sensoryProperty: ""
                                  }) : record;

                                  return (
                                    <tr key={dayDateStr} className={`hover:bg-slate-50/50 ${dayDateStr === selectedDate ? "bg-amber-50/20" : ""}`}>
                                      <td className="px-4 py-2 font-mono text-slate-500 font-bold flex items-center justify-center gap-1">
                                        <span>{dayDateStr}</span>
                                        {dayDateStr === selectedDate && (
                                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" title="当前选中同步日"></span>
                                        )}
                                      </td>
                                      
                                      {/* 采购数量 */}
                                      <td className="px-2 py-1.5 bg-emerald-50/10">
                                        <input 
                                          type="number" step="any"
                                          value={recordToRender.inQuantity || ""}
                                          placeholder={isRowEditable ? "0" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { inQuantity: Number(e.target.value) })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                                        />
                                      </td>
                                      
                                      {/* 采购员 */}
                                      <td className="px-2 py-1.5">
                                        <input 
                                          type="text"
                                          value={recordToRender.buyer || ""}
                                          placeholder={isRowEditable ? "填采购员" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { buyer: e.target.value })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                        />
                                      </td>

                                      {/* 生产日期 */}
                                      <td className="px-2 py-1.5">
                                        <input 
                                          type="text"
                                          value={recordToRender.produceDate || ""}
                                          placeholder={isRowEditable ? "生产日期" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { produceDate: e.target.value })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none font-mono"
                                        />
                                      </td>

                                      {/* 保质期 */}
                                      <td className="px-2 py-1.5">
                                        <input 
                                          type="text"
                                          value={recordToRender.shelfLife || ""}
                                          placeholder={isRowEditable ? "如: 12个月" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { shelfLife: e.target.value })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                        />
                                      </td>

                                      {/* 感官性状 */}
                                      <td className="px-2 py-1.5">
                                        <input 
                                          type="text"
                                          value={recordToRender.sensoryProperty || ""}
                                          placeholder={isRowEditable ? "合格" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { sensoryProperty: e.target.value })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                        />
                                      </td>

                                      {/* 检验员 */}
                                      <td className="px-2 py-1.5">
                                        <input 
                                          type="text"
                                          value={recordToRender.inspector || ""}
                                          placeholder={isRowEditable ? "填检验员" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { inspector: e.target.value })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                        />
                                      </td>

                                      {/* 出库数量 */}
                                      <td className="px-2 py-1.5 bg-indigo-50/5">
                                        <input 
                                          type="number" step="any"
                                          value={recordToRender.outQuantity || ""}
                                          placeholder={isRowEditable ? "0" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { outQuantity: Number(e.target.value) })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded text-right font-mono outline-none"
                                        />
                                      </td>

                                      {/* 当日库存/结余 (公式累算) */}
                                      <td className="px-3 py-1.5 bg-slate-100/50 font-mono font-black text-slate-800 text-right">
                                        {balance}
                                      </td>

                                      {/* 保管员 */}
                                      <td className="px-2 py-1.5">
                                        <input 
                                          type="text"
                                          value={recordToRender.keeper || ""}
                                          placeholder={isRowEditable ? "保管签字" : "锁定"}
                                          disabled={!isRowEditable}
                                          onChange={(e) => handleDraftCellChange(activeItem.id, { keeper: e.target.value })}
                                          className="w-full bg-white disabled:bg-slate-50/30 disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none"
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                        </div>
                      );
                    })()
                  ) : (
                    <div className="text-center py-12 bg-white border border-slate-200 rounded-xl text-slate-400 italic">
                      该台账暂无采购原料项目。请点击右上方“新增原料采购项”添加原料以开启流水台账。
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Tab 2: 当日出入库单 (明细归集) */}
          {activeTab === "invoice" && (
            <div className="space-y-6">
              
              {/* 今日入库单 */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="border-b border-slate-100 pb-3 mb-4 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    当日入库明细单 (有入库行为)
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500 font-bold">
                    入库金额合计：<span className="text-xs text-red-600 font-black">¥{dailyInTotalAmount.toFixed(2)}</span>
                  </span>
                </div>

                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-center">
                      <th className="px-3 py-2 w-12 font-bold">序号</th>
                      <th className="px-3 py-2 text-left font-bold">原料名称</th>
                      <th className="px-3 py-2 text-left font-bold">规格描述</th>
                      <th className="px-2 py-2 w-16 font-bold">单位</th>
                      <th className="px-3 py-2 w-24 font-bold">今日入库数</th>
                      <th className="px-3 py-2 w-24 font-bold">入库单价</th>
                      <th className="px-3 py-2 w-28 font-bold">入库总金额</th>
                      <th className="px-3 py-2 w-24 font-bold">出库发料人</th>
                      <th className="px-3 py-2 w-24 font-bold">接收领料人</th>
                      <th className="px-3 py-2 w-20 font-bold">食品索证</th>
                      <th className="px-3 py-2 w-20 font-bold">感官性状</th>
                      <th className="px-3 py-2 text-left">备注说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-center">
                    {dailyInwardItems.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="text-center py-6 text-slate-400 italic">
                          今日该台账暂无任何原料入库记录数据。
                        </td>
                      </tr>
                    ) : (
                      dailyInwardItems.map((item, index) => (
                        <tr key={item.id} className="hover:bg-slate-50/30">
                          <td className="px-3 py-2 font-mono text-slate-400">{index + 1}</td>
                          <td className="px-3 py-2 font-bold text-slate-800 text-left">{item.name}</td>
                          <td className="px-3 py-2 text-slate-500 text-left">{item.spec || "-"}</td>
                          <td className="px-2 py-2 text-slate-500">{item.unit}</td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-800">{item.record.inQuantity}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">¥{item.record.inPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-emerald-800">¥{item.record.inAmount.toFixed(2)}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.outHandler || item.record.buyer || "-"}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.outRecipient || item.record.inspector || "-"}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.certification || "-"}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.sensoryProperty || "-"}</td>
                          <td className="px-3 py-2 text-slate-500 text-left">{item.record.note || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 今日出库单 */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="border-b border-slate-100 pb-3 mb-4">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                    当日出库明细单 (有领用出库行为)
                  </h3>
                </div>

                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold text-center">
                      <th className="px-3 py-2 w-12 font-bold">序号</th>
                      <th className="px-3 py-2 text-left font-bold">原料名称</th>
                      <th className="px-3 py-2 text-left font-bold">规格描述</th>
                      <th className="px-2 py-2 w-16 font-bold">单位</th>
                      <th className="px-3 py-2 w-24 font-bold">今日出库数</th>
                      <th className="px-3 py-2 w-28 font-bold">发料出库人</th>
                      <th className="px-3 py-2 w-28 font-bold">领用接收人</th>
                      <th className="px-3 py-2 w-20 font-bold">食品索证</th>
                      <th className="px-3 py-2 w-20 font-bold">感官性状</th>
                      <th className="px-3 py-2 text-left">领用去处/备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-center">
                    {dailyOutwardItems.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-6 text-slate-400 italic">
                          今日该台账暂无任何原料领用出库记录。
                        </td>
                      </tr>
                    ) : (
                      dailyOutwardItems.map((item, index) => (
                        <tr key={item.id} className="hover:bg-slate-50/30">
                          <td className="px-3 py-2 font-mono text-slate-400">{index + 1}</td>
                          <td className="px-3 py-2 font-bold text-slate-800 text-left">{item.name}</td>
                          <td className="px-3 py-2 text-slate-500 text-left">{item.spec || "-"}</td>
                          <td className="px-2 py-2 text-slate-500">{item.unit}</td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-800">{item.record.outQuantity}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.outHandler || ""}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.outRecipient || ""}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.certification || "-"}</td>
                          <td className="px-3 py-2 text-slate-600">{item.record.sensoryProperty || "-"}</td>
                          <td className="px-3 py-2 text-slate-500 text-left">{item.record.note || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}

        </div>

      </div>

      {/* 新增原料明细模态弹框 */}
      {isAddMaterialOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[999]">
          <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-sm w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">
                新增「{activeLedger?.name}」台账原料采购项
              </h3>
              <button onClick={() => setIsAddMaterialOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddMaterialSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 block uppercase">原料名称 (必填)</label>
                <SearchableSelect
                  options={dictOptions}
                  value={newMaterialName}
                  onChange={(val, opt) => {
                    setNewMaterialName(val);
                    if (opt && opt.unit) {
                      setNewMaterialUnit(opt.unit);
                    }
                  }}
                  placeholder="请输入或选择原料，如: 土豆"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 block uppercase">计量单位</label>
                <input 
                  type="text" placeholder="如: 斤 / 袋 / 箱" value={newMaterialUnit} onChange={(e) => setNewMaterialUnit(e.target.value)}
                  className="w-full bg-slate-50 text-xs p-2.5 border border-slate-200 rounded outline-none focus:border-emerald-500 focus:bg-white" required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 block uppercase">规格描述</label>
                <input 
                  type="text" placeholder="如: 25kg/袋" value={newMaterialSpec} onChange={(e) => setNewMaterialSpec(e.target.value)}
                  className="w-full bg-slate-50 text-xs p-2.5 border border-slate-200 rounded outline-none focus:border-emerald-500 focus:bg-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 block uppercase">初始库存</label>
                <input 
                  type="number" step="any" value={newMaterialStock} onChange={(e) => setNewMaterialStock(Number(e.target.value))}
                  className="w-full bg-slate-50 text-xs p-2.5 border border-slate-200 rounded outline-none focus:border-emerald-500 focus:bg-white" required
                />
              </div>

              <button 
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                确认添加
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
