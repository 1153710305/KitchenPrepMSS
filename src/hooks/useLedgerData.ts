/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 封装台账系统主面板核心数据加载与订阅逻辑的自定义 Hook：从 LedgerService 同步内存默认值，并订阅台账及原料项目的数据变动。
 */

import { useEffect, useState } from "react";
import { Ledger, LedgerItem } from "../types/ledgerTypes.ts";
import { LedgerService } from "../services/ledgerStore.ts";

/**
 * @description useLedgerData 返回值接口
 */
export interface UseLedgerDataResult {
  /** 系统中所有的台账列表 */
  ledgers: Ledger[];
  /** 所有的采购原料项目列表 */
  ledgerItems: LedgerItem[];
  /** 当前选中的台账唯一标识ID */
  activeLedgerId: string;
  setActiveLedgerId: (val: string | ((prev: string) => string)) => void;
}

/**
 * @description 管理台账列表、原料项目列表及当前选中台账ID的加载与订阅的自定义 Hook
 */
export function useLedgerData(): UseLedgerDataResult {
  /** 系统中所有的台账列表 */
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  /** 所有的采购原料项目列表 */
  const [ledgerItems, setLedgerItems] = useState<LedgerItem[]>([]);
  /** 当前选中的台账唯一标识ID */
  const [activeLedgerId, setActiveLedgerId] = useState<string>("");

  useEffect(() => {
    // 依赖全局统一首屏初始化，此处直接同步内存默认值，避免重复拉取
    const currentLedgers = LedgerService.getLedgers();
    if (currentLedgers.length > 0) {
      setActiveLedgerId((prev) => prev || currentLedgers[0].id);
    }

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

  return { ledgers, ledgerItems, activeLedgerId, setActiveLedgerId };
}
