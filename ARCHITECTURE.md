# KPMSS 项目架构文档

> 本文档描述截至 **2026-07-06 前后端职责分离三阶段重构（阶段A/B/C）完成后** 的项目真实代码状态，而非重构计划。如后续代码结构继续演进，请同步更新本文档（可参考 [readme_zh.md](readme_zh.md) 的 Changelog 找到对应的重构记录，本次重构详见 [V5.90.0]～[V5.93.0]）。

## 一、项目概述

KPMSS（食堂备菜管理和统计系统）是面向学校/机关食堂的日矩阵记账、原料购销台账与库存管理系统。采用 **React 19 + TypeScript + Vite** 前端、**Express + Node.js** 后端的全栈架构，单进程打包部署（前后端不做部署层面的分离），数据持久化到本地 **SQLite**（默认）或腾讯云 COS 对象存储。

核心业务域有三个：
1. **备餐记账（PrepReport）**：按受众人群（教师/幼儿/在校生等）× 食材大类（蔬菜/粮油/肉类等）的月度日矩阵表格，记录每日数量/单价/金额。
2. **原料购销台账（Ledger）**：按原料维度记录逐日出入库明细（供货商、采购员、检验员、保质期、感官性状等台账要素），支持"总表"与"单原料流水"两种打印/录入样式。
3. **库存总览（Inventory）**：跨受众人群、跨月份的矩阵/单日聚焦两种视图，用于统一查看所有备餐记账数据（当前为只读展示，实际数据录入走台账页面，见六.3）。

管理后台（Admin）提供受众人群、食材大类、原料字典、台账人员与供货商四类基础配置的增删改查。

## 二、目录结构总览

```
KPMSS/
├── server.ts                 # 后端入口：Express 初始化、中间件、路由挂载、Vite 中间件/静态托管、进程级异常捕获
├── server/
│   ├── storageService.ts     # StorageService：本地 SQLite / 腾讯云 COS 双模式持久化 + 业务校验/重算/级联方法（见四、五）
│   ├── logService.ts         # LogService：服务端结构化日志的写入与轮转
│   └── routes/
│       ├── storage.ts        # /api/storage/load|save：全量读取与增量写入（阶段三 SyncOp 协议，见 4.2）
│       ├── rawMaterials.ts   # /api/raw-materials：原料字典增删改（阶段A迁移）
│       ├── ledgers.ts        # /api/ledgers、/api/ledger-items：台账及其原料项/逐日流水增删改（阶段B迁移）
│       ├── reports.ts        # /api/groups、/api/categories：一二级配置增删改（阶段C迁移）
│       └── misc.ts           # /api/log、/api/health 两个杂项路由
├── src/
│   ├── main.tsx               # 前端挂载入口
│   ├── App.tsx                # 应用根组件与顶层外壳（登录/加载态、侧边栏、工具栏、各功能模块路由编排）
│   ├── utils.ts                # 通用工具函数（拼音匹配、CSV 转换、日志上报客户端等）
│   ├── services/              # 业务数据服务层（客户端 pub/sub 单例，负责内存状态管理 + 与后端通信，见三）
│   │   ├── store.ts              # PrepReportService：备餐月度报表 + 人群/大类配置
│   │   ├── ledgerStore.ts        # LedgerService：原料购销台账
│   │   ├── rawMaterialDict.ts    # RawMaterialsDictService：原料字典
│   │   └── syncHelper.ts         # SyncHelper：读路径（loadFromServer/心跳/refreshNow）+ 少数纯前端方法仍在用的写路径（queueChange 等，见 3.3）
│   ├── types/
│   │   ├── types.ts              # 备餐记账相关类型（TargetGroup、GroupMonthlyReport 等）
│   │   └── ledgerTypes.ts         # 台账相关类型（Ledger、LedgerItem、FoodCategory 等）
│   ├── constants/
│   │   ├── constants.ts           # 备餐记账 UI 文案与配置常量
│   │   └── ledgerConstants.ts     # 台账 UI 文案、打印模板配置常量
│   ├── hooks/                  # 自定义 Hook：从大型组件中抽取的状态/副作用逻辑
│   │   ├── useAppAuth.ts          # 登录态、管理员密码校验
│   │   ├── useAppData.ts          # 三大服务的初始化订阅、心跳同步（App.tsx 的核心数据加载）
│   │   ├── useLedgerData.ts       # 台账列表/条目数据加载与订阅（LedgerSystem.tsx 用）
│   │   ├── useLedgerRecording.ts  # 台账录入模式状态机（草稿态、确认/取消提交，含同步确认等待逻辑）
│   │   └── useTableTheme.ts       # 备餐记账表格主题切换（TableGrid.tsx 用）
│   └── components/
│       ├── admin/                # 管理后台：AdminBackend + 4 个配置 Tab 子组件
│       ├── ledger/                # 原料购销台账：LedgerSystem 顶层编排 + 子组件（双样式表格/打印/控制栏等），承担实际数据录入入口
│       ├── inventory/             # 库存总览：InventoryPanel + TableGrid（矩阵/单日聚焦两种视图子组件），当前为只读展示
│       └── shared/                # 跨业务域复用组件：ErrorBoundary、SearchableSelect、HelperSelect、SensorySelector
├── readme_zh.md                # 中文 README + 逐版本 Changelog（仅追加，不改历史）
├── 提示词历史记录.md / prompt_history.md   # AI 提示词变更历史（仅追加，不改历史）
├── 部署指南.md                  # 单机离线部署操作手册（权威部署文档）
├── SQLite迁移规划.md            # SQLite 迁移三阶段规划与实施记录（历史参考文档）
└── ARCHITECTURE.md              # 本文档
```

