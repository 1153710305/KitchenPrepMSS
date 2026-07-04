# SQLite 迁移规划

> 本文档记录于 2026-07-04 的一次架构咨询与代码库现状梳理，供后续逐步改造时参考。
> 当前结论：数据规模尚小（`db.json` 约 1.37MB，32 项原料、3 个台账），**不需要立即迁移**，
> 但已经先落地了原子写入 + 写入锁（见 `server/storageService.ts` 的 `atomicWriteFileSync`/`withWriteLock`，
> commit `e6d2a54`），本清单是"下一步真正迁移到 SQLite"时的完整范围地图。

## 背景

用户提出的原始问题：JSON 存储是否足够安全高效？是否需要改数据库？改数据库对单机离线部署有何影响？

现状梳理结论（详见 `readme_zh.md` [V5.82.0] 之前的咨询记录）：
- JSON 文件读写性能在当前规模下完全不是瓶颈，真正的风险是写入安全性（已修复：原子写入+写入锁）。
- 若数据量持续增长，安全性/健壮性/稳定性/易用性四个维度都会随时间恶化（写入窗口变长、并发冲突概率上升、
  `load()` 每次全量遍历日度文件目录变慢、手写 `.filter()`/`.find()` 查询维护成本上升）。
- 建议：不必现在做数据库改造，但应作为"下一个真正的加固点"提前规划，本文档即为该规划。

## 0. 第一个决策：浅迁移 vs 深度关系型重构

这个决定决定了后面所有范围，必须最先做。

- **阶段一·浅迁移（推荐先做）**：SQLite 只替换"存储引擎"本身。`StorageService.load()`/`save()`/
  `getBackups()`/`restore()` 保持现有的方法签名与"整体状态进、整体状态出"契约不变，内部实现从读写
  `fs` 换成读写 SQLite。四个业务服务（`LedgerService`/`PrepReportService`/`RawMaterialsDictService`/
  `SyncHelper`）完全不用动——它们从来不直接调用 `StorageService`，全部经由 `SyncHelper` 的防抖整体
  blob 推送完成持久化。改造范围几乎完全收敛在一个文件里。
- **阶段二·深度重构（未来，独立立项）**：真正的按实体分表、建索引、按变更增量写入，取代"防抖 200ms →
  整体 POST 全量应用状态"的现有模式。这会牵涉到四个服务约 24/15/29/10 个引用点文件，需要单独立项评估，
  **不要**并入本次迁移。

以下清单默认针对**阶段一**。

## 1. 需要映射到表/字段的数据模型

当前持久化的 7 个顶层 key（权威来源：`src/hooks/useAppData.ts:91-102` 注册的 `memoryFetcher`）：

| Key | 类型 | 定义位置 | 备注 |
|---|---|---|---|
| `reports` | `GroupMonthlyReport[]` | `src/types/types.ts:77-86` | 内嵌 `PreparedItem[]` → `DailyEntry` |
| `activeGroups` | `DynamicGroup[]` | `src/types/types.ts:110-119` | |
| `activeCategories` | `DynamicCategory[]` | `src/types/types.ts:124-131` | |
| `ledgers` | `Ledger[]` | `src/types/ledgerTypes.ts:13-20` | |
| `ledgerItems` | `LedgerItem[]` | `src/types/ledgerTypes.ts:77-94` | `dailyRecords` 已在磁盘上按日拆分存储 |
| `rawMaterialsDict` | `RawMaterialDictItem[]` | `src/services/rawMaterialDict.ts:19-34` | **类型债**：未收纳进 `src/types/` |
| `ledgerHelperDict` | 内联字面量，**无命名接口** | `src/services/ledgerStore.ts:40-53` | 全部为 `string[]` 字段 |

顺带记录一个已发现但尚未修的类型债：`SyncHelper.BackendData`（`syncHelper.ts:14-35`）已经过时——
只声明了 7 个 key 中的 5 个，且类型宽松地写成 `any[]`，`rawMaterialsDict`/`ledgerHelperDict` 是通过
`as any` 强行拼接进去的。趁这次改造顺手把这个类型定义修正掉。

## 2. 驱动选型——唯一真正影响部署的子决策

项目目前**零原生模块依赖**（已核实：`cos-nodejs-sdk-v5`/`dotenv`/`express`/`lucide-react`/
`pinyin-pro`/`react`/`react-dom`，均为纯 JS，无 `binding.gyp`），且部署方式是把整个项目文件夹
（含 `node_modules/`）复制到离线目标机器运行。这让驱动选型比一般项目更值得谨慎：

