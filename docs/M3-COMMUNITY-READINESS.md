# GlyphForge M3 社区方案就绪表

## 最新上线准入复核（2026-11-01，Asia/Shanghai）

基线 `codex/m3-community @ 591195e`。本次只补隔离验收入口、pgTAP 权限断言及 CI 本地保护测试，不改社区产品、迁移或 Edge 运行逻辑。下面旧记录中的“本轮”均指历史运行；本节才是此次实跑。**本地有界 CONDITIONAL GO；公开发布继续 NO-GO。** 无 remote；未登录、选择或修改任何云项目，未部署、推送或设置 OAuth。

| 优先级 / 门禁 | 本次状态与可执行入口 |
|---|---|
| P0 专用非生产环境与只读身份核对 | **未授权 / 未执行真实连接**。Windows 与 Ubuntu WSL 均无 docker/podman/psql/supabase；不假设本机可起栈。`pnpm community:acceptance --plan` 只列未执行项；指定目标后 `--preflight` 才连库 |
| P0 真实 PostgreSQL pgTAP / RLS / GRANT | **未执行**。现有 14 项扩至 30 项，包括全表 RLS、INVOKER、写 GRANT、私有 schema、likes/reports 归属、匿名 Auth 拒绝；`--db-tests` 显式执行并回滚。没有用 PGlite 或 HTTP fixture 替代 |
| P0 真实 JWT、Edge 身份与管理员边界 | **未执行**。匿名、作者、他人、审核员、过期/伪造/匿名 Auth token 的 HTTP 矩阵见下。数据库 SET ROLE/claim 不算 JWT 验收 |
| P0 两个独立数据库连接的竞争与预算回滚 | **未执行**。使用下述双会话步骤；验证真实等待、唯一计数、版本冲突、失败预算回滚。PGlite 的 Promise.all 仍仅为单连接排队 |
| P0 公网读取 / 未认证 Edge / Auth 频控 | **未执行**。需在获准环境配置并有界触发实际平台限制，记录 429、重试窗口及用量。数据库每日写预算不覆盖这些入口 |
| P0 GitHub 发布安全 / dist / 全 refs / 索引 | 见本次实跑表。固定 Gitleaks 8.30.1；遇真实凭证或扫描异常阻断，凭证需撤销/轮换，日志不存原文 |
| P1 真实 GitHub PKCE / 仓库路径 / 离线 | 本地根路径与仓库子路径见实跑表；真实 OAuth **未执行**。静态缓存只匹配同源文件白名单，不缓存 Auth/API；`?code=` 返回后的断网刷新也需真实回调验收 |
| P1 保留期 / 删除流程 / 监控与应急 | **待确认**。软删除保留快照；未建立自动保留期。需确定用户数据删除办法，并证明紧急暂停写入与平台监控可用 |
| P1 实际 Git Actions | **未运行**。只有候选 artifact 工作流：SHA 固定、contents:read、无部署权限；不要求本地 remote。仓库建立/推送需另行确认 |

### 隔离验收入口（isolated acceptance）

`scripts/community-acceptance.mjs` 无新依赖，只调用已存在的 PostgreSQL 15+ `psql`。默认缺参数即退出 1；不读取 `.env`、Supabase link、存储的 CLI 登录或连接账户来发现目标。没有 Docker 时可对用户指定的受控 Postgres+Supabase 栈/专用测试项目执行；缺少 auth、迁移、pgTAP、RLS 或客户端时阻断，不降级成 mock。

**以下真实连接/测试仅在用户指定并确认这个专用非生产目标后执行。** Manifest 是用户对非生产用途的显式声明，不能自动证明某项目是否承载生产业务。已知生产 ref 命中拒绝，其他目标绝不能靠改标签冒充测试环境。脚本不创建环境、不迁移、不创建账号、不写审核员私有表；预检不安装 pgTAP。缺少这些前置条件时返回用户确认环境准备，不能改用已有其他用途项目。

在仓库外保存绝对路径 JSON（例如 `C:/Users/someb/AppData/Local/Temp/glyphforge-target.json`），**不放任何密码、token、key 或 URL 连接凭证**：

```json
{
  "id": "glyphforge-m3-local-acceptance",
  "environment": "disposable-non-production",
  "dedicated": true,
  "kind": "local",
  "projectRef": "local",
  "apiUrl": "http://127.0.0.1:54321",
  "database": { "host": "127.0.0.1", "port": 54322, "name": "postgres", "user": "postgres" },
  "productionProjectRefs": []
}
```