## 三、数据流向

前端三个业务 Service（`PrepReportService`、`LedgerService`、`RawMaterialsDictService`）都是 pub/sub 单例：内存持有当前数据，`subscribe(listener)` 供组件订阅变化，内部变更后 `notifyListeners()` 触发重渲染。但**写操作的落盘方式因方法而异**——这是本次三阶段重构留下的核心架构特征，不是过渡态：

### 3.1 REST 校验型写路径（阶段A/B/C迁移后的主流路径）

大多数会触碰校验规则、级联删除/更新、金额或库存重算的写操作，现在直接 `fetch()` 对应的 REST 端点，由后端 `StorageService` 的业务方法（见四）完成校验与持久化，前端只负责：
1. 发起请求，`!res.ok` 时把后端返回的 `{ error }` 文案包成 `Error` 抛出（错误文案与迁移前的纯前端实现逐字一致，调用方 UI 的 `catch` 逻辑不用改）。
2. 用响应体里返回的完整实体更新自己的内存（不再自己重新计算一遍校验/重算逻辑）。
3. 若这次操作有跨服务级联效果（如改台账名字连带改一级人群标签），调用 `SyncHelper.refreshNow()` 立即拉取一次最新全量状态并应用，而不是等待最多 10 秒的心跳轮询——这是为了修复"级联结果需要等心跳才能看到"的显示延迟问题（见 [V5.89.0]/[V5.91.0]）。**例外**：`updateCell`（单元格编辑，全系统最高频写操作）不调用 `refreshNow()`，而是让后端直接在响应体里返回级联后的台账原料项，前端做零网络开销的局部内存更新（`LedgerService.setLedgerItemsInMemory()` + `forceNotify()`），避免每次编辑都触发一次全量往返（见 [V5.93.0]）。

### 3.2 纯前端内存写路径（架构约束下刻意保留，非迁移遗漏）

少数方法因为架构原因无法（或暂不适合）迁移成异步 REST 调用，仍然是"改内存 + `SyncHelper.queueChange(op)` 排队 + 200ms 防抖批量 `POST /api/storage/save`"的旧模式：

| 方法 | 所在文件 | 保留原因 |
|---|---|---|
| `getOrCreateReport()` | `store.ts` | 被 `App.tsx` 一个同步 `useMemo` 直接调用，`useMemo` 回调无法 `await`，迁移需要更大范围的组件重构 |
| `syncFromLedger()` | `store.ts` | 依赖 `getOrCreateReport()` 的生成式复杂度，随其一起保留 |
| `syncGroupFromLedger()`/`syncDeleteGroupFromLedger()` | `store.ts` | 级联效果已由后端 `saveGroup`/`deleteGroup` 一次事务完成，生产代码已不再调用，仅保留自身单元测试 |
| `syncLedgerFromGroup()`/`syncDeleteLedgerFromGroup()` | `ledgerStore.ts` | 级联效果已由后端 `updateLedger`/`deleteLedger` 一次事务完成，生产代码已不再调用，仅保留自身单元测试 |
| `cascadeUpdateMaterial()`/`cascadeDeleteMaterial()` | `ledgerStore.ts`、`store.ts` | 原料改名/删除的跨表级联已由后端 `updateRawMaterial`/`deleteRawMaterial` 一次事务完成，生产代码已不再调用，仅保留自身单元测试 |
| `initDictFromServer()` 的历史脏数据去重回写 | `rawMaterialDict.ts` | 首启发现服务器数据存在同名重复项时的自愈回写，属于批量场景非用户增量编辑 |

