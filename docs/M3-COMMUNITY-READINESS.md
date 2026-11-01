# GlyphForge M3 社区方案就绪表

2026-11-01（Asia/Shanghai）。功能源码 `9356ede070c107dde73cdda7905b4ade42507e0c`，账号切换修正 `f7a83a7`，验收设施修正/最终冻结 `31f27ee`；基线 `c39a90d`；独立分支 `codex/m3-community`，worktree 为项目旁 `GlyphForge-M3`。原 `id生成` 工作区及历史未提交资产未参与提交。

**本地实现 CONDITIONAL GO；公开上线 NO-GO。** 真实 Supabase Auth / PostgREST / RLS、真实多连接并发和 GitHub OAuth 尚未验收；M2 已知估算跨标签门禁未修复。浏览器本轮通过不能撤销 M2 已有失败。未创建公开仓库、push、合并主分支、修改生产项目、配置真实 OAuth 密钥或部署。

## 实际功能

- 现有工坊内「社区广场」按需加载：匿名浏览、标题/描述/标签关键词、精确标签、最新/热门点赞/最多使用（采纳）、每页 12 项。版本列表只拉元数据，选定版本才下载最多 1 MiB 的 JSON。
- 云端适配器使用固定 `@supabase/supabase-js@2.118.0`：GitHub PKCE、会话恢复/刷新/退出、邮箱密码备用登录。OAuth 缺失时可用预建测试账号。整个服务未配置时，用户显式选择**本地演示**；账号/数据/计数标明模拟，刷新可恢复，不发往云端，也不替代权限验收。
- 登录后发布**当前选定工作流**、改标题/描述、追加不可变版本（乐观版本检查）、下架/重新上架/软删除自己的方案。作者采用稳定账号化名，不公开邮箱。审核下架后作者不能自行上架，但可软删除。
- 分享初始不勾选资源；词库/关系/Mapping 逐项选择，所需子图/扩展另行勾选同意。预览完整上传 JSON，确认后才发送。拒绝历史/收藏/本地社区来源字段、无关快照、保留原型键、脚本字段和可执行标记。种子、原算子版本和声明式扩展语义延续。
- 下载→哈希/协议/闭包校验→只读预览→冲突和缺失提示→ImportBindings→确认→原事务导入新 ID 副本→手动本地运行。来源归属与副本在同一事务保存；最终写失败整体回滚。未知扩展默认禁用；导入不重新启用已禁用扩展。运行使用现有 Worker，无在线任意代码执行。
- 点赞最多一条账号/方案关系，可撤销；本机隐藏、恢复隐藏、限额举报、管理员审核队列和审核下架可用。管理员来自私有成员表，不来自用户可修改 metadata。审核界面为基础队列，无自动内容判定。
- 静态 Service Worker 按构建哈希缓存同源应用与运行资源，缓存完整安装后可断网生成、刷新；UI 显示缓存是否就绪。API/Auth 响应、账户和本地创作数据不进入该缓存；首次缓存、清理站点数据后仍需联网。不是系统安装式 PWA，也不保证浏览器不驱逐缓存。

## 数据、权限与统计

迁移：[20261101091101_community_platform.sql](../supabase/migrations/20261101091101_community_platform.sql)。使用 profiles、community_workflows、workflow_versions、workflow_likes、usage_events、reports；私有 schema 保存审核员、开关与预算。主 IndexedDB 仍为 schema7；仅增加可选来源字段和独立有界统计 outbox，不迁移旧资产。

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

最终验收对应冻结 `31f27ee`，不引用历史未提交夹具作为新增证据。早期开发态回归另行标识，不计入最终冻结验收。基线提交单元为 407 项，本轮增加 7 项；原目录另有 11 项历史单元及额外浏览器夹具，本 worktree 未混入。

| 检查 | 结果 / 原始证据 |
|---|---|
| 全量 Vitest | 414/414，24 文件；[unit.txt](m3/unit.txt) |
| 类型 / 生产构建 | 通过；[types.txt](m3/types.txt)、[build.txt](m3/build.txt) |
| 全量生产 Chromium | 65/65；[browser.txt](m3/browser.txt)、[结构化结果](m3/browser-results.json)。早期开发态亦分别 65/65，[首轮](m3/browser-first.txt)、[第二轮](m3/browser-second.txt) |
| 仓库子路径生产 Chromium | 1/1；[subpath.txt](m3/subpath.txt)、[子路径构建](m3/subpath-build.txt)；只验回调入口可刷新，不代表真实 OAuth 成功 |
| 原安全/规模基准 | 120/120；[benchmark.txt](m3/benchmark.txt)；旧库、10k 输出、百万逻辑前缀、取消、压缩炸弹/损坏、来源等另由完整浏览器覆盖 |
| 嵌入式 PostgreSQL | 34 项真实 SQL 检查通过；[db.txt](m3/db.txt)。**fixture Auth、单连接排队，不是 Supabase RLS 或多连接并发验收** |
| Deno Edge | 类型检查及 1 项真实 handler 测试通过；[edge.txt](m3/edge.txt)。HTTP Auth/RPC 为夹具，覆盖认证、actor 伪造、大包和恶意上传拒绝，不验真实服务 |
| 构建密钥边界 | 3/3：secret key、VITE_SECRET、非法 base 在打包前拒绝；[build-security.txt](m3/build-security.txt) |
| 依赖 | 最终 [frozen install](m3/dependencies.txt)通过；[生产依赖 audit](m3/dependency-audit.json)本轮报告漏洞 0，不是安全性证明 |
| 真实 Supabase | **未验收**：[本地 54322 拒绝连接](m3/supabase-unavailable.txt)、无 Docker。已提供 [14 项 pgTAP](../supabase/tests/community_rls.test.sql)，未运行，不能算通过 |
| 隔离保护 | [233 个原目录历史路径交付前字节比对](m3/preservation.json)一致；本 worktree 测试重写的 35 个旧证据恢复为基线字节，未提交 |
| UI | 人工查看[桌面](m3/desktop.png)、[390px](m3/mobile.png)；检查横向溢出及完整旅程 |

