/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 封装台账"今日录入模式"状态机的自定义 Hook：管理录入模式开关、当日采购/出入库草稿数据（含 LocalStorage 缓存读写），以及开始录入、单元格草稿变更、确认提交、取消录入四个核心动作。
 */

import { useEffect, useState } from "react";
import { LedgerItem, DailyStockRecord } from "../types/ledgerTypes.ts";
import { LedgerService } from "../services/ledgerStore.ts";
import { RawMaterialsDictService } from "../services/rawMaterialDict.ts";
import { LogBroker } from "../utils.ts";

/**
 * @description useLedgerRecording 入参接口
 */
export interface UseLedgerRecordingParams {
  /** 当前选中的台账唯一标识ID */
  activeLedgerId: string;
  /** 当前选择进行数据同步的日期 (格式 YYYY-MM-DD) */
  selectedDate: string;
  /** 所有的采购原料项目列表 */
  ledgerItems: LedgerItem[];
  /** 触发自动同步成功气泡提示的回调 */
  onSaveToast: (message: string, durationMs?: number) => void;
  /** 触发错误提示的回调 */
  onError: (message: string, durationMs?: number) => void;
}

/**
 * @description useLedgerRecording 返回值接口
 */
export interface UseLedgerRecordingResult {
  /** 当前选定台账与日期是否正处于"录入中"状态 */
  isRecordingMode: boolean;
  /** 处于录入模式时，存储的当前日采购及出库草稿数据 */
  draftRecords: Record<string, DailyStockRecord>;
  /** 启动录入模式，优先从本地缓存读取未确认的草稿数据 */
  handleStartRecording: () => void;
  /** 录入模式下，更新草稿内存与 LocalStorage 缓存 */
  handleDraftCellChange: (itemId: string, fields: Partial<DailyStockRecord>) => void;
  /** 确认提交并同步数据，保存至数据库并清空本地 LocalStorage 缓存 */
  handleConfirmRecording: () => Promise<void>;
  /** 放弃当前草稿录入（不会清除本地缓存，下次点击录入可找回） */
  handleCancelRecording: () => void;
}

/**
 * @description 管理台账"今日录入模式"开关、草稿数据与确认/取消动作的自定义 Hook
 */