`SyncHelper` 的 `queueChange`/`pendingOps`/`scheduleFlush`/`flush`/`retryFailedBatch`/`runWhenInitialized`/`isInitialized` 这套写路径基础设施曾计划在阶段C完成后整体删除，但因为上表方法仍是生产代码真实调用路径、其中一部分（`getOrCreateReport`/`syncFromLedger`）还会长期保留在前端，这套写路径予以保留，作为永久性架构结论（见 [V5.93.0]），不再重新评估。

### 3.3 读路径（未受本次重构影响，整体保留）

```
应用冷启动 → useAppData → GET /api/storage/load → StorageService 读取并拼装 → 三个 Service 各自初始化内存
心跳轮询（每 10 秒）→ SyncHelper.loadFromServer() → 竞态守卫（lastLocalMutationAt/hasPendingSync）通过后 → applyFreshData() 静默覆盖内存
级联操作成功后 → SyncHelper.refreshNow()（= loadFromServer() + applyFreshData()，不做竞态守卫）立即刷新，见 3.1
```

## 四、后端业务方法（`server/storageService.ts`）

阶段A/B/C迁移后，`StorageService` 除了原有的 `load()`/`save()` 全量读写，还新增了一批做业务校验/重算/级联的方法，每个方法内部遵循同一个模式：

```ts
public static async someMutation(...): Promise<T> {
  // 1. 参数校验（不通过则 throw new Error("与迁移前逐字一致的中文错误文案")）
  return StorageService.withWriteLock(async () => {
    const current = await StorageService.load();   // 2. 读取当前完整状态
    // 3. 在纯 JS 里计算结果、构造一批 SyncOp[]（含跨实体级联，如改台账名连带改人群配置）
    const ok = await StorageService.saveInternal(ops);  // 4. 复用既有的增量持久化引擎一次性提交
    return result;
  });
}
```

这个"op-batch 级联"模式是三个阶段共用的核心设计：级联不再手写额外的 SQL `UPDATE...WHERE`，而是把级联影响到的每一行都构造成一个 `SyncOp` 追加进同一个数组，一起交给已经过充分测试的 `saveInternal()`（本地 SQLite 走 `applyChangesIntoSqlite()`，包在一个 `db.transaction()` 里；COS 模式走 `applyOpsToPlainObject()`），天然获得事务原子性，也天然获得 COS 模式的等价支持，不需要为级联单独写第二套实现。

**当前业务方法清单**（按迁移阶段分组，路由映射见五）：

| 阶段 | 方法 | 级联影响 |
|---|---|---|
| A | `addRawMaterial`/`updateRawMaterial`/`deleteRawMaterial` | 改名/删除级联更新台账 `ledger_items`、备餐 `prepared_items` 里的同名条目 |
| B | `addLedgerItem`/`updateLedgerItem`/`deleteLedgerItem` | 库存 `currentStock` 重算 |
| B | `updateLedgerDailyRecord` | 逐日流水合并/重算（`mergeLedgerDailyRecord` 私有辅助方法） |
| B | `updateLedger`/`deleteLedger` | 同步/删除对应一级人群配置 `active_groups` 与月度报表 `reports` |
| C | `saveGroup`/`deleteGroup` | 同步创建/改名/删除对应台账 |
| C | `saveCategory`/`deleteCategory` | 删除级联清空所有报表里该大类下的备餐细项 |

> `addPreparedItem`/`updateCell`/`deletePreparedItem`（餐位分组页面下备餐细项的增/改/删）与 `batchUpdatePriceCol`（一键批量调价）四个方法及其对应 REST 端点已被删除——排查确认主报表展示屏的 `readOnly` 硬编码为 `true` 是 [V5.2.0] 就已存在的产品设计（数据录入统一走"原料购销台账"再经 `syncFromLedger()` 反向同步），这四个方法从未有任何 UI 入口能触发，是彻底的死代码，详见 [V5.95.0]。

