# KPMSS 项目架构文档

> 本文档描述截至 **2026-07-02 结构重构完成后** 的项目真实代码状态，而非重构计划。如后续代码结构继续演进，请同步更新本文档（可参考 [readme_zh.md](readme_zh.md) 的 Changelog 找到对应的重构记录）。

## 一、项目概述

KPMSS（食堂备菜管理和统计系统）是面向学校/机关食堂的日矩阵记账、原料购销台账与库存管理系统。采用 **React 19 + TypeScript + Vite** 前端、**Express + Node.js** 后端的全栈架构，数据可持久化到本地 JSON 文件或腾讯云 COS 对象存储。

核心业务域有三个：
1. **备餐记账（PrepReport）**：按受众人群（教师/幼儿/在校生等）× 食材大类（蔬菜/粮油/肉类等）的月度日矩阵表格，记录每日数量/单价/金额。
2. **原料购销台账（Ledger）**：按原料维度记录逐日出入库明细（供货商、采购员、检验员、保质期、感官性状等台账要素），支持"总表"与"单原料流水"两种打印/录入样式。
3. **库存总览（Inventory）**：跨受众人群、跨月份的矩阵/单日聚焦两种视图，用于统一查看与编辑所有备餐记账数据。

管理后台（Admin）提供受众人群、食材大类、原料字典、台账人员与供货商四类基础配置的增删改查。

## 二、目录结构总览

```
KPMSS/
├── server.ts                 # 后端入口：Express 初始化、中间件、路由挂载、Vite 中间件/静态托管、进程级异常捕获
├── server/
│   ├── storageService.ts     # StorageService：本地文件 / 腾讯云 COS 双模式持久化、逐日流水拆分读写、备份与恢复
│   ├── logService.ts         # LogService：服务端结构化日志的写入与轮转
│   └── routes/
│       ├── storage.ts        # /api/storage/load|save|backups|restore 四个持久化相关路由
│       └── misc.ts           # /api/log、/api/health 两个杂项路由
├── src/
│   ├── main.tsx               # 前端挂载入口
│   ├── App.tsx                # 应用根组件与顶层外壳（登录/加载态、侧边栏、工具栏、各功能模块路由编排）
│   ├── utils.ts                # 通用工具函数（拼音匹配、CSV 转换、日志上报客户端等）
│   ├── services/              # 业务数据服务层（客户端 pub/sub 单例，负责状态管理 + 与后端同步）
│   │   ├── store.ts              # PrepReportService：备餐月度报表 + 人群/大类配置的增删改查
│   │   ├── ledgerStore.ts        # LedgerService：原料购销台账的增删改查
│   │   ├── rawMaterialDict.ts    # RawMaterialsDictService：原料字典（含去重逻辑）
│   │   └── syncHelper.ts         # SyncHelper：统一去抖动保存、启动锁、runWhenInitialized 回调队列
│   ├── types/
│   │   ├── types.ts              # 备餐记账相关类型（TargetGroup、GroupMonthlyReport 等）
│   │   └── ledgerTypes.ts         # 台账相关类型（Ledger、LedgerItem、FoodCategory 等）
│   ├── constants/
│   │   ├── constants.ts           # 备餐记账 UI 文案与配置常量
│   │   └── ledgerConstants.ts     # 台账 UI 文案、打印模板配置常量
│   ├── hooks/                  # 自定义 Hook：从大型组件中抽取的状态/副作用逻辑
│   │   ├── useAppAuth.ts          # 登录态、管理员密码校验
│   │   ├── useAppData.ts          # 三大服务的初始化订阅、SyncHelper 启动锁、心跳同步（App.tsx 的核心数据加载）
│   │   ├── useLedgerData.ts       # 台账列表/条目数据加载与订阅（LedgerSystem.tsx 用）
│   │   ├── useLedgerRecording.ts  # 台账录入模式状态机（草稿态、确认/取消提交）
│   │   └── useTableTheme.ts       # 备餐记账表格主题切换（TableGrid.tsx 用）
│   └── components/
│       ├── admin/                # 管理后台：AdminBackend + 4 个配置 Tab 子组件
│       ├── ledger/                # 原料购销台账：LedgerSystem 顶层编排 + 10 个子组件（双样式表格/打印/控制栏等）
│       ├── inventory/             # 库存总览：InventoryPanel + TableGrid（矩阵/单日聚焦两种视图子组件）
│       └── shared/                # 跨业务域复用组件：ErrorBoundary、SearchableSelect、HelperSelect、SensorySelector
├── readme_zh.md                # 中文 README + 逐版本 Changelog（仅追加，不改历史）
├── 提示词历史记录.md / prompt_history.md   # AI 提示词变更历史（仅追加，不改历史；当前项目已不含 AI 功能，历史记录作为存档保留）
└── ARCHITECTURE.md              # 本文档
```

## 三、数据流向

### 3.1 客户端状态管理模式

`services/` 下的三个服务（`PrepReportService`、`LedgerService`、`RawMaterialsDictService`）都是同构的 **pub/sub 单例**：
- 内存持有当前数据（`items`/`reports`/`ledgers` 等私有数组）。
- 提供 `subscribe(listener)` 供组件订阅数据变化，内部变更后调用 `notifyListeners()` 触发订阅者重渲染。
- 所有写操作（增/删/改）在修改内存后，调用 `SyncHelper` 把最新全量数据标记为"待保存"。

### 3.2 SyncHelper 统一同步机制（[syncHelper.ts](src/services/syncHelper.ts)）

