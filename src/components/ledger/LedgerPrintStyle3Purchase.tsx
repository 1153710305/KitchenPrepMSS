import React from "react";
import { Ledger, LedgerItem } from "../../types/ledgerTypes.ts";
import { LedgerService } from "../../services/ledgerStore.ts";

interface LedgerPrintStyle3PurchaseProps {
  activeLedger: Ledger | null;
  selectedDate: string;
  ledgerItems: LedgerItem[];
  customDataRows: number;
}

export function LedgerPrintStyle3Purchase({
  activeLedger,
  selectedDate,
  ledgerItems,
  customDataRows
}: LedgerPrintStyle3PurchaseProps) {
  if (!activeLedger) return null;

  // 1. 根据选中日期筛选当天有入库数量的数据，且必须属于当前选中的台账
  const purchaseItems = ledgerItems.filter(item => {
    if (item.ledgerId !== activeLedger.id) return false;
    const dailyRecord = item.dailyRecords[selectedDate];
    return dailyRecord && dailyRecord.inQuantity > 0;
  });

  // 2. 分页处理
  const rowsPerPage = customDataRows;
  const pages: Array<typeof purchaseItems> = [];
  if (purchaseItems.length === 0) {
    pages.push([]);
  } else {
    for (let i = 0; i < purchaseItems.length; i += rowsPerPage) {
      pages.push(purchaseItems.slice(i, i + rowsPerPage));
    }
  }

  const helperDict = LedgerService.getHelperDict();

  // 查找供货商对应的联系方式
  const getSupplierContact = (supplierName: string) => {
    if (!supplierName) return "";
    const found = helperDict.suppliers.find(s => s.startsWith(supplierName + "|"));
    if (found) {
      return found.split("|")[1] || "";
    }
    return "";
  };

  return (
    <div
      className="bg-white min-h-screen print:min-h-0 text-center"
      style={{
        color: "#000",
        marginLeft: "6mm",
        marginRight: "6mm"
      }}
    >
      <style>{`
        @page {
          size: A4 landscape;
          margin: 12mm 18mm;
        }
        .purchase-table, .purchase-table th, .purchase-table td {
          border: 1px solid #000000 !important;
          padding: 4px 2px;
          text-align: center;
          font-size: 11px;
          line-height: 1.2;
          word-break: break-all;
        }
        @media print {
          .purchase-table, .purchase-table th, .purchase-table td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            border-color: #000000 !important;
          }
        }
        .purchase-table th {
          font-weight: normal;
        }
        .purchase-table thead th {
          background-color: #ffffff !important;
        }
      `}</style>

      {pages.map((pageItems, pageIndex) => {
        const emptyRowsCount = Math.max(0, rowsPerPage - pageItems.length);
        const blankRows = Array.from({ length: emptyRowsCount }).map((_, i) => ({ id: `blank-${i}` }));
        const isLastPage = pageIndex === pages.length - 1;

        return (
          <div key={pageIndex}>
            <div className="relative mb-6 print:mb-0">
              {/* 标题部分 */}
              <div className="relative text-center mb-4 mt-4">
                <h1 className="text-2xl font-normal tracking-widest">采购与进货验收记录</h1>
                <div className="absolute right-[4.5%] translate-x-1/2 -bottom-2 text-sm">
                  {activeLedger.name}
                </div>
              </div>

              {/* 表格主体 */}
              <table className="purchase-table w-full border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: "3%" }} /> {/* 序号 */}
                  <col style={{ width: "5%" }} /> {/* 进货日期 */}
                  <col style={{ width: "5%" }} /> {/* 产品名称 */}
                  <col style={{ width: "5%" }} /> {/* 规格 */}
                  <col style={{ width: "4%" }} /> {/* 数量 */}
                  <col style={{ width: "8%" }} /> {/* 生产批号或日期 */}
                  <col style={{ width: "5%" }} /> {/* 生产者 */}
                  <col style={{ width: "6%" }} /> {/* 地址及联系方式 */}
                  <col style={{ width: "8%" }} /> {/* 供货者 */}
                  <col style={{ width: "9%" }} /> {/* 地址及联系方式 */}
                  <col style={{ width: "4%" }} /> {/* 供货者资质证明 */}
                  <col style={{ width: "4%" }} /> {/* 购货凭证 */}
                  <col style={{ width: "4%" }} /> {/* 产品合格证明 */}
                  <col style={{ width: "4%" }} /> {/* 进口检疫 */}
                  <col style={{ width: "4%" }} /> {/* 肉类 */}
                  <col style={{ width: "5%" }} /> {/* 外观 */}
                  <col style={{ width: "4%" }} /> {/* 温度 */}
                  <col style={{ width: "4%" }} /> {/* 自检 */}
                  <col style={{ width: "5%" }} /> {/* 记录人 */}
                  <col style={{ width: "4%" }} /> {/* 备注 */}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2}>序<br />号</th>
                    <th rowSpan={2}>进货<br />日期</th>
                    <th rowSpan={2}>产品<br />名称</th>
                    <th rowSpan={2}>规格</th>
                    <th rowSpan={2}>数量</th>
                    <th rowSpan={2}>生产<br />批号<br />或日期</th>
                    <th rowSpan={2}>生<br />产<br />者</th>
                    <th rowSpan={2}>地址<br />及联<br />系方式<br />(电话等)</th>
                    <th rowSpan={2}>供<br />货<br />者</th>
                    <th rowSpan={2}>地址<br />及联<br />系方式<br />(电话等)</th>
                    <th colSpan={5}>随货证明文件查验</th>
                    <th colSpan={2}>入库检查</th>
                    <th rowSpan={2}>自检<br />或委<br />检情况</th>
                    <th rowSpan={2}>记<br />录<br />人</th>
                    <th rowSpan={2}>备<br />注</th>
                  </tr>
                  <tr>
                    <th>许可<br />证<br />(如有)</th>
                    <th>营业<br />执照<br />(如有)</th>
                    <th>购货<br />凭证</th>
                    <th>产品<br />检验<br />报告</th>
                    <th>其他合<br />格证明<br />(如有)</th>
                    <th>外观<br />检查</th>
                    <th>温度<br />检查<br />(如需)</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item, index) => {
                    const record = item.dailyRecords[selectedDate];
                    const supplier = record.supplier || "";
                    const contact = getSupplierContact(supplier);
                    // 只要有原材料记录就默认填写“有”
                    const hasItem = "有";
                    const absoluteIndex = pageIndex * rowsPerPage + index + 1;

                    const specText = item.spec || "";
                    let specDisplayLen = 0;
                    for (let i = 0; i < specText.length; i++) {
                      specDisplayLen += specText.charCodeAt(i) > 255 ? 1 : 0.65;
                    }
                    // A4 landscape 减去两边 18mm margin，表格宽约 261mm。5% 宽约 13mm ≈ 49px，减去 padding 大约 45px
                    const estimatedWidth = specDisplayLen * 11; // 假设常规字号为11px时的预估宽度
                    const scaleRatio = estimatedWidth > 45 ? 45 / estimatedWidth : 1;

                    return (
                      <tr key={item.id} className="h-10">
                        <td>{absoluteIndex}</td>
                        <td>
                          <div>{selectedDate.split('-')[0]}</div>
                          <div>{selectedDate.split('-').slice(1).join('/')}</div>
                        </td>
                        <td>{item.name}</td>
                        <td style={{ overflow: "hidden", padding: "4px 2px" }}>
                          <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
                            <span style={{ 
                              whiteSpace: "nowrap", 
                              transform: `scale(${scaleRatio})`, 
                              transformOrigin: "center", 
                              display: "inline-block",
                              fontSize: "11px"
                            }}>
                              {specText}
                            </span>
                          </div>
                        </td>
                        <td>{record.inQuantity}{item.unit || ""}</td>
                        <td>{record.produceDate || ""}</td>
                        <td></td> {/* 生产者 */}
                        <td></td> {/* 生产者联系方式 */}
                        <td>{supplier}</td>
                        <td>{contact}</td>
                        <td>{hasItem}</td>
                        <td>{hasItem}</td>
                        <td>{hasItem}</td>
                        <td>{hasItem}</td>
                        <td>{hasItem}</td>
                        <td>{record.sensoryProperty || ""}</td> {/* 外观检查 */}
                        <td></td> {/* 温度检查 */}
                        <td></td> {/* 自检和委检情况 */}

                        {index === 0 && (
                          <>
                            <td rowSpan={rowsPerPage}></td> {/* 记录人 */}
                            <td rowSpan={rowsPerPage}></td> {/* 备注 */}
                          </>
                        )}
                      </tr>
                    );
                  })}

                  {blankRows.map((_, index) => {
                    return (
                      <tr key={`blank-${pageIndex}-${index}`} className="h-10">
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        {(pageItems.length === 0 && index === 0) && (
                          <>
                            <td rowSpan={rowsPerPage}></td> {/* 记录人 */}
                            <td rowSpan={rowsPerPage}></td> {/* 备注 */}
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* 底部备注 */}
              <div className="mt-4 text-[11px] font-normal pl-2 text-left">
                注：食品安全管理人员应每周检查记录表格，发现异常情况时，立即督促有关人员采取整改措施。
              </div>
            </div>
            {!isLastPage && <div style={{ pageBreakAfter: "always" }} />}
          </div>
        );
      })}
    </div>
  );
}