## 五、持久化设计与路由一览

### 5.1 存储后端

`StorageService` 支持两种存储后端，由 `.env` 的 `STORAGE_TYPE` 切换：
- **`local`**（默认）：本地 **SQLite**（`data/kpmss.sqlite`，WAL 模式），规范化关系型表结构（`ledgers`/`ledger_items`/`ledger_item_daily_records`/`reports`/`prepared_items`/`prepared_item_daily_data`/`active_groups`/`active_categories`/`raw_materials_dict`/`ledger_helper_options` 共 10 张表）。逐日流水（台账每日出入库、备餐每日数量单价）各自独立成表，按 `(item_id, date)` 复合主键存储，而非拍平进一个大 JSON 字段。
- **`cos`**：读写腾讯云 COS 对象存储的等价 JSON 对象（`applyOpsToPlainObject()` 在内存里模拟同样的 upsert/delete 语义后整体序列化写回）。

### 5.2 增量写协议（阶段三，`SyncOp[]`）

`POST /api/storage/save` 接受 `{ protocolVersion: 2, ops: SyncOp[] }`，每个 `SyncOp` 描述"哪个实体的哪一行该 upsert 还是 delete"（见 `server/storageService.ts` 顶部 `SyncOpEntity`/`SyncOp` 类型定义）。这个协议目前有两类调用方：
1. 四、里列出的业务方法内部构造 op 数组自己调用 `saveInternal()`（不经过 HTTP，同进程内直接调用）。
2. 三.2 里仍保留纯前端逻辑的写路径，经 `SyncHelper` 200ms 防抖后打包成一次 `POST /api/storage/save`。
3. 首次启动/批量种子数据生成使用 `op: "replaceAll"`（整体替换该实体全部行）。

### 5.3 备份

系统本身**不含任何自动备份/快照/恢复机制**（[V5.90.0] 起彻底移除，此前的本地/COS JSON 快照是一个前端从未调用过的孤儿功能）。数据安全性完全依赖 SQLite 事务+WAL（本地模式）或云厂商多副本冗余（COS 模式），灾难恢复由客户自行定期做操作系统级的 `data/` 目录整体备份，详见 [部署指南.md](部署指南.md) 第五章。