- **`memoryFetcher` 注册**：三个服务在启动时各自注册一个"取当前内存快照"的回调，`SyncHelper` 在需要保存时统一调用这些回调拼装出完整的 `BackendData` 对象。
- **去抖动保存**：任意一个服务发生写操作都会触发一次 200ms 去抖的 `POST /api/storage/save`，避免高频操作（如逐格编辑表格）产生海量请求。
- **`isInitialized` 启动锁**：应用冷启动时（[useAppData.ts](src/hooks/useAppData.ts) 内的 `Promise.all([initStore, initLedgerStore, loadFromServer])`）会先从服务器拉取数据填充内存，在这之前所有写操作触发的保存都会被启动锁拦截，防止用空状态覆盖服务器上已有的数据。
- **`runWhenInitialized` 一次性回调队列**：供类似"加载后自动清洗脏数据并回写"的场景使用（如原料字典去重后的自愈回写），避免在启动锁解锁前发起会被拦截丢弃的保存请求。

### 3.3 前后端交互链路

```
组件写操作 → Service 内存变更 → notifyListeners() 触发订阅组件重渲染
                              ↘ SyncHelper 200ms 去抖 → POST /api/storage/save → StorageService 持久化
应用冷启动 → useAppData → GET /api/storage/load → StorageService 读取并拼装 → 三个 Service 各自初始化内存 → isInitialized 解锁
```

## 四、持久化设计（[storageService.ts](server/storageService.ts)）

### 4.1 双模式后端

`StorageService` 支持两种存储后端，由 `.env` 的 `STORAGE_TYPE` 切换：
- **`local`**（当前项目实际使用的模式）：读写本地 JSON 文件。
- **`cos`**：读写腾讯云 COS 对象存储的等价 JSON 对象。

> ⚠️ 本轮重构仅将 `StorageService` 原样搬移到 `server/storageService.ts`，未改动其内部读写逻辑，也**未对 COS 模式做云端联调测试**（本地 `.env` 配置的是 `STORAGE_TYPE=local`）。如后续启用 COS 模式，建议先做一次独立的端到端验证。

### 4.2 主文件 + 逐日流水拆分

- `data/db.json`：主数据文件，保存人群/大类配置、原料字典、原料名录（**不含**逐日出入库流水明细）。
- `data/ledgers/daily/YYYY/MM/DD.json`：每个原料每一天的出入库流水明细被单独拆分存储到按年/月分目录的日文件中。

拆分原因：台账流水会随使用时间持续增长，若全部塞进单一 `db.json`，文件会越来越大，导致写入变慢甚至写坏；拆分为按天独立文件后，即使某次写入异常也只影响当天一个小文件，故障半径大幅缩小。

保存时（`writeDailyRecordsLocal`）从原料的 `dailyRecords` 字段中提取当日流水写入对应日文件，内存/主库中不重复保存；加载时（`readAllDailyRecordsLocal`）递归扫描 `data/ledgers/daily/` 下所有年月子目录，将流水重新拼装回原料的 `dailyRecords` 字段返回给前端——**前端数据结构完全不感知这一拆分，无需改动任何前端逻辑**。

### 4.3 备份策略

- 每次保存前会先在 `data/backups/` 下生成一份带时间戳的快照。
- 自动保留最近 **30** 份备份，超出部分按时间顺序自动裁剪删除。
- 管理后台曾提供的"一键导出/导入 JSON 备份"、"恢复出厂种子"等人工数据维护能力，已在 [V5.32.0](readme_zh.md) 中随"数据维护核销"Tab 整体下线；该自动快照备份机制本身未受影响，仍在正常运作。

## 五、后端路由一览

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/storage/load` | GET | 加载全量数据（含逐日流水的透明拼装） |
| `/api/storage/save` | POST | 保存全量数据（含逐日流水的透明拆分写入） |
| `/api/storage/backups` | GET | 列出可用备份快照 |
| `/api/storage/restore` | POST | 从指定备份快照恢复 |
| `/api/log` | POST | 客户端错误/性能日志上报 |
| `/api/health` | GET | 健康检查 |

## 六、本次重构范围边界说明

**做了什么：**
- 前端文件按业务域重新分组到 `services/`、`types/`、`constants/`、`hooks/`、`components/{admin,ledger,inventory,shared}` 子目录。
- 从 `App.tsx`、`LedgerSystem.tsx`、`TableGrid.tsx` 中抽取了 6 个自定义 Hook 及 2 个共享组件（`HelperSelect`、`SensorySelector`）、2 个 TableGrid 视图子组件。
- `server.ts`（原 627 行）拆分为 `server/storageService.ts`、`server/logService.ts`、`server/routes/{storage,misc}.ts` 四个文件，入口文件瘦身至 97 行。
- 为全部 45 个源码文件补充了顶部 `@description` 说明注释。

**明确没有做的事：**
- **没有改动任何业务逻辑、渲染结果、CSS 样式、导出组件名、prop 名或公共函数签名** —— 所有 Hook/组件/后端模块的抽取都是纯代码搬家，通过 `tsc --noEmit`（报错数量前后一致）与 `vite build`（产物 chunk 结构一致）加浏览器手动回归验证确认无行为变化。
- **没有改动 `StorageService` 的实际读写/备份/COS 算法逻辑**，只挪动了文件位置。
- **没有新增自动化测试套件** —— 项目目前仍然只能依赖 `tsc --noEmit` / `vite build` / 手动浏览器验证，这是已知缺口，建议后续单独立项补充。
- **没有对 COS 云存储模式做实际联调**，仅确认代码搬移后类型检查通过。
- **未合并到 `main` 分支** —— 本轮所有改动固定在 `dev` 分支上，`main` 分支保留其独立的历史提交，未被触碰。
