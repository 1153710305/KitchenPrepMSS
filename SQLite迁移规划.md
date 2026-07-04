# SQLite 迁移规划

> 本文档记录于 2026-07-04 的一次架构咨询与代码库现状梳理，供后续逐步改造时参考。
> 当前结论：数据规模尚小（`db.json` 约 1.37MB，32 项原料、3 个台账），**不需要立即迁移**，
> 但已经先落地了原子写入 + 写入锁（见 `server/storageService.ts` 的 `atomicWriteFileSync`/`withWriteLock`，
> commit `e6d2a54`），本清单是"下一步真正迁移到 SQLite"时的完整范围地图。
>
> **2026-07-05 更新：阶段一（浅迁移）已经完成实施**，详见文末"阶段一实施记录"一节。
> **2026-07-05 更新：阶段二（数据库 schema 规范化）已经完成实施**，详见文末"阶段二实施记录"一节；经用户明确确认，阶段二范围仅限 schema 规范化，前端整体防抖同步协议保持不变。以下原始规划内容保留作为历史决策依据。

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

---

## 阶段一实施记录（2026-07-05，已完成）

### 驱动选型：确认使用 `better-sqlite3`

与用户确认三个选项（`node:sqlite`/`better-sqlite3`/`sql.js`）的真实取舍后，**选定 `better-sqlite3`**（成熟稳定的 API，优先于 `node:sqlite` 的实验性状态）。

实施过程中发现了一个比原规划设想更严格的约束，值得记录：**`better-sqlite3` 的预编译二进制是按 Node.js 的 `NODE_MODULE_VERSION`（随 Node 大版本变化）严格绑定的**，不是"随便一个较新的 Node 就能跑"——用 Node 22 编译安装的二进制放到 Node 23 下运行会直接报 `ERR_DLOPEN_FAILED`（而不是警告或降级）。这比"只需要同操作系统/架构"的原始设想更严格，因此：
- `package.json` 新增 `"engines": { "node": "22.x" }`，把 Node 大版本明确锁定为 22.x。
- 准备部署包的电脑与客户目标电脑**必须使用完全相同的 Node 大版本**，`部署指南.md` 已同步补充这一硬性要求与对应的故障排查条目。

### 实施内容

1. **Schema 设计**：`kv_store`（key-value 整体存放 `reports`/`activeGroups`/`activeCategories`/`ledgers`/`ledgerItems`骨架/`rawMaterialsDict`/`ledgerHelperDict` 共 7 个字段的 JSON 文本）+ `daily_records`（`item_id`/`date`/`data` 三列，替代旧版按年/月/日拆分的 JSON 文件，天然支持索引查询）。
2. **正常保存路径**：`importFullDataIntoSqlite()` 把骨架字段覆盖写入 + `daily_records` 整体清空重建，全部包在一个 SQLite 事务里——真正的"要么全部生效、要么全部回滚"，比此前手搓的"临时文件+rename"更强的原子性保证。顺带修复了旧版实现里的一个历史遗留 bug：某天最后一条记录被删除后，对应的日文件永远不会被清理，下次加载时会被错误"复活"；新版每次整体重建，不存在孤儿数据。
3. **备份/恢复**：备份快照**仍然是纯 JSON 文件**（命名、目录、30 份保留策略完全不变），恢复时把快照内容重新导入 SQLite 的骨架字段、但绝不清空当前生效中的 `daily_records`（与旧版"restore() 从不触碰逐日流水文件"的既有限制保持一致，避免比旧版更严重的数据丢失回归）。
4. **一次性历史迁移**：`migrateLegacyJsonIfNeeded()` 在 `init()` 里判断——若 SQLite 完全没有数据但存在旧版 `data/db.json`，自动读取旧文件（含逐日流水）导入 SQLite；迁移后原始 JSON 文件**不会被删除**，作为人工回退手段永久保留；仅在 SQLite 为空时触发一次，不会重复迁移覆盖新数据。已针对真实生产数据（`data/db.json`，32 项原料、3 个台账、43 条逐日流水记录）做过完整迁移验证，逐字段核对无误。
5. **顺带修复的一处类型债**：`server/routes/storage.ts` 里原本用 `(StorageService as any).localDbPath` 越权访问私有字段来判断"是否首次启动"，这个假设在新架构下不再成立（迁移后 `db.json` 会永久保留，但显然不再是"首次启动"）。改为直接判断 `load()` 返回值是否为空对象，同时也修掉了这处越权访问导致的一个真实 tsc 报错（基线报错数从 19 降到 18）。

### 验证结果

- `server/storageService.test.ts` 全面重写为 SQLite 版本（27 个用例），新增真实 SQL 事务回滚验证（构造 `NOT NULL` 约束冲突触发中途失败，确认事务完整回滚不留部分写入）、一次性迁移的 3 个场景（首次迁移成功、SQLite 已有数据时不重复迁移、原始文件保留不被删除）。
- `server/routes/storage.test.ts` 同步适配（不再直接读 `db.json` 校验持久化结果，改为通过 `/load` 接口校验）。
- 全量测试 385 个用例通过，`tsc --noEmit` 报错数 18（较改造前的 19 有所下降，见上方第 5 点），`vite build` 与 `esbuild server.ts` 打包均成功。
- 浏览器实机验证：对真实生产数据完整跑过一次迁移，前端正确渲染迁移后的台账明细（含跨月多日流水），并通过真实 UI 操作触发一次保存，确认写入路径同样工作正常，控制台无报错。
- 额外验证了打包产物 `dist/server.cjs`（而不仅是开发态 `tsx server.ts`）同样能正确加载 SQLite 并对外提供服务。

---