### 5.4 路由一览

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/storage/load` | GET | 加载全量数据（含逐日流水的透明拼装） |
| `/api/storage/save` | POST | 增量写入（`SyncOp[]` 协议，见 5.2），仅供三.2 纯前端写路径与首启种子数据使用 |
| `/api/raw-materials` | POST | 新增原料字典条目 |
| `/api/raw-materials/:oldName` | PUT | 改名/编辑原料字典条目（级联更新台账/报表同名项） |
| `/api/raw-materials/:name` | DELETE | 删除原料字典条目（`isDefault` 保护，级联清理台账/报表同名项） |
| `/api/ledgers/:id` | PUT | 改名台账（级联同步人群配置） |
| `/api/ledgers/:id` | DELETE | 删除台账（级联清理原料项/人群配置/报表） |
| `/api/ledgers/:ledgerId/items` | POST | 新增台账原料项 |
| `/api/ledger-items/:id` | PUT | 编辑台账原料项（重算库存） |
| `/api/ledger-items/:id` | DELETE | 删除台账原料项 |
| `/api/ledger-items/:id/daily/:date` | PUT | 更新某原料某天的出入库流水（重算库存） |
| `/api/groups/:key` | PUT | 新增/编辑一级人群配置（级联同步台账） |
| `/api/groups/:key` | DELETE | 删除一级人群配置（`isDefault` 保护，级联清理报表/台账） |
| `/api/categories/:key` | PUT | 新增/编辑二级食材大类 |
| `/api/categories/:key` | DELETE | 删除二级食材大类（`isDefault` 保护，级联清空各报表下该大类的备餐细项） |
| `/api/log` | POST | 客户端错误/性能日志上报 |
| `/api/health` | GET | 健康检查 |

## 六、已知的架构边界与待办

1. **COS 云存储模式未做实际联调测试**，仅确认代码路径类型检查通过与逻辑镜像本地模式；如启用建议先做独立端到端验证。
2. **`SyncHelper` 写路径长期保留**（见 3.2），不是待清理项，是架构结论。
3. **主报表展示屏（`App.tsx` 渲染 `TableGrid` 的分支）当前 `readOnly` 硬编码为 `true`**，`addPreparedItem`/`updateCell`/`deletePreparedItem` 在生产 UI 上暂无可达的触发入口——实际数据录入走的是台账页面（`LedgerSystem.tsx`）"今日录入"功能，再经 `PrepReportService.syncFromLedger()` 反向同步生成报表行。这三个后端方法本身经过完整的单元/集成测试验证，是否需要恢复主表格直接编辑入口、或该现象本就是既定设计，留待后续单独评估（不在本次三阶段重构范围内）。
4. **`PrepReportService.syncFromLedger()` 的 `dailyData` 键格式与报表种子矩阵不一致**（前者用裸数字如 `"5"`，后者用完整日期 `"2026-07-05"`），是发现于阶段B验证过程中的既有问题，未在本次重构中修复。
5. **未合并到 `main` 分支** —— 本轮所有改动固定在 `dev` 分支上。

## 七、自动化测试体系

> 详见 [V5.55.0] 起的变更记录。项目使用 Vitest 作为常驻回归安全网。

### 7.1 技术选型

- **Vitest**：与 `vite.config.ts` 原生集成。
- **@testing-library/react** / **jest-dom** / **user-event**：组件与 Hook 测试。
- **supertest**：后端 Express 路由 HTTP 层集成测试，测试文件内构造只挂载对应 router 的最小 Express 实例（不导入有 `app.listen()` 副作用的 `server.ts` 本身）。
- **jsdom**：前端测试环境；后端 `server/**` 目录测试通过 `environmentMatchGlobs` 使用 `node` 环境。
- 未引入 Playwright 等浏览器端到端测试，只做单元/集成测试。

### 7.2 覆盖范围

- **业务逻辑层高覆盖**：`src/utils.ts`、`src/services/*.ts`（含阶段A/B/C迁移后重写的 fetch 断言）、`src/hooks/*.ts`、`server/storageService.ts`（含四、里列出的全部业务方法）、`server/logService.ts`、`server/routes/*.ts`（`storage`/`rawMaterials`/`ledgers`/`reports`/`misc` 五个路由文件均有独立集成测试）。
- **关键交互组件**：`HelperSelect`、`LedgerPrintModal`、`LedgerPrintStyle1`、`LedgerPrintStyle2Consumable`、`LedgerStyle1Table`、`LedgerStyle2Flow`、`TableGrid`、`TableGridMatrixView`、`TableGridFocusView`。纯展示型组件不在覆盖范围内。
- 测试文件采用就近同目录 `*.test.ts(x)` 命名。截至 [V5.93.0]，全量 447 个用例通过。

### 7.3 运行方式

```bash
npm test               # 全量跑一次（CI / 提交前使用）
npm run test:watch     # 监听模式，开发时使用
npm run test:coverage  # 生成覆盖率报告
```

### 7.4 测试隔离要点

- 前端 `private static` 状态的服务类（`LedgerService`/`PrepReportService`/`RawMaterialsDictService`）复用其已有的 `setXInMemory()` 方法在用例间重置内存状态。
- 后端 `StorageService`/`LogService` 在模块加载时从 `process.env.*` 读取路径并绑定到 `private static` 字段；测试通过 `vi.resetModules()` + 动态 `import()` + 临时目录（`fs.mkdtempSync`）为每个用例拿到全新绑定的类实例，杜绝相互污染，也**杜绝任何测试清理逻辑触碰真实的 `data/` 目录**。
- 涉及"删除唯一一行数据"的测试需额外造一条不相关的"锚点"数据（如多加一本台账），避免规范化表结构全空时 `GET /load` 退化返回首启空壳 `{}`，无法验证"确实只删了目标行"（已知边界行为，详见 `storageService.test.ts`）。
- 阶段A/B/C迁移后新增的 REST 集成测试统一使用镜像后端语义的轻量假 `fetch` 路由（如 `fakeLedgerFetch`/`fakePrepReportFetch`）支撑前端 service 测试文件里大量"先增后改/先增后删"的多步测试序列，而非逐个用例手写 canned 响应。
