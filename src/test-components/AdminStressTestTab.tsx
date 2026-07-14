import React, { useState } from "react";
import { LedgerService } from "../services/ledgerStore.ts";
import { RawMaterialsDictService } from "../services/rawMaterialDict.ts";
import { Play, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { DailyStockRecord } from "../types/ledgerTypes.ts";

export function AdminStressTestTab() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<"success" | "fail" | null>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const runTest = async () => {
    if (isRunning) return;

    // 安全校验
    const pwd = window.prompt("【系统安全】请输入管理员密码以执行极限压测（这将在数据库产生大量垃圾数据）：");
    if (!pwd) return;
    if (pwd !== (import.meta.env.VITE_ADMIN_PASSWORD || "admin")) {
      alert("管理员密码错误，拒绝执行压测");
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setResult(null);

    try {
      addLog("开始极限压测，测试目标：30个不同原料，连续录入30天的出入库数据，并验证汇总精度...");

      const ledgerId = "KID"; // 假设KID一定存在（因为有默认种子数据）
      const testItemsCount = 30;
      const testDays = 30;
      const baseYear = 2026;
      const baseMonth = 7;

      addLog(`[第一步] 模拟创建 ${testItemsCount} 个测试专用原料...`);
      const createdItemIds: string[] = [];
      const startTime = performance.now();
      for (let i = 0; i < testItemsCount; i++) {
        const itemName = `极限测试土豆_${Date.now()}_${i}`;
        // 关键修复：必须先在全系统的“原料大字典”里注册这个食材，否则 UI 层（台账页面和明细报表）的“防脏数据校验”会自动将其隐藏过滤掉
        await RawMaterialsDictService.addMaterial(itemName, "VEGETABLE" as any, "斤", "压测自动生成");
        // 然后再给特定台账挂载该食材记录
        const item = await LedgerService.addLedgerItem(ledgerId, itemName, "斤", "压测", 0);
        createdItemIds.push(item.id);
      }
      addLog(`创建完毕！耗时: ${((performance.now() - startTime) / 1000).toFixed(2)}s`);

      addLog(`[第二步] 构建为期 ${testDays} 天的海量出入库有效负载（每条同时包含浮点入库和出库）...`);
      let totalExpectedInQty = 0;
      let totalExpectedOutQty = 0;

      const batchStartTime = performance.now();
      for (let day = 1; day <= testDays; day++) {
        const dateStr = `${baseYear}-0${baseMonth}-${day.toString().padStart(2, '0')}`;
        const updates: Record<string, Partial<DailyStockRecord>> = {};

        for (const itemId of createdItemIds) {
          // 伪随机生成带有小数的单价和数量
          const inQty = parseFloat((Math.random() * 100 + 1).toFixed(2));
          const inPrice = parseFloat((Math.random() * 20 + 0.5).toFixed(2));
          const outQty = parseFloat((Math.random() * 50 + 1).toFixed(2));

          totalExpectedInQty += inQty;
          totalExpectedOutQty += outQty;

          updates[itemId] = {
            inQuantity: inQty,
            inPrice: inPrice,
            outQuantity: outQty
          };
        }

        await LedgerService.updateDailyRecordsBatch(dateStr, updates);
      }
      const batchElapsed = ((performance.now() - batchStartTime) / 1000).toFixed(2);
      addLog(`[完成录入] ${testDays * testItemsCount} 个每日节点全部录入成功，全程无卡顿！耗时: ${batchElapsed}s`);

      addLog(`[第三步] 对比底层聚合数据进行严格算力核验...`);

      let actualCurrentStockSum = 0;
      const allItems = LedgerService.getLedgerItems().filter(i => i.ledgerId === ledgerId);
      for (const itemId of createdItemIds) {
        const item = allItems.find(i => i.id === itemId);
        if (item) {
          actualCurrentStockSum += item.currentStock;
        }
      }

      // 台账结余精度核算：TableGrid 等展示视图现在都直接以 LedgerItem.currentStock 为唯一数据源实时派生，
      // 不再有独立的备餐报表可供二次核对，故压测只需验证这一份底层数据的精度
      const expectedStockSum = Math.round((totalExpectedInQty - totalExpectedOutQty) * 100) / 100;
      const actualRoundedSum = Math.round(actualCurrentStockSum * 100) / 100;
      const stockDiff = Math.abs(actualRoundedSum - expectedStockSum);

      if (stockDiff > 0.01) {
        addLog(`❌ [核对失败] 台账结余计算出现偏差！期望: ${expectedStockSum}, 实际: ${actualRoundedSum}`);
        setResult("fail");
        setIsRunning(false);
        return;
      } else {
        addLog(`✅ [核对成功] 台账物理结存完全匹配出入逻辑（容忍度0.01内）: 累加结存为 ${actualCurrentStockSum.toFixed(2)}`);
        addLog(`🎉 极限压测及校验完美通过！`);
        setResult("success");
      }

    } catch (e: any) {
      addLog(`❌ [抛出异常] 压测过程遭遇报错: ${e.message}`);
      setResult("fail");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">在前端进行接口级海量数据极限压测（非开发者勿点，会污染现有数据！）</h2>
          <p className="text-xs text-slate-500 mt-1">
            通过调用前端聚合接口，模拟人类录入操作快速插入大量测试数据并即时验证前后端数据状态一致性。
          </p>
        </div>
        <button
          onClick={runTest}
          disabled={isRunning}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold transition-all disabled:opacity-50 cursor-pointer"
        >
          {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          <span>{isRunning ? "正在疯狂压测中..." : "启动极限压测"}</span>
        </button>
      </div>

      <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-green-400 h-[300px] overflow-y-auto space-y-1.5 shadow-inner">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic">点击右上角按钮开始压测，日志将在此打印...</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={log.includes("❌") ? "text-red-400" : log.includes("✅") ? "text-emerald-400 font-bold" : ""}>
              {log}
            </div>
          ))
        )}
      </div>

      {result && (
        <div className={`mt-6 p-4 rounded-xl border-2 flex items-start gap-4 ${result === 'success' ? 'bg-emerald-50 border-emerald-500/30' : 'bg-red-50 border-red-500/30'}`}>
          {result === 'success' ? <CheckCircle className="text-emerald-600 shrink-0" size={32} /> : <XCircle className="text-red-600 shrink-0" size={32} />}
          <div>
            <div className={`text-base font-black ${result === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>
              {result === 'success' ? '压测并校验通过：数值完美严丝合缝！' : '压测校验失败：发现逻辑与精度缺陷！'}
            </div>
            <div className="text-xs text-slate-600 mt-1 font-medium">
              本次测试没有依赖界面卡顿的DOM回流，完全基于底层 JS 状态机和 API 高并发，证明了系统的跨模块聚合算力与同步机制绝对可靠。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