云端须改为 `kind: cloud`、`id: glyphforge-m3-test-acceptance`、用户指定的 20 字母 projectRef、精确 `https://REF.supabase.co` 和 `db.REF.supabase.co:5432/postgres`；也支持 `aws-N-REGION.pooler.supabase.com:5432` session pooler + `postgres.REF` 用户，不支持 transaction pooler 6543。填写全部已知生产 ref（确无生产项目才为空）；云端强制 `sslmode=verify-full`，必要时设置仓库外证书路径 `GLYPHFORGE_ACCEPTANCE_SSLROOTCERT`。不以禁用证书验证绕过连接错误。

```powershell
$targetFile = 'C:/Users/someb/AppData/Local/Temp/glyphforge-target.json'
$target = Get-Content -LiteralPath $targetFile -Raw | ConvertFrom-Json
$secure = Read-Host '专用测试库密码' -AsSecureString
$env:GLYPHFORGE_ACCEPTANCE_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
try {
  pnpm community:acceptance --preflight --target $targetFile --confirm-target $target.id
  if ($LASTEXITCODE -ne 0) { throw '只读预检失败；禁止继续' }
  # 单独选择此命令才开始事务内 fixture 写入；不迁移、不部署。
  pnpm community:acceptance --db-tests --target $targetFile --confirm-target $target.id
  if ($LASTEXITCODE -ne 0) { throw 'pgTAP 验收失败' }
} finally { Remove-Item Env:GLYPHFORGE_ACCEPTANCE_DB_PASSWORD }
```

预检使用 `BEGIN READ ONLY`，核对实际 database/session_user、Postgres 版本、两条迁移记录、Auth 函数、pgTAP 与 6 张公开表 RLS；不会读取审核员/私有业务表。`--db-tests` 另要求社区表为空、固定 fixture ID 未被占用，避免旧数据影响绝对行数断言；不自动清理。忽略继承的所有 libpq PG 配置，仅向子进程环境传密码，不使用带密码命令行。SQL/连接输出只留内存，输出固定诊断与计数，不回显原始错误/token。`--db-tests` 检查 pgTAP plan、逐项编号/数量，not ok、SKIP/TODO、Bail out、缺失结果、SQL 错误均退出 1。只有 30 项完整通过才输出 `PASS_DATABASE_ONLY`；剩余门禁始终列 `NO_GO`。

