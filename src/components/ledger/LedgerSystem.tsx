/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 原料购销台账及库存仓储系统主面板组件：编排台账的筛选、样式一/样式二切换、录入模式、原料增删改、批量签字与打印导出等各子组件；数据加载与录入模式状态机已分别抽取到 useLedgerData/useLedgerRecording 两个自定义 Hook 中。
 */

import { useEffect, useState, useMemo } from "react";
import { Ledger, LedgerItem, DailyStockRecord } from "../../types/ledgerTypes.ts";
import { LedgerService } from "../../services/ledgerStore.ts";
import { LEDGER_UI_TEXT, LEDGER_HEADERS } from "../../constants/ledgerConstants.ts";
import { LogBroker, matchPinyin, getDatesBetween } from "../../utils.ts";
import { SearchableSelect } from "../shared/SearchableSelect.tsx";
import { RawMaterialsDictService } from "../../services/rawMaterialDict.ts";
import { FoodCategory } from "../../types/types.ts";
import { FOOD_CATEGORY_LABELS } from "../../constants/constants.ts";
import { LedgerPrintDoc } from "./LedgerPrintDoc.tsx";
import { LedgerPrintPreviewOverlay } from "./LedgerPrintPreviewOverlay.tsx";
import { LedgerStyle1Table } from "./LedgerStyle1Table.tsx";
import { LedgerStyle2Flow } from "./LedgerStyle2Flow.tsx";
import { LedgerInvoiceTab } from "./LedgerInvoiceTab.tsx";
import { LedgerAddMaterialModal } from "./LedgerAddMaterialModal.tsx";
import { LedgerPrintModal } from "./LedgerPrintModal.tsx";
import { LedgerSidebar } from "./LedgerSidebar.tsx";
import { LedgerControlBar } from "./LedgerControlBar.tsx";
import { useLedgerData } from "../../hooks/useLedgerData.ts";
import { useLedgerRecording } from "../../hooks/useLedgerRecording.ts";
import {
  Calendar,
  AlertCircle,
  FileText,
  LayoutGrid,
  TrendingUp
} from "lucide-react";

/**
 * @description 原料购销台账及库存仓储系统主面板组件
 */