- **`better-sqlite3`**：同步 API（与本项目现有的同步 `fs` 写法很接近）、成熟、快。但它是**原生二进制
  模块**，会是本项目第一个——开发机上编译出的二进制必须匹配目标机器的操作系统/架构，否则运行时静默
  加载失败。需要改变打包流程（在与目标机器同操作系统/架构的机器上构建部署包，再整体拷贝 `node_modules`
  离线传输），并需要在 `部署指南.md` 里补充这一步骤。
- **`sql.js`**（WASM 编译版）：零原生二进制，完全可移植，无打包风险。代价是它是一份需要自己手动落盘
  的内存态表示——这其实和 `StorageService` 现在的心智模型非常接近，某种意义上是阶段一改造摩擦最小的选择。
- **`node:sqlite`**（Node 22+ 内置）：零外部依赖。需要把当前部署文档里"Node 18+ LTS"的要求上调到 22+——
  这是一处很小的部署文档改动，而非打包流程改动。

倾向：`sql.js` 或 `node:sqlite` 优先于 `better-sqlite3`，**正是因为**这套离线部署一旦在客户现场遇到
原生二进制架构不匹配的问题，没有联网环境可以补救。写代码前先把这个选型定下来。

## 3. 服务端改动范围

- `server/storageService.ts`：重写 `load()`/`save()`/`getBackups()`/`restore()` 内部实现，对外方法签名保持不变。
- `server/routes/storage.ts`：若上面的接口契约保持不变，**理论上零改动**——它只是薄薄地转发调用
  （已核实：仅 4 个 endpoint，全部直接转发给 `StorageService` 对应方法）。
- **一次性数据迁移**：现有客户安装已经有真实的 `data/db.json` + `data/ledgers/daily/**`。需要一个
  启动时的引导路径——服务启动时如果目标 `.db` 文件不存在但 `db.json` 存在，就执行一次性导入。
  导入完成后**不要删除**原始 JSON 文件，至少保留前几个版本作为人工回退手段。
- **备份/恢复的等价实现**：SQLite 本身也是单文件，最简单的路径是定期整份拷贝 `.db` 文件（沿用现有
  30 份快照的保留策略），或用 `VACUUM INTO` 做不加锁的一致性拷贝。这会取代现有 `save()` 里的 JSON
  快照逻辑。

## 4. 测试改动范围

- `server/storageService.test.ts`（当前 23 个用例）需要直接改造——把"每个用例一个临时目录 + 动态
  重新 import 模块"的隔离方式，换成等价的"每个用例一个 `:memory:` 或临时 `.db` 文件"（隔离**原则**
  不变，只换隔离机制）。
- `server/routes/storage.test.ts`——若接口契约不变，应该**零改动**。
- 其余约 24-28 个引用 `ledgerStore`/`store`/`rawMaterialDict`/`syncHelper` 的测试文件——已核实它们
  都不直接调用 `StorageService`，浅迁移方案下理应也**零改动**。这是优先做阶段一的最有力的实践理由：
  改动半径确实能收敛在一个文件加它自己的测试文件里。

## 5. 部署文档改动

- 按最终选定的驱动，在 `部署指南.md` 里补充对应内容（`better-sqlite3` 的跨架构打包说明，或
  `node:sqlite` 的 Node 版本上调说明，`sql.js` 则无需任何补充）。
- 补充"升级后首次启动会自动执行一次性数据迁移"的说明。

## 6. 验收清单

- 全量测试套件保持全绿，`tsc --noEmit` 基线报错数不变，`vite build` 与 `esbuild server.ts` 打包均成功
  （与本次会话历次改动坚持的验证标准一致）。
- 针对真实 `data/db.json` **的一份拷贝**做一次迁移试跑，自动化断言迁移前后 `load()` 输出逐字节等价。
- 浏览器手动冒烟测试：新增原料、编辑当日记录、打印登记表、重启服务器，确认数据完整存活。

## 关键涉及文件（迁移时的起点）

- `server/storageService.ts`、`server/storageService.test.ts`
- `server/routes/storage.ts`、`server/routes/storage.test.ts`
- `src/hooks/useAppData.ts`（持久化编排入口，`memoryFetcher` 注册处）
- `src/services/syncHelper.ts`（`BackendData` 类型债）
- `src/types/types.ts`、`src/types/ledgerTypes.ts`、`src/services/rawMaterialDict.ts`（类型债）
- `package.json`、`vite.config.ts`（驱动依赖引入后的构建配置）
- `部署指南.md`、`start-windows.bat`、`start-mac-linux.sh`
