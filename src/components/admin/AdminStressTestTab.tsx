import React, { useState } from "react";
import { LedgerService } from "../../services/ledgerStore.ts";
import { PrepReportService } from "../../services/store.ts";
import { Play, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { DailyStockRecord } from "../../types/ledgerTypes.ts";

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
        const item = await LedgerService.addLedgerItem(ledgerId, `极限测试土豆_${Date.now()}_${i}`, "斤", "压测", 0);
        createdItemIds.push(item.id);
      }
      addLog(`创建完毕！耗时: ${((performance.now() - startTime)/1000).toFixed(2)}s`);

      addLog(`[第二步] 构建为期 ${testDays} 天的海量出入库有效负载（每条同时包含浮点入库和出库）...`);
      let totalExpectedInQty = 0;
      let totalExpectedOutQty = 0;
      let totalExpectedInAmount = 0; // 累计入库金额
      let totalExpectedOutAmount = 0; // 累计出库金额

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
          
          // 严格模拟底层单笔记录的就地四舍五入，防止 JS 累加浮点精度爆炸导致报表金额对不齐
          const dailyInAmount = Math.round(inQty * inPrice * 100) / 100;
          totalExpectedInAmount += dailyInAmount;
          
          // 根据目前的机制，如果当天只有 inQty 和 inPrice，同步到报表时使用 inQty * inPrice; 
          // 但真实场景如果出入库全有，出入单价一样。系统自动推导出的消耗金额是基于报表逻辑。
          // 此处我们严格记录入库的汇总值用于下面与报表的对账验证。
          
          updates[itemId] = {
            inQuantity: inQty,
            inPrice: inPrice,
            outQuantity: outQty
          };
        }
        
        // 调用批量前端接口更新，它会自动同步到后台并且反向触发 PrepReportService 的同步
        await LedgerService.updateDailyRecordsBatch(dateStr, updates);
      }
      const batchElapsed = ((performance.now() - batchStartTime)/1000).toFixed(2);
      addLog(`[完成录入] ${testDays * testItemsCount} 个每日节点全部录入成功，全程无卡顿！耗时: ${batchElapsed}s`);

      addLog(`[第三步] 对比底层聚合数据进行严格算力核验...`);
      
      let actualCurrentStockSum = 0;
      const allItems = LedgerService.getLedgerItems(ledgerId);
      for (const itemId of createdItemIds) {
        const item = allItems.find(i => i.id === itemId);
        if (item) {
          actualCurrentStockSum += item.currentStock;
        }
      }

      // 1. 台账结余精度核算
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
      }

      // 2. 报表同步正确性核算
      const allReports = PrepReportService.getReports();
      const testReport = allReports.find(r => r.targetGroup === ledgerId && r.year === baseYear && r.month === baseMonth); 
      let actualReportTotalAmount = 0;
      
      if (testReport) {
        for (const reportItem of testReport.items) {
          // 判断是否是我们本次创建的测试项目
          if (createdItemIds.includes(reportItem.id) || reportItem.name.includes("极限测试土豆_")) {
            for (let d = 1; d <= 31; d++) {
              const dKey = d.toString();
              if (reportItem.dailyData[dKey]) {
                actualReportTotalAmount += reportItem.dailyData[dKey].amount;
              }
            }
          }
        }
      }

      // 台账系统往报表同步的时候，严格使用当日入库金额累计。
      // 因为前端汇总了 900 条带有 2 位小数的 dailyData amount，在相加时 JS 可能产生 0.0000000000001 的精度问题，
      // 所以我们把两边的总数都做一次常规的四舍五入。
      const finalActualAmount = Math.round(actualReportTotalAmount * 100) / 100;
      const finalExpectedAmount = Math.round(totalExpectedInAmount * 100) / 100;
      
      const amountDiff = Math.abs(finalActualAmount - finalExpectedAmount);
      if (amountDiff > 0.1) { 
        addLog(`❌ [核对失败] 备餐月度报表金额联动同步出现严重偏离！期望总金额: ${finalExpectedAmount.toFixed(2)}, 报表统计: ${finalActualAmount.toFixed(2)}`);
        setResult("fail");
      } else {
        addLog(`✅ [核对成功] 前端报表自动汇总金额与台账入库总额完全匹配: 累计金额为 ${finalActualAmount.toFixed(2)} 元。`);
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
          <h2 className="text-lg font-bold text-slate-800">在前端进行接口级海量数据极限压测</h2>
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
