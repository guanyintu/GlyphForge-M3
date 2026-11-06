# GlyphForge M3 社区方案就绪表

## 2026-11-06 Supabase 生产后端与 GitHub Pages 正式部署

- 已在现有 Free 组织创建独立生产项目 glyphforge-m3-production（gallindmwjiwsitczjzu），新加坡区域，ACTIVE_HEALTHY，创建报价 $0/月；未升级套餐。原测试项目 glyphforge-m3-test（rsntccggnvmuazvpxstf）已暂停并保留数据，其他 Supabase 项目未修改。
- 新生产项目已应用两份社区迁移（20261106132755、20261106132801）。六张 public 社区表均启用 RLS，客户端写 GRANT 为 0；预算和管理数据放在私有 schema。community Edge Function v2 ACTIVE，verify_jwt=true；GitHub Pages origin 的真实 OPTIONS 预检为 204。生产业务表保持空白，没有写入合成业务数据。
- 已创建公开仓库 https://github.com/guanyintu/GlyphForge-M3，默认分支 main。当前部署相关提交：acc372f（生产后端初始化）、893a335（Pages workflow）、82b390a（M3 定向浏览器验收）。
- 推送前使用 Gitleaks 8.30.1 对全部 Git 历史、暂存区、提交消息和工作区（含忽略文件、未跟踪文件、dist）扫描：1083 个已跟踪文件、1240 个工作区文件、约 75 MB；0 个未处理发现。3 条通用 API Key 规则命中均按文件/行号/内容 SHA 精确复核：1 条公开 Supabase publishable key、2 条 SHA-256 文件指纹；没有 service-role key 或本地令牌凭证进入仓库。
- GitHub Pages 已启用为 GitHub Actions 部署。Workflow run 42243418707 成功：Vitest 422/422、community acceptance guard 38/38、M3 浏览器验收 6/6（1280px、375px、GitHub Provider 未启用提示及三类 OAuth 回跳错误脱敏）、生产构建、最终产物和 Git 历史扫描、Pages artifact 上传及部署均 PASS。
- 生产构建使用仓库子路径 /GlyphForge-M3/。站点 https://guanyintu.github.io/GlyphForge-M3/ 返回 HTTP 200，HTML 引用的 4 个 JS/CSS 资源均返回 HTTP 200。GitHub 仓库变量仅配置 Supabase URL 和公开 publishable key；本机 .env.production.local 被 Git 忽略。没有提交 service-role key。
- **静态站点已经公开部署；社区云端 GitHub 登录尚未配置。** 对生产 Auth settings 的真实只读检查结果为 github=false、email=true。尚未创建 GitHub OAuth App、设置 Supabase Provider / Site URL / Redirect URLs，也没有进行真实 OAuth 登录。因此本地与模拟验收通过不等于生产登录通过；完整社区发布仍需完成 OAuth 和平台安全/留存门禁。
- 下一步：GitHub OAuth App Homepage URL 使用 https://guanyintu.github.io/GlyphForge-M3/；Authorization callback URL 使用 https://gallindmwjiwsitczjzu.supabase.co/auth/v1/callback。Client ID / Secret 只填入正式 Supabase Dashboard → Authentication → Providers → GitHub，绝不要放入 Git、仓库变量、聊天或前端。随后把正式 Site URL 和 Redirect URL 设为 https://guanyintu.github.io/GlyphForge-M3/，真实验证 PKCE、回跳换码、刷新、登出和 RLS；通过后再关闭 Email/Password Provider。另需完成平台级限流/费用、托管并发、留存和注销审查。

详见 [生产环境部署记录](M3-PRODUCTION-DEPLOYMENT.md) 与 [发布阻断清单](M3-RELEASE-BLOCKERS.md)。

## 2026-11-06 Free Plan 登录路线验收（Asia/Shanghai）

正式公开社区继续使用 Supabase Free Plan，前端仅提供 **GitHub 登录**。云端页面移除了邮箱、密码和密码登录入口。未配置云端服务时，用户仍可主动进入本地演示，使用演示账号；演示账号、数据和计数保存在当前浏览器。客户端保留 PKCE、会话恢复与刷新、登出，并继续以 `BASE_URL` 计算回跳地址。