export function LedgerSystem() {
  // ================= 状态声明部分 =================

  // 台账列表、原料项目列表及当前选中台账ID的加载与订阅逻辑，统一由 useLedgerData 提供
  const { ledgers, ledgerItems, activeLedgerId, setActiveLedgerId } = useLedgerData();

  /** 当前选中的台账展现样式，style1总表(日清单)，style2单原料流水(月卡片) */
  const [ledgerStyle, setLedgerStyle] = useState<"style1" | "style2">("style1");
  /** 样式二下当前选中聚焦进行流水查看的原料ID */
  const [activeItemId, setActiveItemId] = useState<string>("");

  /** 当前选择进行数据同步的日期 (格式 YYYY-MM-DD，默认今天) */
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });

  /** 样式二（单原料日流水）自定义时间段 - 开始日期 */
  const [style2StartDate, setStyle2StartDate] = useState<string>("");
  /** 样式二（单原料日流水）自定义时间段 - 结束日期 */
  const [style2EndDate, setStyle2EndDate] = useState<string>("");
  
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
  // 新增原料模糊搜索检索词
  const [addMaterialSearchQuery, setAddMaterialSearchQuery] = useState<string>("");
  const [isAddDropdownOpen, setIsAddDropdownOpen] = useState<boolean>(false);
  
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

  // --- 批量确认录入模式相关状态与动作，统一由 useLedgerRecording 提供 ---
  const {
    isRecordingMode,
    draftRecords,
    handleStartRecording,
    handleDraftCellChange,
    handleConfirmRecording,
    handleCancelRecording
  } = useLedgerRecording({
    activeLedgerId,
    selectedDate,
    ledgerItems,
    onSaveToast: (message, durationMs = 2500) => {
      setSaveToast(message);
      setTimeout(() => setSaveToast(null), durationMs);
    },
    onError: (message, durationMs = 4000) => {
      setErrorMessage(message);
      setTimeout(() => setErrorMessage(null), durationMs);
    }
  });

  // --- 台账多维度筛选状态（样式一主表格专用）---
  /** 原料名称搜索关键字（支持模糊匹配） */
  const [filterName, setFilterName] = useState<string>("");
  /** 筛选品类（空字符串表示全部不限）*/
  const [filterCategory, setFilterCategory] = useState<string>("");
  /** 筛选采购员（空字符串表示全部不限）*/
  const [filterBuyer, setFilterBuyer] = useState<string>("");
  /** 筛选检验员（空字符串表示全部不限）*/
  const [filterInspector, setFilterInspector] = useState<string>("");
  /** 筛选保管员（空字符串表示全部不限）*/
  const [filterKeeper, setFilterKeeper] = useState<string>("");

  /** 仅供打印使用的纯净弹出视图状态: null | "in" | "out" */
  const [printDocType, setPrintDocType] = useState<null | "in" | "out">(null);

  // --- 高级打印模式相关状态 ---
  /** 区分当前正处于何种打印预览中：null 表示关闭预览，"style1"表示总表模式预览，"style2"表示单原料流水预览 */
  const [printPreviewStyle, setPrintPreviewStyle] = useState<null | "style1" | "style2">(null);
  /** 二级分类勾选打印控制弹窗 */
  const [printModalOpen, setPrintModalOpen] = useState<boolean>(false);
  /** 总表打印预览下选中的二级食材分类（默认包含全部大类） */
  const [selectedPrintCategories, setSelectedPrintCategories] = useState<FoodCategory[]>([
    FoodCategory.VEGETABLE,
    FoodCategory.GRAIN_OIL,
    FoodCategory.SEASONING,
    FoodCategory.MEAT,
    FoodCategory.LOW_CONSUMP,
    FoodCategory.FRUIT
  ]);

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

  // 监听全局点击事件，点击外部收起添加原料的联想下拉框
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".add-material-search-container")) {
        setIsAddDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // ================= 计算属性与动态过滤 =================

  /** 当前被选中的台账对象 */
  const activeLedger = useMemo(() => {
    return ledgers.find((l) => l.id === activeLedgerId) || null;
  }, [ledgers, activeLedgerId]);

  /** 过滤并整合出当前选中台账应该显示的采购原料项目（非录入模式下仅展示台账已持有的正式原料，录入模式下默认平铺所有字典原料以直接编辑）*/
  const currentLedgerItems = useMemo(() => {
    const dictItems = RawMaterialsDictService.getItems();
    // 找出已保存在数据库本台账下的正式原料
    const dbItems = ledgerItems.filter((item) => {
      const exists = dictItems.some((d) => d.name === item.name);
      return item.ledgerId === activeLedgerId && exists;
    });

    // 如果非录入模式，则保持只展示正式存在的原料
    if (!isRecordingMode) {
      return dbItems;
    }

    const dbItemsMap = new Map(dbItems.map((item) => [item.name, item]));

    // 录入模式下，动态合并已有的和临时的（带 temp_ 前缀 ID）以实现平铺所有大字典原料采购项
    return dictItems.map((dictItem) => {
      if (dbItemsMap.has(dictItem.name)) {
        return dbItemsMap.get(dictItem.name)!;
      }
      return {
        id: `temp_${dictItem.name}`,
        ledgerId: activeLedgerId,
        name: dictItem.name,
        unit: dictItem.unit,
        spec: dictItem.remark || "",
        initialStock: 0,
        currentStock: 0,
        dailyRecords: {}
      } as LedgerItem;
    });
  }, [ledgerItems, activeLedgerId, isRecordingMode]);

  /**
   * 叠加所有筛选条件后的展示项目列表（仅供样式一渲染，不参与录入逻辑）
   * 依赖：名称搜索词、品类、采购员、检验员、保管员、选定日期
   */
  const filteredLedgerItems = useMemo(() => {
    const dictItems = RawMaterialsDictService.getItems();
    return currentLedgerItems.filter((item) => {
      // 安全防呆校验：当前显示的台账原料必须存在于后台设置的原料字典大底库中，避免后台不存在的品类出现
      const dictItem = dictItems.find(d => d.name === item.name);
      if (!dictItem) return false;

      if (filterName.trim()) {
        if (!matchPinyin(item.name, filterName)) return false;
      }
      if (filterCategory) {
        if (dictItem.category !== filterCategory) return false;
      }
      if (filterBuyer.trim()) {
        const rec = item.dailyRecords[selectedDate];
        if (!((rec?.buyer || "").toLowerCase().includes(filterBuyer.trim().toLowerCase()))) return false;
      }
      if (filterInspector.trim()) {
        const rec = item.dailyRecords[selectedDate];
        if (!((rec?.inspector || "").toLowerCase().includes(filterInspector.trim().toLowerCase()))) return false;
      }
      if (filterKeeper.trim()) {
        const rec = item.dailyRecords[selectedDate];
        if (!((rec?.keeper || "").toLowerCase().includes(filterKeeper.trim().toLowerCase()))) return false;
      }
      return true;
    });
  }, [currentLedgerItems, filterName, filterCategory, filterBuyer, filterInspector, filterKeeper, selectedDate]);

  /** 当前台账存在的品类集合（动态），用于品类筛选下拉 */
  const availableCategories = useMemo(() => {
    const dictItems = RawMaterialsDictService.getItems();
    const catSet = new Set<string>();
    currentLedgerItems.forEach(item => {
      const dictItem = dictItems.find(d => d.name === item.name);
      if (dictItem?.category) catSet.add(dictItem.category);
    });
    return Array.from(catSet);
  }, [currentLedgerItems]);

  /** 采购员候选列表（当前台账所有历史记录中出现过的） */
  const availableBuyers = useMemo(() => {
    const set = new Set<string>();
    currentLedgerItems.forEach(item => {
      Object.values(item.dailyRecords).forEach(rec => { if (rec.buyer?.trim()) set.add(rec.buyer.trim()); });
    });
    return Array.from(set);
  }, [currentLedgerItems]);

  /** 检验员候选列表 */
  const availableInspectors = useMemo(() => {
    const set = new Set<string>();
    currentLedgerItems.forEach(item => {
      Object.values(item.dailyRecords).forEach(rec => { if (rec.inspector?.trim()) set.add(rec.inspector.trim()); });
    });
    return Array.from(set);
  }, [currentLedgerItems]);

  /** 保管员候选列表 */
  const availableKeepers = useMemo(() => {
    const set = new Set<string>();
    currentLedgerItems.forEach(item => {
      Object.values(item.dailyRecords).forEach(rec => { if (rec.keeper?.trim()) set.add(rec.keeper.trim()); });
    });
    return Array.from(set);
  }, [currentLedgerItems]);

  /** 是否有任何筛选条件正处于激活状态 */
  const hasActiveFilters = !!(filterName.trim() || filterCategory || filterBuyer.trim() || filterInspector.trim() || filterKeeper.trim());

  // 当切换台账时，自动把样式二的聚焦原料设为该台账的第一个原料项目
  useEffect(() => {
    if (currentLedgerItems.length > 0) {
      setActiveItemId(currentLedgerItems[0].id);
    } else {
      setActiveItemId("");
    }
  }, [activeLedgerId, currentLedgerItems.length]);

  // 当 selectedDate 改变时，默认重置样式二的时间段为当前整月
  useEffect(() => {
    const parts = selectedDate.split("-");
    const year = parseInt(parts[0] || "2026");
    const month = parseInt(parts[1] || "06");
    
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
    
    setStyle2StartDate(firstDay);
    setStyle2EndDate(lastDay);
  }, [selectedDate]);

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

  /** 样式二（单原料日流水）自定义时间段内的所有日期列表 */
  const style2DatesArray = useMemo(() => {
    return getDatesBetween(style2StartDate, style2EndDate);
  }, [style2StartDate, style2EndDate]);

  /** 样式二下单个原料自定义时间段内每天的历史库存结余计算映射表 */
  const dailyStockBalances = useMemo(() => {
    if (!activeItemId) return {};
    const item = ledgerItems.find((i) => i.id === activeItemId);
    if (!item) return {};
    
    const balances: Record<string, number> = {};
    
    // 计算开始日期之前的历史期初库存（从初始库存出发，加减所有早于 style2StartDate 的出入库记录）
    let startBalance = item.initialStock || 0;
    Object.entries(item.dailyRecords).forEach(([dateKey, record]) => {
      if (dateKey < style2StartDate) {
        startBalance += (record.inQuantity || 0) - (record.outQuantity || 0);
      }
    });
    
    // 从期初库存开始，逐日正向累计出入库变动，推算每天结余
    let accum = Math.round(startBalance * 100) / 100;
    style2DatesArray.forEach((dateStr) => {
      const record = item.dailyRecords[dateStr] || { inQuantity: 0, outQuantity: 0 };
      accum = accum + (record.inQuantity || 0) - (record.outQuantity || 0);
      balances[dateStr] = Math.round(accum * 100) / 100;
    });
    
    return balances;
  }, [activeItemId, ledgerItems, style2StartDate, style2EndDate, style2DatesArray]);

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

  // ================= (老版本) 打印入库单与出库单凭证覆盖层 =================
  if (printDocType) {
    return (
      <LedgerPrintDoc
        printDocType={printDocType}
        activeLedger={activeLedger}
        selectedDate={selectedDate}
        dailyInwardItems={dailyInwardItems}
        dailyOutwardItems={dailyOutwardItems}
        dailyInTotalAmount={dailyInTotalAmount}
        onClose={() => setPrintDocType(null)}
      />
    );
  }

  // ================= (新) 打印总表及单原料月流水覆盖层 =================
  if (printPreviewStyle) {
    return (
      <LedgerPrintPreviewOverlay
        printPreviewStyle={printPreviewStyle}
        setPrintPreviewStyle={setPrintPreviewStyle}
        activeLedger={activeLedger}
        selectedDate={selectedDate}
        selectedPrintCategories={selectedPrintCategories}
        currentLedgerItems={currentLedgerItems}
        activeItemId={activeItemId}
        ledgerItems={ledgerItems}
        style2StartDate={style2StartDate}
        style2EndDate={style2EndDate}
        style2DatesArray={style2DatesArray}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-[#f1f5f9] text-slate-800 font-sans overflow-hidden">
      
      {/* 左侧台账选择名录区 */}
      <LedgerSidebar
        ledgers={ledgers}
        activeLedgerId={activeLedgerId}
        renameLedgerId={renameLedgerId}
        renameLedgerName={renameLedgerName}
        setActiveLedgerId={setActiveLedgerId}
        setRenameLedgerName={setRenameLedgerName}
        setRenameLedgerId={setRenameLedgerId}
        handleRenameLedgerSubmit={handleRenameLedgerSubmit}
      />

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

        <LedgerControlBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isRecordingMode={isRecordingMode}
          ledgerItems={ledgerItems}
          activeItemId={activeItemId}
          setActiveItemId={setActiveItemId}
          currentLedgerItems={currentLedgerItems}
          ledgerStyle={ledgerStyle}
          dailyInwardItems={dailyInwardItems}
          dailyOutwardItems={dailyOutwardItems}
          batchOutHandler={batchOutHandler}
          setBatchOutHandler={setBatchOutHandler}
          batchOutRecipient={batchOutRecipient}
          setBatchOutRecipient={setBatchOutRecipient}
          newMaterialName={newMaterialName}
          setNewMaterialName={setNewMaterialName}
          addMaterialSearchQuery={addMaterialSearchQuery}
          setAddMaterialSearchQuery={setAddMaterialSearchQuery}
          isAddDropdownOpen={isAddDropdownOpen}
          setIsAddDropdownOpen={setIsAddDropdownOpen}
          setSaveToast={setSaveToast}
          triggerError={triggerError}
          handleStartRecording={handleStartRecording}
          handleConfirmRecording={handleConfirmRecording}
          handleCancelRecording={handleCancelRecording}
          handleApplyBatchSignatures={handleApplyBatchSignatures}
          handleExportInwardCsv={handleExportInwardCsv}
          handleExportOutwardCsv={handleExportOutwardCsv}
          setPrintModalOpen={setPrintModalOpen}
          setPrintPreviewStyle={setPrintPreviewStyle}
          triggerPrintDoc={triggerPrintDoc}
          activeLedgerId={activeLedgerId}
        />

        {/* 主体工作区 */}

        <div className="flex-1 overflow-auto p-4 scrollbar-thin">
          
          {/* Tab 1: 台账数据录入 */}
          {activeTab === "entry" && (
            <>
              {/* 样式一：食品原材料购销总表 (图一样式) */}
              {ledgerStyle === "style1" && (
                <LedgerStyle1Table
                  currentLedgerItems={currentLedgerItems}
                  filteredLedgerItems={filteredLedgerItems}
                  selectedDate={selectedDate}
                  isRecordingMode={isRecordingMode}
                  draftRecords={draftRecords}
                  editingMaterialId={editingMaterialId}
                  editMaterialName={editMaterialName}
                  editMaterialSpec={editMaterialSpec}
                  editMaterialUnit={editMaterialUnit}
                  editMaterialStock={editMaterialStock}
                  dictOptions={dictOptions}
                  availableCategories={availableCategories}
                  availableBuyers={availableBuyers}
                  availableInspectors={availableInspectors}
                  availableKeepers={availableKeepers}
                  filterName={filterName}
                  filterCategory={filterCategory}
                  filterBuyer={filterBuyer}
                  filterInspector={filterInspector}
                  filterKeeper={filterKeeper}
                  hasActiveFilters={hasActiveFilters}
                  setFilterName={setFilterName}
                  setFilterCategory={setFilterCategory}
                  setFilterBuyer={setFilterBuyer}
                  setFilterInspector={setFilterInspector}
                  setFilterKeeper={setFilterKeeper}
                  handleSaveEditMaterial={handleSaveEditMaterial}
                  handleDeleteMaterial={handleDeleteMaterial}
                  handleDraftCellChange={handleDraftCellChange}
                  setEditingMaterialId={setEditingMaterialId}
                  setEditMaterialName={setEditMaterialName}
                  setEditMaterialSpec={setEditMaterialSpec}
                  setEditMaterialUnit={setEditMaterialUnit}
                  setEditMaterialStock={setEditMaterialStock}
                />
              )}

              {/* 样式二：单原料日出入库流水账 (图二样式) */}
              {ledgerStyle === "style2" && (
                <LedgerStyle2Flow
                  activeItemId={activeItemId}
                  ledgerItems={ledgerItems}
                  dateParts={dateParts}
                  selectedDate={selectedDate}
                  isRecordingMode={isRecordingMode}
                  draftRecords={draftRecords}
                  style2DatesArray={style2DatesArray}
                  dailyStockBalances={dailyStockBalances}
                  handleDraftCellChange={handleDraftCellChange}
                  style2StartDate={style2StartDate}
                  style2EndDate={style2EndDate}
                  setStyle2StartDate={setStyle2StartDate}
                  setStyle2EndDate={setStyle2EndDate}
                />
              )}
            </>
          )}

          {/* Tab 2: 当日出入库单 (明细归集) */}
          {activeTab === "invoice" && (
            <LedgerInvoiceTab
              dailyInwardItems={dailyInwardItems}
              dailyOutwardItems={dailyOutwardItems}
              dailyInTotalAmount={dailyInTotalAmount}
            />
          )}

        </div>
      </div>

      {/* 新增原料明细模态弹框 */}
      <LedgerAddMaterialModal
        isOpen={isAddMaterialOpen}
        activeLedgerName={activeLedger?.name || ""}
        newMaterialName={newMaterialName}
        newMaterialUnit={newMaterialUnit}
        newMaterialSpec={newMaterialSpec}
        newMaterialStock={newMaterialStock}
        dictOptions={dictOptions}
        setNewMaterialName={setNewMaterialName}
        setNewMaterialUnit={setNewMaterialUnit}
        setNewMaterialSpec={setNewMaterialSpec}
        setNewMaterialStock={setNewMaterialStock}
        onClose={() => setIsAddMaterialOpen(false)}
        onSubmit={handleAddMaterialSubmit}
      />

      {/* 二级分类打印勾选模态弹框 */}
      <LedgerPrintModal
        isOpen={printModalOpen}
        selectedPrintCategories={selectedPrintCategories}
        setSelectedPrintCategories={setSelectedPrintCategories}
        setPrintPreviewStyle={setPrintPreviewStyle}
        onClose={() => setPrintModalOpen(false)}
      />

    </div>
  );
}