## 阶段二实施记录（2026-07-05，已完成）——数据库 schema 规范化

用户要求"继续完成任务，直到实现完全迁移"。鉴于规划文档原先把"阶段二·深度重构"混在一起描述了两件风险/工作量差异很大的事情——
① 真正按实体建立关系型表（取代 kv_store 整块 JSON）；② 把前端"防抖 200ms 后整体 POST 全量应用状态"的同步模式换成按字段
增量写入——事先与用户确认了范围：**只做 ① schema 规范化，② 前端同步协议保持完全不变**。这把改造风险和工作量都收敛在
`server/storageService.ts` 一个文件里，不需要触碰四个业务服务、`SyncHelper`、任何前端调用方。

### Schema 设计

新增 9 张真正的关系型表，取代阶段一 `kv_store` 的"7 个字段整块塞 JSON 文本"：

| 表 | 对应字段 | 说明 |
|---|---|---|
| `ledgers` | `ledgers` | id/name/created_at |
| `ledger_items` | `ledgerItems`（骨架，不含每日流水） | 按 `ledger_id` 建索引 |
| `ledger_item_daily_records` | `ledgerItems[].dailyRecords` | 20 个字段全部展开为具名列（而非整块 JSON），按 `date` 建索引；与阶段一同名表结构不同，改用新表名避免冲突 |
| `reports` | `reports` | 复合主键 (target_group, year, month) |
| `prepared_items` | `reports[].items` | 按报表复合外键建索引 |
| `prepared_item_daily_data` | `PreparedItem.dailyData` | |
| `active_groups` / `active_categories` | `activeGroups` / `activeCategories` | |
| `raw_materials_dict` | `rawMaterialsDict` | |
| `ledger_helper_options` | `ledgerHelperDict` 的 8 个 `string[]` 字段 | 打平为 (category, value, sort_order) 三元组，`sort_order` 保留管理员维护的原始顺序 |

`load()`/`save()`/`getBackups()`/`restore()` 对外的输入输出 JSON 形状与规范化之前完全一致（一处已知、可接受的简化：可选字段统一以 `null` 表示"未设置"，不再刻意还原成"字段整体缺失"，详见测试文件里的 `KNOWN EDGE CASE` 用例）。

### 关键实现要点

1. **正常保存**：`importFullDataIntoSqlite()` 把 9 张表的重建全部包在同一个 SQLite 事务里——`upsertSkeleton()` 覆盖除每日流水外的全部骨架表，随后整体清空重建 `ledger_item_daily_records`。真实测试用一条会触发 `NOT NULL` 约束冲突的畸形 payload（原料项缺少必填的 `ledgerId`）验证了跨越 9 张表的事务同样能整体回滚，不留任何部分写入。
2. **备份恢复**：沿用阶段一确立的原则——`upsertSkeleton()` 被 `importSkeletonOnlyIntoSqlite()`（恢复专用）与 `importFullDataIntoSqlite()`（正常保存专用）共用，恢复时绝不触碰 `ledger_item_daily_records`，因为备份快照从不包含台账每日流水（这个限制从最早的纯 JSON 版本就存在）。
3. **双重历史迁移路径**：`migrateToNormalizedSchemaIfNeeded()` 按优先级依次尝试——① 阶段一遗留的 `kv_store`（若存在则说明是从阶段一升级）；② 更早版本的纯 JSON `db.json`（若存在则说明是从更早版本直接升级到阶段二）。两条路径都复用同一个 `importFullDataIntoSqlite()` 落地，阶段一的 `kv_store`/`daily_records` 两张表不会被删除，只是不再读写。
4. **顺带简化**：`load()`/`save()`/`restore()` 内部不再需要任何 JSON 序列化/反序列化整块字段的逻辑（阶段一时 `kv_store` 的 value 列本身就是 JSON 文本），现在完全是字段级别的 SQL 读写，为将来如果真的需要"按字段增量写入""按实体建索引查询"打下了基础（但本次不做，按用户确认的范围）。

### 验证结果

- `server/storageService.test.ts` 全面重写（31 个用例），新增：reports/preparedItems/dailyData 完整往返、activeGroups/activeCategories/rawMaterialsDict/ledgerHelperDict（含顺序保留）完整往返、跨 9 张表的事务回滚验证、"从阶段一 kv_store 升级"与"从最早纯 JSON 版本升级"两条迁移路径的独立回归测试、以及一处已知边界行为差异的显式记录测试（恢复一份内容完全为空的备份，在规范化表结构下与"从未保存过任何数据"无法区分，返回 `{}` 而非"全字段皆空数组"——这只影响一个几乎不会在真实场景发生的极端情形）。
- `server/routes/storage.test.ts` 同步修正测试夹具（补全 `Ledger.createdAt`/`LedgerItem.ledgerId`/`unit` 等真实类型要求的必填字段，之前的用例夹具本身就不完整，只是阶段一 blob 存储没有字段级约束、掩盖了这个问题）。
- 全量测试 389 个用例通过，`tsc --noEmit` 报错数保持 18（与阶段一结束时一致），`vite build` 与 `esbuild server.ts` 打包均成功。
- 迁移验证：先在一份**真实生产数据的完整拷贝**上验证"从阶段一 kv_store 迁移到规范化表"的正确性（3 个台账、32 项原料、43 条每日流水、5 份报表、353 个备餐细项、10943 条备餐每日数据、77 项原料字典、53 条人员/供货商候选项，逐项核对无误），确认无误后再对**真实生产数据本身**执行同样的迁移并做浏览器端到端验证（含真实 UI 触发的一次保存），生产打包产物 `dist/server.cjs` 同样验证通过。