登录前只读取项目公开的 Auth Provider 可用状态。GitHub 未启用时提示联系管理员；回跳携带错误或浏览器无法完成换码时，社区显示固定的配置检查提示，并清理地址栏中的认证参数。GitHub 或 Supabase 若将浏览器留在站外，站内提示无法显示，须在发布前使用实际站点验证回跳。 [GitHub 登录](https://supabase.com/docs/guides/auth/social-sign-in/auth-github) · [回跳地址](https://supabase.com/docs/guides/auth/redirect-urls)

| 验收项 | 状态 | 范围 |
| --- | --- | --- |
| GitHub-only 云端界面与本地演示 | PASS（本地） | Vitest 422/422，Playwright 云端模拟 6/6、本地演示 3/3、仓库子路径离线回归 1/1。覆盖桌面与 375px 下无密码表单、演示登录、GitHub 未启用及回跳错误的脱敏提示。 |
| OAuth 会话生命周期 | PASS（模拟） | SDK 按仓库子路径启动 GitHub PKCE，模拟回跳换码、过期会话刷新、页面重载恢复、登出和切换账号。 |
| 真实 GitHub OAuth / PKCE | **NOT_RUN** | GitHub Provider、OAuth App 与实际站点回跳尚未配置。本次未进行真实登录或云端业务写入，历史测试结果见下文。 |
| M3-C / M3-D | **PARTIAL** | GitHub Pages 静态站点已部署；生产 Auth 实测 github=false、email=true，真实 OAuth 未运行。云端社区登录及完整公开上线仍 **NO-GO**。 [发布门禁](M3-RELEASE-BLOCKERS.md) |

`glyphforge-m3-test` 的 Email Provider、两个合成账号和 DPAPI vault 保留供受限验收使用。真实浏览器验收脚本通过仅供本机测试的入口建立合成账号会话，保留原请求目标、限额和写白名单。本次用离线模拟验证脚本；云端 Provider 设置与 DPAPI vault 未被操作。

当前静态站点已部署。下一步管理员需在 GitHub 和**正式 Supabase 项目**配置 GitHub Provider。OAuth App 的 callback 使用所连接项目的 `/auth/v1/callback`。`glyphforge-m3-test` 对应 `https://rsntccggnvmuazvpxstf.supabase.co/auth/v1/callback`。正式 Site URL 与 Redirect URLs 必须匹配待确认的实际站点根路径，保留 GitHub Pages 仓库子路径末尾的 `/`。OAuth 凭证只填入 Supabase 控制台。生产 Auth settings 当前实测为 github=false、email=true。真实 GitHub 登录和 PKCE 回跳验证通过后，在正式项目关闭 Email/Password Provider，再验证 GitHub 登录、刷新、登出、RLS，以及密码登录被服务端拒绝。前端移除密码入口只完成了界面变更。 [GitHub 登录](https://supabase.com/docs/guides/auth/social-sign-in/auth-github) · [回跳地址](https://supabase.com/docs/guides/auth/redirect-urls)

## 2026-11-06 M3-UI 真实浏览器写入与 M3-C 门禁（历史实跑）

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| M3-UI simulated | PASS | 本轮桌面、375px 合同模拟通过。新脚本离线测试覆盖目标、凭证、限额、写白名单、脱敏与 429 后仅清理新 UUID。 |
| M3-UI real read-only | PASS | 沿用上轮 6 次可控请求、0 写入。上轮浏览器 OPTIONS 未单独计数。[上轮结果](m3/http-ui-20261106/backend-and-ui-audit.json) |
| M3-UI real business write | PASS | 专用项目的本机 Vite + Chromium，两个隔离 BrowserContext。工坊导入单个两节点合成方案，验证完整预览、隐私说明和 1,259 字节显示，A 发布后在列表/详情核对标题、作者、v1。B 登录后看到同一条目，点赞显示 1、取消显示 0。A 点击软删除，B 刷新后不可见。[脱敏记录](m3/ui-business-20261106/result.json) |
| M3-C 平台安全与费用 | BLOCKED | 控制台配置和平台入口控制待核实。5 条 INFO 已核查，泄露密码保护仍 WARN。[发布阻断项](M3-RELEASE-BLOCKERS.md) |
| M3-B hosted concurrency | NOT_RUN | 上轮本地 PostgreSQL 独立 writer 8/8，未执行托管双 writer 测试。[本地并发证据](m3/http-ui-20261106/local-concurrency.json) |
| M3-D release | BLOCKED | 公开发布 NO-GO。CI 在当前仓库仅产出候选 artifact，无 remote。 |

- 真实业务 **28/28 HTTP，含 11 个原生 OPTIONS**。四次且仅四次 Edge POST，publish、like、unlike、status=deleted 均为 HTTP 200。打开详情产生的应用自动 view 事件在浏览器发出 HTTP 前拦截，避免额外写入。详情去除重复点赞状态读取；点赞后就地更新当前行，按热度排序时仍刷新列表。
- UTC 2026-11-06，管理连接只读核对预算为全局 **0 → 8**，A、B 各 **0 → 4**，发布数 **0 → 1**，日快照 **0 → 818 bytes**，累积 **1,280 → 2,098 bytes**。各成功操作包含一次 reserve 和一次事务扣减。首次启动因云端与本机时钟偏差在前置校验阻断，HTTP 为 0；修正为有界时钟容差并取得新快照后完成唯一一次云端浏览器业务运行。
- 数据库确认本轮 UUID `1bf25296-2c2a-43b7-b616-743e0d0ca335` 为 **deleted**。保留 1 个 workflow、1 个版本（818 bytes），0 likes、0 reports、0 events，复用已有作者 profile（总数 1 → 1）。旧轮方案的 deleted 状态、两版本、1 举报和 3 事件复核与基线相同。软删除保留本轮版本及预算记录。
- 凭证由现有 Windows 当前用户 DPAPI 经一次性 stdin 管道交给本地进程。Vite 仅接受指定项目和已有公开 publishable key，使用临时浏览器上下文。报告只保留动作状态、HTTP 计数、合成 UUID 及聚合 SQL；无 HAR、trace、视频、用户标识或会话存档。只读管理 SQL 与 loopback 资源单独核算。
- 本轮验证通过新增离线保护和 Chromium 模拟成功/429 清理路径、桌面与 375px 模拟 2/2、Vitest 415/415、PowerShell AST、TypeScript、lint、生产构建和 Gitleaks 8.30.1（0 未处理命中，沿用两条已有精确误报记录）。Vite 仍报告既有混合导入和大 chunk 警告。
- 离线复现为 `node scripts/test-community-ui-business-live.mjs`。需要重新开展真实验收时，先在专用项目运行 [budget.sql](m3/ui-business-20261106/budget.sql)，将返回的单行导出为无凭证 JSON，随后用 `scripts/Run-M3-Auth-Vault.ps1 -Action Run -Check UIBusiness -BudgetSnapshot <path>`。运行一次即可能创建新方案并扣额度，启动器退出 0 表示浏览器断言通过，最终 PASS 依赖独立 SQL 读回。[本轮定向只读 SQL](m3/ui-business-20261106/workflow-readback.sql)

## 2026-11-06 M3-A 真实 HTTP、M3-B 本地并发及 M3-UI 验收（历史实跑）

- 基线确认：`codex/m3-community @ 3258257`，无 remote。仅修改本 M3 工作区；不操作原 M2，不编辑或提交 `docs/m2/full-1793533425390/`。无公网部署、push、账号创建、Auth 全局策略或 RLS/JWT 放宽。
- **M3-A Auth PASS**：沿用已确认的真实 14/14 Auth smoke；本次业务脚本再次实际验证 A/B 密码登录、签名会话 getUser 与不同用户。测试凭证仅由当前用户 DPAPI 解密，经一次性本机匿名 stdin 管道进入测试进程，未进入 argv、环境、报告、聊天或 Git。保留独立 Auth smoke，不改为混合脚本。
- **M3-A HTTP Business PASS**：指定项目 `glyphforge-m3-test / rsntccggnvmuazvpxstf` 的云端 community v1 ACTIVE、`verify_jwt=true`。入口与 validator 按 LF 归一化 SHA-256 与本地完全一致，无需部署。真实 JWT → Edge POST → RPC → PostgreSQL 流程 **33/40 HTTP 请求**、18 次 Edge POST（15 次成功，3 次预期业务拒绝 400；无 5xx）。只创建 1 个 640-byte 合成工作流，v1/v2 各自经真实 validator 验证；公开字段、内容哈希、B 不能编辑 A、点赞/重复点赞/取消、举报 RLS、未采纳 run 拒绝、view/adoption/run 重复幂等、元数据编辑、v2/旧版本冲突、unlisted 作者可见/B 不可见、deleted/B 不可见均通过。完整脱敏逐项证据见 [http-business.json](m3/http-ui-20261106/http-business.json)。
- **清理与费用实测**：finally 仅 soft-delete 本次新建 UUID `e34e98cc-78d1-4be2-9d06-65e0f19f26c0`；后台只读复核 status=deleted、version=2，likes=0，views/adoptions/runs 各 1。仍留存 **1 workflow、2 versions、1 synthetic report、3 events、0 like rows、1 profile**，未物理删除。payload_bytes=1280，payload_day_bytes=1280。UTC 预算日 2026-11-05 从 0 增至 **33 writes / 2 publications**；A 11、B 22。Edge reserve 是独立事务：18 次 reserve 均扣额度，15 次成功业务再扣一次；3 次业务拒绝各扣一次 reserve，未留下非法业务副作用。这是保守的请求成本设计，本次没有为通过测试降低限制。每日账号上限 240、全局 20,000，快照日上限 2 MiB/总量 16 MiB，均未触及；实际账单金额/平台读取流量上限未据此验证。见 [后台与 UI 审计](m3/http-ui-20261106/backend-and-ui-audit.json)。
- **M3-B Concurrency PASS（本地 PostgreSQL）**。Windows 工作区挂载无法满足 PG 数据目录权限。获批后在 WSL `/tmp` 创建隔离的 PostgreSQL 15.19 实例，以合成 Auth fixture 应用两份原始迁移。每个场景使用两个独立 psql 连接，并通过第三个连接观察不同后端 PID 和 `pg_blocking_pids` 的锁等待。8/8 通过，覆盖同时点赞、点赞与取消、同版本发布冲突、事件幂等、账号日写入上限 240、全局日写入上限 20,000、跨账号编辑拒绝及快照日上限 2 MiB。触发快照上限后，失败发布新增的资料、工作流和预算扣减均回滚。实例仅通过私有 Unix socket 连接，已停止并删除临时数据。本轮云端请求与写入均为 0，托管双会话仍为 NOT_RUN。[逐项锁等待和数据库读回](m3/http-ui-20261106/local-concurrency.json)
- **M3-UI 已实现 / 模拟通过 / 真实数据部分通过**：沿用 Community.tsx、community.css、既有 community 路由、client/local；未创建第二入口或改动 M2 工坊。新增列表加载、操作处理中、空筛选、错误重试、额度/权限/网络错误的安全文本；同步 ref 锁防重复提交；详情/发布入口焦点、异步禁用后焦点恢复及 Escape 返回；44px 触控目标、分页换行、可见焦点与 reduced-motion。保留完整发布快照/体积/隐私与哈希只读导入预览，新增软删除留存说明和状态成功提示。修正 demo 对 deleted 快照的读取及按版本采纳/run 约束，与真实 API 一致。
- **UI 实测**：独立 Playwright mock 配置在 **1280×900、375×900** 均通过：匿名浏览、真实客户端登录状态协议模拟、搜索/标签/排序/空状态/分页、详情与下载预览、发布预览/冲突/双击去重、点赞/取消、非作者权限、举报、429/500 脱敏、网络失败恢复、编辑/unlisted/deleted，键盘焦点、无横向溢出、无未处理 pageerror。原有演示测试验证采纳→本机运行→计数、刷新持久化、离线工坊，既有收藏/导入路径由全套 e2e 覆盖。
- **有界真实浏览器数据**：375px 本机 Vite 前端连接指定测试项目，匿名空列表→真实 B 登录→deleted 方案不可见→登出 **PASS**，6 次可控 API 请求、0 次业务写入。浏览器管理的 CORS 预检未单独计数；不将 6 次声称为全部底层 HTTP 传输次数。未导出会话、HAR、trace、视频或真实账号截图，未在真实云端重复探索发布/点赞。发布全链路的真实证据来自独立 33 请求脚本，而不是浏览器模拟。桌面真实登录发布、OAuth/PKCE 仍 NOT_RUN。
- **截图实际比较**：开工时实际查看 `test-results/community-desktop.png` 与 `community-mobile.png`，并与本次同场景截图比较。保留奶油白/绿色、侧栏、标题、卡片和网格风格；桌面按钮高度从原约 35px 增至 44px，筛选/卡片垂直位置略下移；手机原分页和“恢复本机隐藏”挤成多行窄字，现分页文本保持完整并自然换行，审核队列独占下一行。不同缓存状态的提示文案和 toast 时机不是美化成果。新增 375px mock 多卡片可正常滚动，1280px 为三列。没有宣称全站重设计、自动全量无障碍认证或像素级相等。归档截图及先前 docs/m3 截图在 [本轮证据目录](m3/http-ui-20261106/)；`prior-*` 是历史归档，不伪称与新 mock 数据同场景的像素基线。
- **Security & Cost**：Gitleaks **8.30.1** 全 refs/提交消息/索引/工作区（含忽略与未跟踪证据）0 未处理命中；沿用两条已核对逐行 SHA 的历史误报，不增加豁免。云端安全 advisor 有 5 INFO（默认拒绝的私有表）及 1 WARN：泄露密码保护关闭；未擅改全局 Auth。[官方说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。平台级读/Auth/Edge 频控、账单、保留期/账号删除和 OAuth 仍未验证，**公开发布 NO-GO**。
- **验证汇总**：业务保护/validator/PGlite HTTP fixture **11/11**（0 真实请求）；原 Auth fixture **8/8**、acceptance guard **38/38**、数据库 fixture **42/42**；Vitest **415/415**；`tsc --noEmit` 无错误，PowerShell AST 0 error、bash 语法通过。最终浏览器与安全结果见同目录 `verification.json`。第一次全套 e2e 的 5 个失败源于同时运行的 Playwright 清理同一输出目录（ENOENT），已隔离输出并重跑；如实保留此失败原因，不当作功能断言通过。
- **M3-A Auth PASS / M3-A HTTP Business PASS / M3-B Concurrency PASS（本地）/ M3-C Security & Cost PASS（本次受限范围）/ M3-D Release BLOCKED**。M3-UI mock 和真实浏览器只读链路通过，真实浏览器业务写入为 NOT_RUN。公开发布仍为 NO-GO，平台级发布控制尚未验证。

### 本轮复现入口

`pnpm community:business-plan` 输出零网络计划，`pnpm community:business-test` 执行离线回归。Windows `scripts/Run-M3-Business-Check.cmd` 使用已有 DPAPI 凭证，每轮会创建合成数据并扣额度。`Run-M3-Auth-Vault.ps1 -Action Run -Check UI` 执行真实浏览器只读验收。`pnpm community:ui-test` 通过请求拦截运行模拟测试。获批使用 WSL 临时目录后，可运行 `node scripts/community-concurrency-local.mjs --approved-wsl-temp`。该入口复用现有 PG 15.19 运行时，并在确认实例停止后清理临时目录。

## 2026-11-06：真实 Auth 14/14 及云端 PostgreSQL 事务验收（最新）

- 从本机脱敏结果 `~/.cache/glyphforge-m3-auth-smoke/latest-result.json` 确认 2026-11-06 01:02（Asia/Shanghai）的 14 次 HTTP **全部 PASS**：测试账号 A/B 分别密码登录、Auth `get_user` 200、公开读取 200、私有表 403、匿名无/假 JWT 401；使用合成测试账号且**实际业务写入 0**。两个 DPAPI 加密测试账号仍保存于项目外的 Windows 用户目录。注意 Edge `GET` 405 是 handler 在验证业务 JWT 之前返回的，因此它**不能证明**有效用户 JWT 可成功执行 Edge POST 写入。
- Supabase 连接器只使用 `glyphforge-m3-test`（`rsntccggnvmuazvpxstf`），先验证已有两个 Auth 账号、所有社区业务表为空且写入开关开启，然后用 **BEGIN → DO → ROLLBACK** 在托管 PostgreSQL 中运行真实 `public.community_write` 事务：发布初版、阻止其他作者编辑、重复点赞幂等、取消点赞、合成举报、拒绝未采纳的运行事件、浏览/采纳/运行计数、升级 v2、拒绝旧版本、unlisted 与 soft-delete 均断言通过。输出 **PASS_ROLLED_BACK**；随后数据库工作流、版本、点赞、举报、事件表计数均为 **0**，没有留存模拟业务数据。
- 该数据库测试使用管理连接直接执行 service-only SQL 函数，**不是**浏览器真实 JWT → Edge Function → RPC 的 HTTP 业务联调，也不等于双独立连接竞争测试。云端未执行真实发布/点赞/举报 HTTP 写入、OAuth/PKCE、平台级限流或删除/保留期验证；M3 公网发布仍为 **NO-GO**。
- 为降低费用风险，不做无界请求、压力测试或其他 Supabase 项目修改；原 M2 目录及既有未跟踪历史证据不动。


## 2026-11-05：M3-A 本机 DPAPI 加密测试凭证（最新）

- 按使用者要求增加**可选的本机凭证保存**，仅适用于独立测试项目的两个合成用户。Windows 双击 `scripts/Run-M3-Auth-Check.cmd` 首次弹出两次 `Get-Credential`，通过 Windows PowerShell `PSCredential | Export-Clixml` 将密码以当前 Windows 用户 DPAPI 加密，文件位于项目和 Git 之外的 `%LOCALAPPDATA%\GlyphForge\M3Auth\test-a.clixml`、`test-b.clixml`；邮箱用户名作为非秘密元数据可能在 XML 中明文出现。
- 后续双击复用这两个加密文件，使用 `Import-Clixml` 在**本机当前用户的 PowerShell 进程内**解密，经临时匿名管道传递给 WSL 的 `scripts/run-community-auth-piped.sh`；Node 验收入口新增 `--accounts-stdin`，严格限额最多 18 请求、只连接指定项目，账户密码不经过命令行参数、环境变量或项目代码文件，也不写入验收结果。运行期间明文仍短暂存在于进程内存；本功能不能防御已被控制的当前 Windows 用户会话。
- `scripts/Forget-M3-Auth-Check.cmd` 仅删除本机加密凭证文件，**不会**删除 Supabase 云端的测试用户或已产生的历史日志。需要换密码时可通过 PowerShell 在本机运行 `Run-M3-Auth-Vault.ps1 -Action Save` 覆盖旧密文。
- Node 合成管道、未给凭证阻断、超长/恶意输入测试 **8/8** PASS（0 真实网络请求）；原验收入口保护 **38/38** PASS；`bash -n`、PowerShell AST 静态语法解析 **0 error**。远程运行 DPAPI 实测被安全检查阻止，**不能宣称用户凭证已经保存或完整 Windows→WSL 运行链路通过**。仅在用户自己本机第一次录入时建立密文，届时再检查脱敏结果。社区正式发布仍 NO-GO，不做其他项目部署或公开发布。


## 2026-11-05：M3-A Auth Smoke HTTP 400 修复

- 现场读取本机脱敏结果：首次运行通过 `anon_list`（200）后，`anon_private_events` 因 HTTP 400 停止，只有 **2 次请求、0 次写入**，尚未开始 A/B 账号登录。
- 原因：只读探针误写 `usage_events?select=id`，而 Supabase `public.usage_events` 的真实列为 `event_key`（无 `id`）；数据库仍启用 RLS，匿名和普通 authenticated 角色均无该表 SELECT 授权，不是 RLS 绕过。
- 更正两处只读探针为 `?select=event_key&limit=1`，模拟网关 fixture 增加字段检查，防止错误列名被无条件 401 的假响应掩盖。**真实云端额外仅发出 2 次 GET**：私有表返回预期 401，公开列表返回 200；未进行任何 POST / 数据修改。新脚本本地检查 **5/5** 通过，原入口检查 **38/38** 通过。
- 最新 Auth 只读计数：**2 个用户、2 个已确认邮箱**，现在可用本机 `scripts/Run-M3-Auth-Check.cmd` 重试受限的真实登录验收；密码由用户在本机隐藏输入，助手不读取、不保存、不输出。真实账号 JWT / Edge 405 及后续写入/并发仍 **NOT RUN**；M3 公开发布继续 **NO-GO**。


## 2026-11-04：M3-A 本机隐藏输入与账号确认待办（最新）

- 只读确认独立项目 `rsntccggnvmuazvpxstf` 有 **2 个 Auth 用户、0 个已确认邮箱**；两个均为非匿名的 `email` 登录用户，且未发送邮件确认请求。不能在现有设置下完成真实密码登录，保持 **BLOCKED / 公开 NO-GO**。不向 `auth.users` 写 SQL、不放宽全局验证，不读取邮箱或密码。
- 在电脑的默认浏览器中打开本项目 `Authentication → Users` 页面，需通过 Supabase 官方管理员界面分别确认这两个合成测试账号；无邮箱确认管理入口时仅针对测试账号考虑用 **Auto Confirm User** 重建，不能把虚拟邮箱当成真实已验证邮箱。
- 新增 `scripts/run-community-auth-smoke.sh` 和 Windows 双击入口 `scripts/Run-M3-Auth-Check.cmd`。启动器只在本地交互式 TTY 提示输入两个邮箱与**隐藏**密码，进程环境仅临时保留，结束后取消环境变量；密码、JWT、邮箱不进入聊天、脚本、命令参数、Git、日志。公用 publishable key 从 Supabase 管理连接获取后只保存在设备自身 `~/.cache/glyphforge-m3-auth-smoke/publishable_key`，文件权限 0600（非私钥）；汇总只把脱敏 PASS/FAIL、HTTP 状态、请求计数写到同目录 `latest-result.json`，不储存 JWT。
- 本地 `bash -n`、Windows CMD CRLF 验证、非 TTY 强制 BLOCKED（exit 2，未发出 HTTP 请求）均通过；没有实际运行真实登录、发布、点赞或任何测试写入。用户确认两个账号后通过双击脚本执行最长 18 请求的只读 Auth/Edge 网关验收，再继续真实业务写入阶段。
- 本次仍不 push、不公开部署，不修改其他项目、原 M2 或旧未跟踪资料。


## 2026-11-04：M3-A 真实 Auth 验收准备（最新）

- 目标项目经 Supabase 连接器复核为 `glyphforge-m3-test`（`rsntccggnvmuazvpxstf`）：ACTIVE_HEALTHY，原两条迁移存在，`community` Edge ACTIVE v1、`verify_jwt=true`；**Auth 用户 0、已确认邮箱用户 0**。目前不得宣布双用户真实云端业务通过。
- 新增 `scripts/community-auth-smoke.mjs`（`pnpm community:auth-smoke --plan` / `--accounts --confirm-target rsntccggnvmuazvpxstf`），只允许在显式确认为本专用非生产 ref 时运行；使用临时进程环境的 `GLYPHFORGE_M3_PUBLISHABLE_KEY`、`GLYPHFORGE_M3_A_EMAIL`、`GLYPHFORGE_M3_A_PASSWORD`、B 的同名字段。未提供任一项即 **BLOCKED / 0 请求**；不探测其他项目、不发现持久凭证、不写文件、不输出邮箱、密码或 JWT。单次最多 **18** 请求，每次 15 秒超时，无自动重试。
- 有真实合成测试账号时，脚本核对匿名公开列表与私有表拒绝、无/假 JWT 的 Edge 401、A/B 各自真实密码登录、`auth/v1/user` 签名会话、不同用户 ID、带用户 JWT 的公开查询与私有表拒绝、Edge GET 应返回 405（网关接受有效 JWT，handler 在认证前拒绝 GET，不扣写预算）。**这是只读 JWT/网关身份检查，不是业务写入、管理员、OAuth 或两连接竞争验收。**
- 新增 `scripts/test-community-auth-smoke.mjs`：**5/5** 本地保护和模拟 HTTP 测试通过，确认缺凭证阻断、错误目标拒绝、请求次数、模拟双用户身份及不回显敏感值；**真实 HTTP Auth 0 次，当前结论 BLOCKED**。此前 38/38 验收入口保护与 42/42 PGlite SQL 本轮重新通过，TypeScript 检查通过；全量 Vitest 在 WSL 使用 Windows `node_modules` 时因缺 Linux Rollup 可选二进制而未能运行，不能记为断言失败或成功，未重装依赖。
- 继续前，在**专用测试项目**后台通过官方 Auth 管理功能准备两个独立已确认的合成用户，凭证仅在本机临时运行环境输入，不向聊天或 Git 发送。运行只读真实验收后，再单独执行有界业务写入/并发验收。因为 Supabase 组织曾触发流量宽限警告，不运行循环重试、负载测试或公网限流探测；M3 社区公开发布继续 **NO-GO**，不得推送 GitHub 或修改非专用项目。


## 2026-11-01：Edge Function 专用测试项目部署（最新）

- 仅使用已获准的新建非生产项目 `glyphforge-m3-test`；`community` Edge Function **v1 ACTIVE**，配置 `verify_jwt=true`，没有部署 GitHub Pages，也没有修改其他 Supabase 项目。
- 从本独立 worktree 的 `supabase/functions/community/index.ts` 与生成的 `validator.js` 部署。由于新项目默认提供 `SUPABASE_PUBLISHABLE_KEYS`（JSON 名称 `default`），Edge 入口优先使用已有 `COMMUNITY_PUBLISHABLE_KEY`，否则读取官方内建 publishable key；保留 legacy anon 兼容。特权凭证仍仅来自 Edge 内建 `SUPABASE_SERVICE_ROLE_KEY`，未获取、硬编码、输出或上传密钥到 Git。
- Deno 2.9.6 对入口的 `check` exit 0，handler fixture 测试 **1/1** 通过（改为模拟云端内建 publishable key）；此项不计真实 Auth 验收。
- **真实 HTTP 有界负向探测（云端）**：无 Authorization 的 Edge POST 为 401；伪造 JWT 为 401；本地允许 Origin 的 OPTIONS 为 204，非法 Origin 为 403；匿名公开 profiles 为 200；匿名读取私有 usage_events、直接调用写 RPC 和直接 INSERT 方案均为 401。所有探测仅测试状态码且未写入业务数据。函数部署检查：ACTIVE / v1 / verify_jwt=true。
- **尚未完成**：有效 Supabase Auth 用户 JWT 抵达 handler 的运行时确认、两真实用户的发布/点赞/统计/举报、两个独立数据库会话的业务写入并发、GitHub OAuth/PKCE、平台读/认证/Edge 频控与费用监控；不得将匿名 401、REST ACL 或 fixture 测试冒充真实登录端到端通过。未公开发布，M3 继续 CONDITIONAL GO / 公网 NO-GO。
- 后续接入前必须在本**专用测试项目**建立有确认权限的合成测试账号，并在受控环境内获取真实 Auth JWT；不得读取/复用用户邮箱或其它项目账号，也不能把 service_role 或私钥当浏览器用户。没有账号会话时停止，不伪造 JWT 或打开匿名注册绕过。


## 2026-11-01：专用 Supabase 云端数据库初验（最新）

- 仅针对新建、独立、非生产的 `glyphforge-m3-test`（新加坡；PostgreSQL 17.11）。未触碰原有 Supabase 项目，没有 GitHub remote/push、页面部署、OAuth 或 Edge Function 部署。
- 从本 worktree 原有两份 SQL 原样执行并成功：`20261101091101_community_platform.sql`、`20261101114038_community_storage_budget.sql`。连接器记录的实际迁移版本分别为 `20261101150127` 与 `20261101150140`，迁移名为 `community_platform` 与 `community_storage_budget`；版本号与仓库文件名前缀不同，不能假称一致。
- 云端 10 张社区表全部启用 RLS。公开 6 表的匿名与 authenticated 直接 INSERT/UPDATE/DELETE GRANT 均拒绝；`community_write` 只授予 service_role。Supabase Security Advisors 有 5 条 INFO（私有预算/审核表和原始事件表无读策略、按设计默认拒绝），并无已报告的高危提醒；空库 10 条 unused index INFO 暂不作为优化结论。
- **真实托管 PostgreSQL + pgTAP 30/30 通过，失败 0**。首次 29/30，第 30 项将角色切回 anon 后没有清除同事务遗留的作者 JWT sub，因而错误看到作者可见行；补空 JWT claim 后在同一云端库重跑 30/30。仅修复测试身份隔离，未放宽 RLS/写 GRANT 或修改业务 SQL。全部虚拟 Auth 用户、方案和事件均在测试事务结束回滚，复核六张公开业务表及三个虚拟 Auth ID 均为 0，pgTAP 扩展未永久安装。
- 为支持连接器生成的迁移版本并避免 pgTAP 永久安装需求，`scripts/community-acceptance.mjs` 只读预检改为接受既有文件版本或两个明确的迁移名称，并检查 `pg_available_extensions`；云端预检对应查询显示迁移 2、RLS 6、pgTAP available。原有入口保护测试 **38/38** 通过（无真实 psql 连接）。
- **仍为 M3 本地 CONDITIONAL GO，公开发布 NO-GO。** 此次验证为托管 PostgreSQL 的数据库内角色/claim 模拟，不是经 Auth 颁发 JWT 的端到端 HTTP/RLS 验证。真实账号注册与登录、Edge 身份验证、GitHub PKCE、两个独立连接的业务写入并发、平台级匿名读取/Auth/Edge 频控、数据保留/账户删除、生产资源与费用监测仍需单独验收。安全扫描和 CI 必须在任何 GitHub 推送之前重跑。现有项目只用于隔离测试，不可直接公开前端。


## 原生 PostgreSQL 增量复核（2026-11-01 21:40，Asia/Shanghai）

基线 `codex/m3-community @ df6e753`；已核对本目录 `.git` worktree 指针、分支/HEAD/status，无适用 AGENTS.md。未操作原 M2 工作目录。以下为上次实测记录；本次仅复核原始证据与停止状态，未重新编译、启动或运行社区业务测试。**普通 PostgreSQL 的锁等待与迁移失败原子回滚已实测；Supabase 前置条件缺失不构成产品 SQL 错误，也不构成社区验收通过。M3 本地 CONDITIONAL GO，公开发布 NO-GO，M2 本地 RC GO 不变。**

实测开始时 Windows/WSL 没有既存 PG/容器。复用 WSL 已有 GCC 15.2 / make 4.4.1，以 UID 1000 从 [PostgreSQL 官方 15.19 源码](https://ftp.postgresql.org/pub/source/v15.19/)编译到 WSL 用户目录 `$HOME/glyphforge-m3-realpg-NZwYMRY5/runtime`；下载完整后与发行者 `.sha256` 核对，SHA-256 为 `e1a64a87a46b825b88c082e4518161a47aab53c45694964f8ba1df28f7859f89`。仅用户目录 `--prefix`，关闭 readline/zlib 可选依赖；未 apt、提权、安装服务、改全局 PATH 或触碰云项目。[官方源码构建说明](https://www.postgresql.org/docs/15/install-procedure.html)。

| 上次实际执行 | 结果与严格范围 |
|---|---|
| 空实例与最小账户 | PG **15.19**，仅 `127.0.0.1:52195`、私有 Unix socket；新库 `m3_acceptance`、TCP SCRAM 登录 `m3_probe`，无 superuser/CREATEROLE/BYPASSRLS。随机密码只在进程内存/子进程环境，未输出或落日志 |
| 双独立 psql 与原迁移事务 | PID **46700 / 46704**。会话 1 暂停在原主迁移第一条 CREATE SCHEMA 后，会话 2 执行同一原迁移；实际 `pg_blocking_pids(46704)=[46700]`、`Lock/transactionid`。会话 1 继续后因缺 `anon`（42704）失败并解锁，两会话均回滚，无私有 schema/公开表残留。**这是迁移失败回滚验收，不是业务提交竞争** |
| 两份原迁移 / 既有 pgTAP | 主迁移缺平台角色；容量迁移缺 `community_private`（3F000）；pgTAP 扩展不可用（0A000，psql exit 3），**0/30 断言执行**。`auth.users/auth.uid()` 同样不存在；未补假 Auth、角色或 claim |
| 最小账户负向权限 | 实际读取 `pg_authid`、CREATE ROLE 均 42501；没有创建目标角色。此结果只证明测试账户隔离，不能代替社区 GRANT/RLS |
| 收尾与失败保留 | 两次实例均正常 stop，`pg_ctl status` exit 3、无 postmaster.pid；仅删除本轮新数据目录。首轮探针错误地预期 SQL 错误后仍持锁，未捕获等待，exit 1；保留 attempt1 后将暂停点前移至错误之前，attempt2 exit 0，未改产品 SQL 或隐藏失败 |

非敏感证据位于仓库外 `%TEMP%/glyphforge-m3-realpg-b068e2b6b0a841ab939bff0a5f991590/`：`attempt1/summary.json` 与 `attempt2/summary.json` 均已重新确认存在；后者记录 `full_community_acceptance=false`、`real_supabase_jwt=NOT_RUN`。同目录保留两会话、容量迁移、pgTAP、停止及来源校验日志和探针。已重新计算源码归档 SHA-256，与上述值一致；两份 stop 日志均为正常停止。本次只读复核 `52195/60057` 均拒绝连接（errno 111），两份临时数据目录均不存在，与 summary 的停止标记相符；没有重建实例。源码/运行时仍留在用户临时目录，未重复运行既有 mock、Vitest、Chromium 或基准。

上次 Gitleaks **8.30.1** 全 refs 历史/提交消息/索引/工作区（含未跟踪、忽略项及既有 dist/Actions）exit 0，0 未处理命中，结果为同证据根目录 `security-final.json`；原两条逐行 SHA 误报豁免未改。本次按原 `old-evidence-before.json` 重算旧未跟踪证据，**57 文件 SHA-256 全部不变**。新增内容去除个人绝对路径，不含密码、token、凭证连接串或账号隐私；本次完整扫描与提交保护结果见下方交接记录。

**未验证**：社区点赞/事件幂等与版本提交竞争、业务预算/快照回滚、社区 RLS/GRANT、真实 Supabase JWT/PostgREST/Edge/OAuth、平台读取/认证/函数限流与费用边界。普通 PG 的 SCRAM 数据库登录不等于 Supabase JWT；[Auth 由独立服务签发和验证 JWT](https://supabase.com/docs/guides/auth/architecture)。软删除仍保留快照；自动保留期、用户物理删除、停写开关竞争和平台应急尚未验收，不能因本轮 PG 可运行而解除发布阻断。

下一步只需一个授权决策：**是否允许新建一个专用、可销毁、非生产 Supabase 测试项目**，供既有入口完成真实服务验收；未获授权前停止，不借用账户里其他项目，不配置 OAuth 或公开部署。

本次交接完整执行现有 Gitleaks 8.30.1：全 refs、提交消息、索引、含忽略/未跟踪项与 dist/Actions 的工作区，进程 exit 0、0 未处理命中、0 禁止跟踪文件；仅原两条逐行摘要匹配的 SHA 误报。扫描脱敏 summary 与提交前字节清单保存在仓库外 `%TEMP%/glyphforge-m3-handoff-hql3wwdt/`。提交白名单仅本文件；其余 **1042 个已跟踪文件**、旧未跟踪 **57 文件**及非目标分支 SHA 受前后校验保护。首次提交因未配置 Git 身份退出 128、未生成提交；独立运行既有完整 hook 已通过。后续仅命令级复用 HEAD 的既有 Codex 自动化身份，并通过 `-c core.hooksPath=.githooks` 启用仓库 hook（默认 hooks 目录无 pre-commit），不写全局或共享 Git 配置；扫描、白名单或保护校验失败即不提交。核心代码、SQL、发布逻辑及旧证据不变；本次云端连接/请求为 0。

## 前次上线准入复核（2026-11-01，Asia/Shanghai；历史实跑）

基线 `codex/m3-community @ 591195e`。本节记录 `df6e753` 提交前的隔离入口、pgTAP 权限断言及 CI 本地保护实跑，不是本次重跑；本次只整理接入说明，原有实跑结果保留。**本地有界 CONDITIONAL GO；公开发布继续 NO-GO。** 无 remote；未登录、选择或修改任何云项目，未部署、推送或设置 OAuth。

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

### Supabase 一次性接入说明（isolated acceptance；待授权）

本次云端请求 **0**。以下为单次验收的接入顺序；详细 HTTP/双会话断言沿用下一节，不新增产品实现。`scripts/community-acceptance.mjs` 无新依赖，只调用已有 PostgreSQL 15+ `psql`；缺参数即退出 1，不读取 `.env`、Supabase link、存储的 CLI 登录或账户列表来发现目标。客户端须支持 TLS；本次原生 PG 安装本身不能替代 Supabase 服务或云端客户端准备。

1. **只在明确获准后新建一个全新、独立、可销毁、非生产 Supabase 测试项目**，核对并记录唯一 project ref、API origin、数据库端点、服务版本与销毁范围。已有未知用途项目一律禁用；改 manifest 标签不能证明隔离。创建项目的授权不自动授权 GitHub 仓库、push、公开前端部署或外部 OAuth 配置。本轮不创建或修改云资源，不安装 Docker、不变更系统服务。
2. 在该精确目标上，核对当前供应商迁移工具/CLI `--help` 后，依次原样应用 `20261101091101_community_platform.sql`、`20261101114038_community_storage_budget.sql`，保留真实迁移记录；不得手工伪造记录。通过供应商启用 [pgTAP](https://supabase.com/docs/guides/database/extensions/pgtap)，核对平台原生 `anon/authenticated/service_role`、`auth.users/auth.uid()` 与 RLS/GRANT。缺依赖即停止，不造假 Auth/角色、不放松权限、不改迁移让普通 PG 过关。
3. **先保持社区表为空、运行下方预检与 30 项事务回滚 pgTAP，再准备真实账号**。成功仅为 `PASS_DATABASE_ONLY`。随后在已授权范围内部署仓库原样 `community` Edge/config，准备普通账号 A/B 加独立审核员 M（3 个合成账号），审核资格只经私有表受控设置。使用合成方案，不上传用户创作/姓名/邮箱；再执行下一节 JWT/Edge/业务双连接与 OAuth/频控断言，逐项保留通过/失败/未执行。

所有密码、key、JWT、refresh token 与 OAuth secret 只进安全运行时环境或供应商控制台；不进 Git、`.env`、`VITE_`、命令参数、日志、HAR/trace、浏览器或前端构建。运行时输出只含用例编号、状态、计数与脱敏目标标识；关闭自动重试/自动刷新，禁止 dump 环境。Manifest 无凭证；预检不创建环境、不迁移、不创建账号、不写审核员私有表、不安装 pgTAP。

在仓库外保存绝对路径 JSON；以下 `REF` 须全部替换为本次新建并确认的 **20 个小写字母** project ref（占位符不能通过校验），列明所有已知生产 ref，确无生产项目才允许空数组：

```json
{
  "id": "glyphforge-m3-test-acceptance",
  "environment": "disposable-non-production",
  "dedicated": true,
  "kind": "cloud",
  "projectRef": "REF",
  "apiUrl": "https://REF.supabase.co",
  "database": { "host": "db.REF.supabase.co", "port": 5432, "name": "postgres", "user": "postgres" },
  "productionProjectRefs": []
}
```

采用供应商控制台给出的 direct 端点，或 `aws-N-REGION.pooler.supabase.com:5432` session pooler + `postgres.REF` 用户；不支持 transaction pooler 6543。[连接模式说明](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)。云端强制 `sslmode=verify-full`；必要时设置仓库外证书路径 `GLYPHFORGE_ACCEPTANCE_SSLROOTCERT`，不禁用证书验证。

```powershell
$targetFile = Join-Path $env:TEMP 'glyphforge-m3-target.json'
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

**单次硬上限（须在获准后由运行器计数；现有入口不实现 HTTP 预算）：**

| 类别 | 实际请求上限 |
|---|---|
| REST/RLS/GRANT 读取与拒绝矩阵 | 128 个 HTTP 请求 |
| Edge/JWT/业务与负向载荷 | 64 个 HTTP 请求 |
| Auth/OAuth 登录、刷新、退出、PKCE 负向项 | 48 个 HTTP 请求 |
| 平台频控 | 匿名列表、版本下载、无效 JWT Edge、Auth 登录四项，各最多 15 个，合计 60 个；每项含基线与窗口后恢复请求 |
| 合计与管理操作 | 测试最多 **300** 个 HTTP 请求；项目准备/检查/清理管理 API 最多另 **20** 个，总计 **320** 个；重定向、失败和重试均计数 |
| 数据库 | `--preflight` 1 次；`--db-tests` 自带只读预检 1 次及 pgTAP 脚本 1 次；业务仅 2 条独立持久连接，最多 200 条 SQL 命令（含 BEGIN/COMMIT/ROLLBACK/观察查询）；正式迁移仅 2 份原样应用，不重复运行 |

HTTP 常规串行，业务并发仅两连接；每请求超时 15 秒，双连接 statement/lock timeout 分别 30/10 秒，窗口恢复最多等待 60 秒。每类达到上限、断言失败、目标不符或用量告警即停，不自动重跑或提高额度；未覆盖项记未执行。平台阈值只有在供应商支持且授权范围内才能下调至 10 请求/60 秒以内；无法在每项 15 请求内验证 429/恢复就保持该门禁未验收，不能将业务预算 429 当平台防护。有效合成快照合计不超过 1 MiB，超大包负向仅一次、最多既定 1 MiB 上限加 1 字节；不做压力测试。

**清理范围：** 结束即关闭两连接/运行器、撤销测试会话并清除其环境变量。pgTAP 自行事务回滚；业务已提交的账号、审核资格、方案/版本、点赞、事件、举报、私有预算，以及 Edge 配置/日志等仅属于这个新项目。若授权包含销毁，核对同一 ref 后删除该专用项目整体清理，不以软删除充当物理清除，不 reset/清库/改任何其他项目。撤销本次专用 OAuth 客户端配置（若另获授权创建），清除专用测试浏览器会话（若存在）；仓库外仅保留无凭证、无邮箱、无载荷的 summary，其他凭证不曾落盘。源码/旧证据和本地历史不在清理范围。未获销毁授权则保持项目待处理并如实记录残留，不擅自删除。

已复核[官方 changelog](https://supabase.com/changelog)：记录测试项目实际服务补丁；PG/TLS 平台更新不构成修改产品迁移的理由。独立普通 PG 不具备完整 Supabase Auth/PostgREST/Edge 条件，安装成功不能解除任何真实服务门禁。

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

**真实 OAuth：** 仅在外部 OAuth 配置也获准后，于供应商控制台准备独立客户端，callback 精确为 `https://REF.supabase.co/auth/v1/callback`，redirect 白名单为精确允许的测试 origin/仓库子路径；secret 仅入供应商控制台。安全运行时校验真实 PKCE、旧 code 重放、缺 verifier、取消与非法 redirect，不能用 `?code=missing-test-code` 占位回调算通过。本次“凭证不得进入浏览器”约束下，不向浏览器注入 key/JWT 或运行会在浏览器保存 token 的前端登录；因此真实前端回调、刷新/退出、回调后离线刷新仍须记**未执行 / NO-GO**，运行时 PKCE 通过也不能替代它们。

**平台频控：** 严格使用上方四项各 15 请求的上限，断言真实 429、窗口后恢复、合法账号可用、用量/告警可观测及紧急停止。只读/未认证入口不受数据库每日写预算保护；Supabase 的[函数间调用限制](https://supabase.com/docs/guides/functions/recursive-functions)也不能证明公网入站 Edge 限流。没有相应平台控制能力即继续 NO-GO。


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
- 此历史版本的云端适配器使用固定 `@supabase/supabase-js@2.118.0`，包含 GitHub PKCE、会话恢复/刷新/退出和邮箱密码备用登录。当前云端界面已移除备用入口。未配置云端服务时仍可显式选择**本地演示**，账号、数据和计数在当前浏览器内模拟。
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
2. GitHub Provider 和正式站点回跳配置按本文顶部的 Free Plan 上线门禁执行。测试项目的合成账号只供受限验收脚本使用。
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