export function useLedgerRecording({
  activeLedgerId,
  selectedDate,
  ledgerItems,
  onSaveToast,
  onError
}: UseLedgerRecordingParams): UseLedgerRecordingResult {
  /** 当前选定台账与日期是否正处于"录入中"状态 */
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(false);
  /** 处于录入模式时，存储的当前日采购及出库草稿数据 */
  const [draftRecords, setDraftRecords] = useState<Record<string, DailyStockRecord>>({});

  // 当切换台账或修改日期时，退出录入模式并清理内存草稿
  useEffect(() => {
    setIsRecordingMode(false);
    setDraftRecords({});
  }, [activeLedgerId, selectedDate]);

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
        onSaveToast("已恢复未提交的本地缓存数据", 2500);
      } catch (err) {
        console.error("加载台账缓存失败:", err);
      }
    } else {
      // 否则从当前已存的 dailyRecords 中读取数据作为初始草稿（使用全字典原料，方便录入时默认全部呈现）
      const dictItems = RawMaterialsDictService.getItems();
      const dbItemsMap = new Map(
        ledgerItems
          .filter((item) => item.ledgerId === activeLedgerId)
          .map((item) => [item.name, item])
      );

      dictItems.forEach((dictItem) => {
        const dbItem = dbItemsMap.get(dictItem.name);
        const record = dbItem?.dailyRecords[selectedDate];
        const itemId = dbItem ? dbItem.id : `temp_${dictItem.name}`;

        if (record) {
          initialDraft[itemId] = { ...record };
        } else {
          initialDraft[itemId] = {
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
      // 自动计算换算比例对应的换算后单位数量数值（如袋数*50）
      if (updatedRecord.inQuantity !== undefined) {
        // 直接从 itemId 或已有的 items 中分析出原料名字，支持 temp_ 临时前缀原料
        const rawName = itemId.startsWith("temp_") ? itemId.replace("temp_", "") : (ledgerItems.find(i => i.id === itemId)?.name || "");
        if (rawName) {
          const dictItem = RawMaterialsDictService.getItems().find((d) => d.name === rawName);
          if (dictItem && dictItem.conversionRatio) {
            updatedRecord.conversionUnitQuantity = Number((updatedRecord.inQuantity * dictItem.conversionRatio).toFixed(2));
          } else {
            updatedRecord.conversionUnitQuantity = undefined;
          }
        }
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
   * 如果编辑的原料为临时原料（temp_），且用户填写的该原料记录有至少一条有效数据，则先将其正式安全地添加到该台账中再保存记录
   */
  const handleConfirmRecording = async () => {
    try {
      (window as any).__setGlobalLoading?.("正在向服务端同步并写入今日采购及出入库台账，请稍候...");

      const promises: Promise<void>[] = [];

      // 验证记录是否含有至少一项有效数据值（不为空且不为0）
      const hasAtLeastOneContent = (rec: DailyStockRecord) => {
        return (
          (rec.inQuantity !== undefined && rec.inQuantity > 0) ||
          (rec.outQuantity !== undefined && rec.outQuantity > 0) ||
          !!rec.note?.trim() ||
          !!rec.certification?.trim() ||
          !!rec.sensoryProperty?.trim() ||
          !!rec.supplier?.trim() ||
          !!rec.buyer?.trim() ||
          !!rec.inspector?.trim() ||
          !!rec.keeper?.trim() ||
          !!rec.outHandler?.trim() ||
          !!rec.outRecipient?.trim()
        );
      };

      // 遍历所有项目
      for (const [itemId, record] of Object.entries(draftRecords)) {
        if (itemId.startsWith("temp_")) {
          // 如果是有编辑记录的临时原料，需先添加到本台账下
          if (hasAtLeastOneContent(record)) {
            const rawName = itemId.replace("temp_", "");
            const dictItem = RawMaterialsDictService.getItems().find(d => d.name === rawName);
            if (dictItem) {
              const newItem = await LedgerService.addLedgerItem(
                activeLedgerId,
                dictItem.name,
                dictItem.unit,
                dictItem.remark || "",
                0
              );
              // 使用真实新生成的原料 ID 更新记录
              promises.push(LedgerService.updateDailyRecord(newItem.id, selectedDate, record));
            }
          }
        } else {
          // 已经是数据库中正式存在的原料，直接更新
          promises.push(LedgerService.updateDailyRecord(itemId, selectedDate, record));
        }
      }

      await Promise.all(promises);

      // 清除本地缓存
      const draftKey = `ledger_draft_${activeLedgerId}_${selectedDate}`;
      localStorage.removeItem(draftKey);

      setIsRecordingMode(false);
      setDraftRecords({});

      onSaveToast("当天采购与台账数据已成功保存并同步！", 2500);
      LogBroker.publish("INFO", "LedgerSystem", `成功提交保存并同步 ${selectedDate} 的全部台账与入库数据`);
    } catch (err: any) {
      onError(err.message || "批量保存台账记录失败", 3000);
    } finally {
      (window as any).__setGlobalLoading?.(null);
    }
  };

  /**
   * @description 放弃当前草稿录入（不会清除本地缓存，下次点击录入可找回）
   */
  const handleCancelRecording = () => {
    setIsRecordingMode(false);
    setDraftRecords({});
    LogBroker.publish("INFO", "LedgerSystem", `已暂停 ${selectedDate} 的台账录入，草稿已暂存本地`);
    onSaveToast("录入草稿已暂存本地", 2000);
  };

  return {
    isRecordingMode,
    draftRecords,
    handleStartRecording,
    handleDraftCellChange,
    handleConfirmRecording,
    handleCancelRecording
  };
}