真实失败：首次社区 Chromium 为 2/3，断网再次创建 Worker 时资源请求失败；补静态离线缓存后保持原生成/刷新断言通过。一次未知扩展测试因发布端未安装并启用声明而正确拒绝；修正夹具安装步骤后通过，接收端仍验证默认禁用。第三轮全量 64/65，[失败记录](m3/browser-output-collision.txt)为并行子路径 runner 清理共用 test-results 导致 trace ENOENT；已在 `31f27ee` 隔离输出，最终串行重跑，未改业务断言。CLI/Deno 安装器遇到 Windows 原生依赖缺失，改用官方 npm 原生二进制在项目外检查；过新数据库测试依赖改为 `@electric-sql/pglite@0.3.14`，最终 frozen lockfile 通过供应链等待期检查，没有保留例外配置。

## 部署配置与用户后续操作

本轮仅保存迁移、函数及**手动触发的构建 artifact 工作流**，无 deploy-pages 步骤、无推送触发或发布权限。所有新代码已本地提交。

1. 准备一个明确授权的非生产 Supabase 环境或 Docker 本地环境。按当前 CLI `--help` 使用 `supabase start`；已有本地数据库用增量迁移，不对用户数据执行 reset。运行 `supabase test db` 的 pgTAP，并使用两个真实账号、匿名和两个并发连接验证点赞/事件/版本冲突、RLS/GRANT、真实 RPC/Edge 和失败回滚；运行 advisors。未完成前不公开服务。
2. 配置 Auth GitHub provider。GitHub OAuth callback 是 Supabase 的 `/auth/v1/callback`；Supabase Site URL 与允许 redirect 必须为站点的精确仓库根路径 `https://HOST/REPO/`。邮箱备用路径用预建测试账号，邮件注册关闭；匿名登录保持关闭。真实密钥只放 Supabase 控制台/服务端。
3. 浏览器仅设置 `.env.example` 的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`。服务端设置 `COMMUNITY_PUBLISHABLE_KEY`、`COMMUNITY_ALLOWED_ORIGINS`（逗号分隔的精确 origin）；service_role 从 Supabase Edge 环境读取，禁止 VITE_ 前缀。按用户核准的账号手动写私有 moderators 表；不读取 user_metadata 管理员标记。
4. `pnpm community:validator` 后部署函数/迁移到获准的测试环境。`GLYPHFORGE_BASE=/REPO/ pnpm build`；站点页面都在仓库根路径切换，不使用 history 子路由，OAuth 查询参数回根入口。实际 Windows 构建以 `$env:GLYPHFORGE_BASE='/REPO/'` 设置。
5. 先解决并重新验收 [M2 门禁](M2-RELEASE-READINESS.md)，再经用户明确授权连接 GitHub Pages、配置实际 OAuth/生产项目和发布。当前构建工作流只产生可审核 artifact，不会正式上线。

## 限制与费用边界

- 发布复用 GFS1 Worker：JSON ≤1 MiB、压缩 ≤64 KiB、8 秒、两任务并发；下载仍为原 v1–v7 JSON。闭包不透明的外部动态资源可能需勾选定义快照才能通过服务端闭包检查；不会猜测隐藏定义。复杂组合与真实云端批量发布性能尚待实测。
- 子串搜索尚无专用全文/三元组索引；已有公开时间/点赞/采纳排序、作者、标签 GIN 及事件/举报索引，采用有界 offset 分页。不是大规模搜索服务。服务端预算行有意全局串行，适合初期有界流量，未证明高吞吐。
- 静态离线预缓存含现有中文数据，[本轮未压缩 assets 合计 12.92 MiB](m3/assets.json)，首次传输和本机存储有额外成本；不是实际 gzip 流量/RSS 测量，浏览器可驱逐缓存。构建仍有既有大中文 chunk 警告。无跨浏览器、真实低端机、完整屏幕阅读器或云端 p95/RSS 结论。
- [Supabase 定价](https://supabase.com/pricing)核查日：Free 为 500 MB 数据库、5 GB egress、50k MAU，闲置一周可能暂停。100 个 1 MiB 版本/天即可很快耗尽免费数据库；现有配额是滥用边界，**不是免费运行保证**。浏览下载和未认证请求也消耗平台额度，本方案不能自行硬封所有公网读取/Edge 调用成本。
- 上线前需根据实测下调发布预算、监控数据库/流量/Edge 用量并配置平台限制。Pro 的 [Spend Cap](https://supabase.com/docs/guides/platform/cost-control)仅覆盖列明项目，不能宣称总账单硬上限。原始事件只保存账号/方案版本/类型/时间/随机幂等键，无名字结果、IP 或设备指纹；目前没有自动保留期/物理清除作业，需在公开前确定保留与账号删除流程。软删除隐藏公开内容，服务端快照仍保留。
- 关注、评论、聊天、算法推荐、云执行和自动审核不在本轮范围；完整 v3.0 规划仍未完成。