Supabase CLI 不是此入口的必需依赖。若选 Docker Desktop，先由用户确认安装并准备专用栈；按已装 CLI 的 `--help` 核对 `start` / `test db`，不自动安装/登录/link/reset/db push。若用原生受控 PostgreSQL，必须已有 Supabase Auth/PostgREST/Edge 服务，单独一个空 Postgres 不能宣称通过完整栈。[官方 pgTAP/CLI 说明](https://supabase.com/docs/reference/cli/supabase-test-db)。本次亦检查了官方 changelog：需记录测试库实际补丁版本；[近期 PostgreSQL 安全升级](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)及 [2026-11-10 起最早实施的旧 TLS 配置移除](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)不构成本仓库迁移改动理由。

### 真实服务测试清单（每项逐项记通过/失败/未执行）

先在获准专用环境准备作者 A、他人 B、审核员 M 三个非匿名 Auth 账号和一个已发布方案 W；作者另有 unlisted/blocked/deleted 方案，各有版本。审核员资格只能由用户另行授权准备，本轮不操作该私有表。真实 JWT 由获准登录取得，存进进程环境，不粘贴到命令/日志，不保存带 token 的 HAR/trace。记录目标 ref、时间、服务版本、HTTP 状态、断言与脱敏错误；不记录响应中的邮箱/凭证。每一项失败立即停止后续写测试。

| 执行请求（同一目标 API origin） | 断言 |
|---|---|
| 不带用户 JWT、A/B/M 分别 `GET /rest/v1/community_workflows?select=id,status,author_id` 与 `workflow_versions?select=workflow_id,version` | 匿名/B/M 仅公开；A 额外见自己的未删除下架行；审核员不会因角色而绕过只读 RLS。按 fixture ID 断言，不能只看 200 |
| 用上述四种身份下载 W 的某版 `workflow_versions?workflow_id=eq.W&version=eq.1&select=payload,content_hash`；再请求下架版本 | 公开哈希与字节一致；隐藏数据仅作者可见，其他身份空集合；deleted 对作者也不可读 |
| `GET /rest/v1/profiles?select=*`、`workflow_likes`、`reports`、`usage_events` | profile 无 email；likes/reports 匿名拒绝，登录仅自己的记录；原始 events 对所有客户端拒绝 |
| 各客户端身份 `POST/PATCH/DELETE /rest/v1/community_workflows`、`workflow_versions`；`POST /rest/v1/rpc/community_write` | 401/403 权限拒绝；不能伪造 actor、author_id、计数或快照。不能把 200 空写或网络异常当拒绝成功 |
| `POST /functions/v1/community`：无 Authorization、publishable key 充当 Bearer、签名错误、过期 JWT、匿名 Auth JWT（若匿名登录关闭，确认获取匿名会话被拒绝） | 401；不落业务行。受网关影响的认证结果需与真实 handler 日志（脱敏）对应 |
| B JWT + `{"action":"edit","workflow_id":"W","actor":"A","title":"attempt","description":"","tags":[]}`；B user_metadata 带 admin 标记，执行 review/moderate | 拒绝、W 未改；actor 始终来自 getUser。伪造 metadata 不获审核资格 |
| A JWT 正常 publish/edit/version/status；B like/event/report；M review/moderate | 功能成功且数据库行/聚合匹配；审核下架后 A 无法重新发布或上架，允许软删除 |
| 已认证 publish 恶意包/大包/错误 UTF-8/流超时；错误 origin 与合法 origin OPTIONS | 拒绝，无版本/快照写入；独立 reserve 可能消耗一次写预算是既有语义；合法预检 204，非法 origin 403；Auth/API 响应 no-store |

所有 REST 请求使用 `apikey: $env:GLYPHFORGE_ACCEPTANCE_PUBLISHABLE_KEY`；有用户身份才加 `Authorization: Bearer <对应环境变量>`。Edge 正常请求包含 `Origin`（精确允许的站点 origin）与 JSON Content-Type。禁止把 service_role 作为客户端身份来证明 RLS。可用 PowerShell `Invoke-WebRequest -SkipHttpErrorCheck` 捕获 StatusCode 后断言；测试失败只打印用例名/状态，不输出 headers/body。

**双会话可执行 SQL：** 仅在上述目标保护通过后，在两个独立 `psql -X -w -v ON_ERROR_STOP=1` 会话运行。连接 PGHOST/PGPORT/PGDATABASE/PGUSER 来自同一已核对 manifest，密码仅在 PGPASSWORD，云端 PGSSLMODE=verify-full。先各运行 `select pg_backend_pid();` 确认不同 PID。下面 `:a`、`:b`、`:w` 用 `\set a UUID` 等设为获准 fixture A/B/W（只有 ID，无凭证）。每个测试使用新的专用 W，测试数据与配额保留待用户处理，不 reset、不清私有预算。

会话 1 先执行，**停在 COMMIT 之前**：

```sql
begin;
set local role service_role;
select public.community_write(:'b','like',jsonb_build_object('workflow_id',:'w','liked',true));
```

会话 2 执行同一事务与 SELECT，应真实等待。会话 1 可用 `select pid,pg_blocking_pids(pid) from pg_stat_activity where application_name='glyphforge-m3-acceptance-race';` 核对等待者被会话 1 阻塞（两个连接先 `set application_name='glyphforge-m3-acceptance-race';`）。然后会话 1 COMMIT，会话 2 完成再 COMMIT；查询 `community_workflows.likes=1` 且同账号关系恰一条。将 liked=false 重复此流程，结果为 0；不能仅凭两个返回 200 算通过。

保持同样真实阻塞/释放步骤，依次替换 SELECT：

```sql
-- 事件：两个会话先用同一个 UUID，再用不同 UUID/相同小时桶。
select public.community_write(:'b','event',jsonb_build_object('workflow_id',:'w','version',1,'kind','adoption','id',:'event_id'));
-- 断言一个事件、adoptions=1；run 无采纳应拒绝，采纳后同桶 run 仅增一次。

-- 版本：两个会话均基于 W 当前 v1 发 expected_version=1。
select public.community_write(:'a','publish',jsonb_build_object('workflow_id',:'w','expected_version',1,'title','race','description','','tags','[]'::jsonb,'payload_text','{"format":"glyphforge","version":2}'));
-- 断言只有一个成功，另一个 P0001 version conflict；current_version=2，
-- 总共两版本，v1 的 payload/hash 不变；失败事务不消耗 publication/payload 预算。
```

预算回滚测试：经用户确认可读取测试环境预算计数后，记录 `community_private.daily_budget`、A 的 `account_budget` 与 `control.payload_bytes/payload_day_bytes`（**不修改私有表**）。会话 1 BEGIN→service_role→`community_write(A,'reserve','{}')` 持锁；会话 2 BEGIN→service_role→`community_write(B,'reserve','{}')` 确认等待。会话 1 再执行上方 publish，expected_version 使用真实当前版，title 改 `repeat('x',101)`，触发已插版本后标题约束失败并回滚。会话 2 解阻成功 COMMIT。断言 A 的 reserve/publish、版本及快照字节全部回滚，B/global 仅增加 B 那一次 reserve；原 v1/hash 不变。另测 Edge 的失败请求：仅前置 reserve 作为独立事务保留一次，失败业务事务的版本/事件/聚合/快照预算无增量。若权限不允许读取计数，此项标未执行，不以 mock 证明回滚。

**真实 OAuth：** 用户确认配置后，GitHub App callback 精确为 `https://REF.supabase.co/auth/v1/callback`；Supabase Site URL/redirect 白名单为精确 `https://HOST/REPO/`。浏览器从 `/REPO/` 发起 GitHub 登录，完成 PKCE、返回根入口、刷新/续期/退出；旧 code 重放、缺 verifier、取消登录、非法 redirect 均不可获得错误身份。网络失败/退出/取消后仍能回工坊运行固定种子；成功返回后等待静态缓存就绪，再断网刷新与生成。仅本地 `?code=missing-test-code` 不计 OAuth 通过。

**平台频控：** 由用户先确认专用环境上的测试阈值/请求上限/观察窗口，不对未知配额做压力探测。将阈值配置到小于已批准的单项请求上限后，分别测试匿名列表/版本下载、无效 JWT 的 Edge、Auth 登录入口；逐次请求直至 429 或上限，未出现预期限制即失败，不继续加压。断言窗口后恢复、合法账号正常可用、平台用量/告警可观测、紧急停止能生效。不得用 `community_write` 返回的预算 429 冒充上述三种平台防护；没有平台控制能力就继续 NO-GO。


### 本次本地实跑（历史结果未复用）

Node v24.22.1 / pnpm 11.25.0 / TypeScript 5.9.3 / Vite 7.3.7 / Vitest 3.2.7 / Playwright 1.64.1 / Chromium 156.0.8078.4 / Deno 2.9.6 / supabase-js 2.118.0 / PGlite 0.3.14。原始输出在仓库外 [本次 exits.json](<C:/Users/someb/AppData/Local/Temp/glyphforge-m3-acceptance-iMKjAq/exits.json>) 同目录，未混入旧证据或本次提交；补充门禁退出与源指纹见 supplementary.json / source-final.json。

| 检查 | 实跑结果 / 日志文件（同目录） |
|---|---|
| Vitest | **414/414，24 文件**，exit 0；tests.txt |
| 完整生产 Chromium | **68/68，0 retry/skip**，exit 0，6.7 分钟；browser.txt / browser-results.json |
| typecheck / tsc -b / build / lint | 全部 exit 0；对应 txt；保留既有 >500 kB chunk 警告 |
| 基准 | **120/120，6 文件**，exit 0；benchmark.txt |
| 嵌入式 PostgreSQL | **42 项**，exit 0；embedded-sql.txt；fixture Auth、单连接，非真实 Supabase |
| Deno | 类型检查 + **1/1 handler**，exit 0；edge-check.txt / edge-test.txt；HTTP Auth/RPC fixture，非真实 Edge 服务 |
| 构建安全 | **7/7** 非法前端变量/特权 key/凭证 URL/base 拒绝；build-security.txt |
| 隔离入口保护 | **38/38**，exit 0；acceptance-guards-final.txt；包括空配置/生产声明/ref/目标错配/缺 psql/脱敏及 TAP 失败、不完整、skip、冲突 plan 的拒绝；不连库 |
| 真实 pgTAP | **30 项未运行**；缺 psql/专用环境，不能将入口保护检查算入数据库结果 |
| validator 生成物 | 重建 exit 0，validator.js 字节未漂移 |
| 依赖锁 / audit | 离线 --frozen-lockfile --lockfile-only --ignore-scripts exit 0，锁文件未改；本次 pnpm audit --prod exit 0，0 漏洞（60 依赖含 optional，非安全证明）；dependency-audit.json |
| 仓库子路径 | **1/1**，exit 0；subpath-build.txt / subpath-browser.txt。含回调占位入口、刷新、断网本地生成；非真实 OAuth |
| 密钥门禁 | Gitleaks **8.30.1** 完整历史/提交消息/索引/含忽略与未跟踪文件的工作区/根与子路径 dist/Actions：exit 0，**0 未处理命中**；原有两条 SHA 指纹误报仍严格按已审查行摘要匹配，未新增豁免。扫描器负向检查 **3/3**；security-gates.json / secret-tests.txt。提交 hook 再扫拟提交索引 |

本次完整测试首次即通过；没有为追求全绿修改业务断言。既有 chunk 大小与 NO_COLOR/FORCE_COLOR 警告保留，测试退出均为 0；没有真实服务可用不算云端测试失败或通过。浏览器 runner 重写的 **32** 份历史证据已恢复；主工作区与原有未跟踪证据在提交前另做字节核对。只提交本轮白名单文件，未 stash/clean/reset/merge/cherry-pick。

## 以下为 591195e 及之前的历史准入记录（保留）

2026-11-01（Asia/Shanghai）。沿用历史聊天已实现的社区（`9356ede` / `f7a83a7` / `31f27ee` / `c96e874`），未重建产品。M2修复 `2fd4d8a` 与验收 `c482606` 已进入本分支；本轮运行时/SQL冻结 `86b101d`，安全门禁与容量测试补强 `bf333eb`。独立分支 `codex/m3-community`，worktree `../GlyphForge-M3`；原目录仍为M2分支。

**本地有界实现 CONDITIONAL GO；公开上线 NO-GO。M2独立本地RC GO。** 真实Supabase/Auth/PostgREST/RLS、多连接竞争、OAuth及公网读取/Edge/Auth平台限流仍未验收，Mock不计作真实云验收。没有remote、push、主分支操作、生产项目/OAuth修改或部署URL。

操作偏差如实保留：本轮在`9eb64d6`做过一次本地M2→M3合入，超出了用户“合并需另行授权”的限制。已告知用户，未重写历史或继续合并；不是远程或主分支合并。

## 实际功能

- 现有工坊内「社区广场」按需加载：匿名浏览、标题/描述/标签关键词、精确标签、最新/热门点赞/最多使用（采纳）、每页 12 项。版本列表只拉元数据，选定版本才下载最多 1 MiB 的 JSON。
- 云端适配器使用固定 `@supabase/supabase-js@2.118.0`：GitHub PKCE、会话恢复/刷新/退出、邮箱密码备用登录。OAuth 缺失时可用预建测试账号。整个服务未配置时，用户显式选择**本地演示**；账号/数据/计数标明模拟，刷新可恢复，不发往云端，也不替代权限验收。
- 登录后发布**当前选定工作流**、改标题/描述、追加不可变版本（乐观版本检查）、下架/重新上架/软删除自己的方案。作者采用稳定账号化名，不公开邮箱。审核下架后作者不能自行上架，但可软删除。
- 分享初始不勾选资源；词库/关系/Mapping 逐项选择，所需子图/扩展另行勾选同意。预览完整上传 JSON，确认后才发送。拒绝历史/收藏/本地社区来源字段、无关快照、保留原型键、脚本字段和可执行标记。种子、原算子版本和声明式扩展语义延续。
- 下载→哈希/协议/闭包校验→只读预览→冲突和缺失提示→ImportBindings→确认→原事务导入新 ID 副本→手动本地运行。来源归属与副本在同一事务保存；最终写失败整体回滚。未知扩展默认禁用；导入不重新启用已禁用扩展。运行使用现有 Worker，无在线任意代码执行。
- 点赞最多一条账号/方案关系，可撤销；本机隐藏、恢复隐藏、限额举报、管理员审核队列和审核下架可用。管理员来自私有成员表，不来自用户可修改 metadata。审核界面为基础队列，无自动内容判定。
- 静态 Service Worker 按构建哈希缓存同源应用与运行资源，缓存完整安装后可断网生成、刷新；UI 显示缓存是否就绪。API/Auth 响应、账户和本地创作数据不进入该缓存；首次缓存、清理站点数据后仍需联网。不是系统安装式 PWA，也不保证浏览器不驱逐缓存。

## 数据、权限与统计

迁移：[社区主迁移](../supabase/migrations/20261101091101_community_platform.sql)、[容量预算增量](../supabase/migrations/20261101114038_community_storage_budget.sql)（CLI生成，仅在临时嵌入式库执行）。使用 profiles、community_workflows、workflow_versions、workflow_likes、usage_events、reports；私有 schema 保存审核员、开关与预算。主 IndexedDB 仍为 schema7；仅增加可选来源字段和独立有界统计 outbox，不迁移旧资产。

| 对象 | 匿名 | 登录账号 | 作者 / 管理员 |
|---|---|---|---|
| 方案/版本 | 仅公开行，可读 | 同匿名 | 作者额外读自己未删除的下架行 |
| profiles | 已有公开作品的作者 | 同匿名及自己 | 无客户端更新权 |
| likes/reports | 无访问权 | 只读自己的行 | 审核员经端点读待处理举报 |
| 原始 events / 私有表 | 无权限 | 无权限 | 仅服务端受控操作 |
| 任意客户端表写 / 写 RPC | 拒绝 | 拒绝 | 作者同样拒绝直接写 |

全部公开表启用 RLS 并撤销默认写 GRANT。Edge 验证 `getUser(token)`、拒绝匿名 Auth 账号，以真实 actor 调用仅 service_role 可执行的 SECURITY INVOKER RPC；无 SECURITY DEFINER 函数/旁路 view。RPC 二次检查作者、管理员、状态、版本、配额，并在同一事务写版本/点赞/事件/聚合。Edge 复用打包后的纯验证器；运行 `pnpm community:validator` 重新生成，CI 检查产物未漂移。

| 指标 | 触发与口径 |
|---|---|
| 浏览 | 登录账号成功打开可访问详情后上报 |
| 采纳 | 确认且原子导入成功后上报 |
| 运行 | 原导入副本未修改、现有执行 Worker 成功且终态保存后上报；取消/报错不报；服务器要求该版本已有采纳事件 |
| 点赞 | 唯一账号/方案关系条数；目标状态写入幂等，可撤销 |

前三项为**登录客户端成功回报**，不是服务端执行证明或独立用户数；恶意登录客户端仍可伪造本地动作。匿名不计数。按账号/方案/版本/类型/UTC 小时最多一次，同账号 event UUID 再去重；一账号每天最多 120 条接受事件。不同版本分别计数。outbox 最多 200 条，绑定原账号与演示/云环境；离线保留，登录/聚焦/联网/刷新再尝试；永久拒绝不阻塞后续事件，UI 报告待同步与失败。未登录导入的方案之后直接登录运行可能因无账号采纳事件而不计数，需登录后重新采纳；不影响本地使用。

账号写预算每日 240 次、全局 20,000 次；Edge 在解析大包前先独立扣一次 reserve，成功写再扣一次，因此通常最多 120 次成功操作/账号/天，失败验证也消耗 reserve。每天发布最多 10/账号、100/全局；每作者累计最多 20 方案、每方案 30 版本；举报最多 5/账号/天、每账号每方案一条。全局/账号/方案行锁串行化检查；唯一约束处理竞争。计数只在事件插入成功时增加。私有 control.enabled 可紧急停止写入。

## 实际检查

本轮完整运行时验收对应 `86b101d`，后续`bf333eb`只补安全脚本/CI/容量测试；另行实跑42项SQL与3项扫描测试。源指纹/全部退出见[冻结记录](m2/full-1793533425390/exits.json)，未引用原目录11项历史单元或额外浏览器夹具。

| 检查 | 结果 / 原始证据 |
|---|---|
| 全量 Vitest | 414/414，24 文件；[本轮完整单元](m2/full-1793533425390/tests.txt) |
| 类型 / 生产构建 | 通过；[类型](m2/full-1793533425390/typecheck.txt)、[构建](m2/full-1793533425390/build.txt) |
| 全量生产 Chromium | **68/68，无retry/skip**；[本轮日志](m2/full-1793533425390/browser.txt)、[结构结果](m2/full-1793533425390/browser-results.json)。含发布→搜索→点赞→只读预览→原子导入→本地生成→统计→刷新/断网及M2定向回归 |
| 仓库子路径生产 Chromium | 1/1；[本轮子路径](../../m3-subpath-final.txt)、[子路径构建](../../m3-subpath-build-final.txt)；只验回调入口可刷新，不代表真实 OAuth 成功 |
| 原安全/规模基准 | 120/120；[本轮基准](m2/full-1793533425390/benchmark.txt)；旧库、10k 输出、百万逻辑前缀、取消、压缩炸弹/损坏、来源等另由完整浏览器覆盖 |
| 嵌入式 PostgreSQL | 42 项真实 SQL 检查通过；[本轮SQL](../../m3-db-final.txt)。**fixture Auth、单连接排队，不是 Supabase RLS 或多连接并发验收** |
| Deno Edge | 类型检查及 1 项真实 handler 测试通过；[本轮Edge](../../m3-edge-test-final.txt)、[类型](../../m3-edge-check-final.txt)。HTTP Auth/RPC 为夹具，覆盖认证、actor 伪造、大包和恶意上传拒绝，不验真实服务 |
| 构建密钥边界 | 7/7：特权key、OAuth secret、PAT、密码、token、URL嵌入凭证、非法base在打包前拒绝；[本轮结果](../../m3-build-security-final.txt) |
| 密钥门禁 | Gitleaks 8.30.1、归档SHA固定；所有refs完整历史/提交消息、索引、含忽略/未跟踪文件的工作区、dist及工作流扫描：0未处理命中；2条源文件SHA误报逐行摘要核对并记录。扫描器3/3负向检查；[结果](m3/security-gates.json)、[扫描测试](../../m3-secret-tests-final.txt) |
| 依赖 | 此前31f27ee [frozen install](m3/dependencies.txt)通过；此前[生产依赖 audit](m3/dependency-audit.json)报告漏洞0，本轮未改依赖或重做CVE查询，不是安全性证明 |
| 真实 Supabase | **未验收**：[本地 54322 拒绝连接](m3/supabase-unavailable.txt)、无 Docker。已提供 [14 项 pgTAP](../supabase/tests/community_rls.test.sql)，未运行，不能算通过 |
| 隔离保护 | [233 个原目录历史路径交付前字节比对](m3/preservation.json)一致；本 worktree 测试重写的 35 个旧证据恢复为基线字节，未提交 |
| UI | 人工查看[桌面](m3/desktop.png)、[390px](m3/mobile.png)；检查横向溢出及完整旅程 |

真实失败：首次社区 Chromium 为 2/3，断网再次创建 Worker 时资源请求失败；补静态离线缓存后保持原生成/刷新断言通过。一次未知扩展测试因发布端未安装并启用声明而正确拒绝；修正夹具安装步骤后通过，接收端仍验证默认禁用。第三轮全量 64/65，[失败记录](m3/browser-output-collision.txt)为并行子路径 runner 清理共用 test-results 导致 trace ENOENT；已在 `31f27ee` 隔离输出，最终串行重跑，未改业务断言。CLI/Deno 安装器遇到 Windows 原生依赖缺失，改用官方 npm 原生二进制在项目外检查；过新数据库测试依赖改为 `@electric-sql/pglite@0.3.14`，最终 frozen lockfile 通过供应链等待期检查，没有保留例外配置。

## 部署配置与用户后续操作

本轮仅保存迁移、函数及候选artifact工作流；workflow_dispatch/普通pull_request触发，contents:read、checkout不保留凭证、action按SHA固定。先全范围扫描，再安装/lint/typecheck/test/SQL/校验器/Chromium/build，最后扫描真实dist后上传artifact。无pull_request_target、生产secret、pages/id-token写权限或deploy-pages步骤，不会公开部署。CI尚未远程运行；本地命令结果如上。

1. 准备一个明确授权的非生产 Supabase 环境或 Docker 本地环境。按当前 CLI `--help` 使用 `supabase start`；已有本地数据库用增量迁移，不对用户数据执行 reset。运行 `supabase test db` 的 pgTAP，并使用两个真实账号、匿名和两个并发连接验证点赞/事件/版本冲突、RLS/GRANT、真实 RPC/Edge 和失败回滚；运行 advisors。未完成前不公开服务。
2. 配置 Auth GitHub provider。GitHub OAuth callback 是 Supabase 的 `/auth/v1/callback`；Supabase Site URL 与允许 redirect 必须为站点的精确仓库根路径 `https://HOST/REPO/`。邮箱备用路径用预建测试账号，邮件注册关闭；匿名登录保持关闭。真实密钥只放 Supabase 控制台/服务端。
3. 浏览器仅设置 `.env.example` 的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`。服务端设置 `COMMUNITY_PUBLISHABLE_KEY`、`COMMUNITY_ALLOWED_ORIGINS`（逗号分隔的精确 origin）；service_role 从 Supabase Edge 环境读取，禁止 VITE_ 前缀。按用户核准的账号手动写私有 moderators 表；不读取 user_metadata 管理员标记。
4. `pnpm community:validator` 后部署函数/迁移到获准的测试环境。`GLYPHFORGE_BASE=/REPO/ pnpm build`；站点页面都在仓库根路径切换，不使用 history 子路由，OAuth 查询参数回根入口。实际 Windows 构建以 `$env:GLYPHFORGE_BASE='/REPO/'` 设置。
5. [M2 门禁](M2-RELEASE-READINESS.md)已独立验收通过。仍需经用户明确授权连接 GitHub Pages、配置实际 OAuth/生产项目和发布。当前构建工作流只产生可审核 artifact，不会正式上线。


## 可复用发布前密钥与隐私门禁

`pnpm secrets:scan`或`git -c core.hooksPath=.githooks commit`执行同一完整扫描；`pnpm secrets:staged`仅用于快速索引诊断。Hook固定LF，不修改用户全局Git配置。仅`.env.example`可跟踪，内容只有占位URL/publishable key/base；前端非空VITE变量只允许URL和publishable key两项，拒绝含凭证URL。原目录新增.gitignore规则已评审且原字节保留，本分支纳入同等规则并不豁免env.sample/template。忽略不保护已有索引/历史，扫描还独立拒绝已跟踪的凭证路径。

扫描固定[Gitleaks v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)，Windows/Linux x64归档SHA-256写死并验证。无文件大小静默跳过；仅排除`.git`对象内部（另由git模式扫描）与不发布的node_modules（若被跟踪则门禁拒绝），拒绝未盘点符号链接；归档/解码递归上限5，专用模式不能理解的二进制/图片仍需人工隐私检查，不宣称形式证明。真实命中或扫描异常一律阻断，必须撤销/轮换真实凭证，不能用gitignore掩盖。

扫描原始stdout/stderr仅在内存，绝不写磁盘或转发；仅输出规则/位置/提交等受限字段，防止commit message绕过脱敏。唯二误报为本轮source.json里扫描脚本的文件SHA，已与冻结文件核对；[记录](../scripts/secret-scan-allowlist.json)按文件+行+规则+整行摘要精确匹配，改变任何一项即再次阻断，不豁免目录或凭证模式。提交前hook曾实际阻断这两处误报；精确复核后通过。

公网读取目前仍直接经RLS只读API，反复匿名下载及未认证Edge/Auth请求会消耗平台额度。**在获准的非生产环境配置并测出平台层读/认证/函数限流、监控与紧急停用前，公开上线保持NO-GO**；数据库预算仅限制接受的写入，不能承诺绝对防伪或免费额度永不耗尽。自动保留期/账号删除流程仍需上线前确定；容量达到阈值会拒绝新增内容并需管理员处理，不能静默删用户资产。

## 限制与费用边界

- 发布复用 GFS1 Worker：JSON ≤1 MiB、压缩 ≤64 KiB、8 秒、两任务并发；下载仍为原 v1–v7 JSON。闭包不透明的外部动态资源可能需勾选定义快照才能通过服务端闭包检查；不会猜测隐藏定义。复杂组合与真实云端批量发布性能尚待实测。
- 子串搜索尚无专用全文/三元组索引；已有公开时间/点赞/采纳排序、作者、标签 GIN 及事件/举报索引，采用有界 offset 分页。不是大规模搜索服务。服务端预算行有意全局串行，适合初期有界流量，未证明高吞吐。
- 静态离线预缓存含现有中文数据，[本轮未压缩 assets 合计 12.92 MiB](m3/assets.json)，首次传输和本机存储有额外成本；不是实际 gzip 流量/RSS 测量，浏览器可驱逐缓存。构建仍有既有大中文 chunk 警告。无跨浏览器、真实低端机、完整屏幕阅读器或云端 p95/RSS 结论。
- [Supabase 定价](https://supabase.com/pricing)核查日：Free 为 500 MB 数据库、5 GB egress、50k MAU，闲置一周可能暂停。新增全局快照累计16MiB、UTC每日2MiB的事务计数（含软删除快照）；受控表合计物理体积64MiB插入前暂停，实际索引/TOAST也计入。42项SQL包含实际64MiB不可压缩TOAST填充后拒绝、移除测试占位后恢复、日切及失败回滚。阈值允许最后一条写入的页/索引增量，不是磁盘精确硬上限，也不涵盖Auth/平台系统表。浏览下载和未认证请求也消耗平台额度，本方案不能自行硬封所有公网读取/Edge 调用成本。
- 上线前需根据实测下调发布预算、监控数据库/流量/Edge 用量并配置平台限制。Pro 的 [Spend Cap](https://supabase.com/docs/guides/platform/cost-control)仅覆盖列明项目，不能宣称总账单硬上限。原始事件只保存账号/方案版本/类型/时间/随机幂等键，无名字结果、IP 或设备指纹；目前没有自动保留期/物理清除作业，需在公开前确定保留与账号删除流程。软删除隐藏公开内容，服务端快照仍保留。
- 关注、评论、聊天、算法推荐、云执行和自动审核不在本轮范围；完整 v3.0 规划仍未完成。
