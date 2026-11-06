# GlyphForge M3 上线阻断清单


## 生产项目初始化（2026-11-06）

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| Free 生产项目 | PASS | glyphforge-m3-production / gallindmwjiwsitczjzu，新加坡，ACTIVE_HEALTHY，创建报价 $0/月。 |
| 测试项目暂停 | PASS | glyphforge-m3-test 已暂停并保留数据；后续验收前须恢复。 |
| 数据库迁移 | PASS | 两份社区迁移已应用；6 张 public 表全部启用 RLS，客户端写授权为 0。 |
| Edge Function | PASS（部署） | community v2 ACTIVE，verify_jwt=true；GitHub Pages Origin 的 OPTIONS 预检 204。真实 Auth 与业务请求尚未验收。 |
| 生产构建 | PASS（CI + Live） | .env.production.local 被 Git 忽略；CI 子路径构建通过，最终产物扫描通过；线上 HTML 与 4 个静态资源均 HTTP 200，未包含 service-role 配置。 |
| GitHub 仓库与 Pages | PASS | 公开仓库 guanyintu/GlyphForge-M3，默认分支 main；Pages workflow run 42243418707 成功，站点与 4 个静态资源均 HTTP 200。 |
| 生产 GitHub OAuth | BLOCKED | 正式项目 Auth settings 实测 github=false、email=true。待创建 OAuth App，在生产 Supabase 启用 GitHub Provider，并设置 Site URL / Redirect URLs；真实 PKCE 尚未运行。 |

详见 [生产环境初始化记录](M3-PRODUCTION-DEPLOYMENT.md)。

2026-11-06（Asia/Shanghai）。**静态站点部署 PASS · M3-C 生产 OAuth BLOCKED · 完整社区上线 PARTIAL**。GlyphForge M3 已公开部署到 GitHub Pages；云端社区 GitHub 登录尚未启用，平台级限流、费用和留存审查仍待完成。

| 发布门禁 | 状态 | 证据与解除条件 |
| --- | --- | --- |
| Data API 匿名读取 | BLOCKED | 浏览器直连 PostgREST。RLS 限制可见行，客户端每页取 12 条。已有 SQL 会话和数据库角色设置均未查到 `pgrst.db_pre_request`。官方数据库写计数示例只覆盖写方法，GET/HEAD 使用只读事务。数据库网络限制覆盖 Postgres 和连接池。上线前须核实暴露面，验证匿名列表和快照下载的速率、体积和停用控制，包括项目直连地址。 [客户端](../src/community/client.ts) · [Data API 安全](https://supabase.com/docs/guides/api/securing-your-api) · [网络限制](https://supabase.com/docs/guides/platform/network-restrictions) |
| Auth 入口频控 | UNKNOWN | Supabase Auth 按端点限流。测试项目的两个合成账号通过了历史密码登录验收。上线前核对正式项目的 Authentication → Rate Limits、告警和公开 OAuth 路径的拒绝行为。 [Auth 限流](https://supabase.com/docs/guides/auth/rate-limits) |
| Edge 入口与调用计费 | BLOCKED | 测试项目历史为 community v1；新生产项目现为 community v2 ACTIVE、verify_jwt=true，GitHub Pages Origin 的 OPTIONS 预检为 204。函数校验 Origin 和用户后才执行数据库 reserve。生产项目入口阈值、告警和紧急停用仍未知。平台按函数调用计量，OPTIONS 免调用计费。上线前须验证项目直连地址的入口防滥用、告警和紧急停用。 [Edge 限流](https://supabase.com/docs/guides/functions/examples/rate-limiting) · [调用计费](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations) |
| 数据库 RPC 写入与容量预算 | PASS | UTC 日限为账号 240、全局 20,000。四次 UI 业务写各消耗一次 reserve 和一次业务扣减，实测全局加 8、两账号各加 4。另有发布数及快照日 2 MiB、累计 16 MiB 限额。Advisor 的 5 条 INFO 对应默认拒绝的私有表及 `usage_events`，客户端无业务写 RPC 执行权。 [迁移](../supabase/migrations/20261101091101_community_platform.sql) · [容量](../supabase/migrations/20261101114038_community_storage_budget.sql) · [读回](m3/ui-business-20261106/result.json) |
| 套餐、Spend Cap 和平台费用 | PARTIAL / UNKNOWN | 已确认组织为 **Free Plan**，正式社区沿用该套餐。Spend Cap 仅适用于 Pro。Free Plan 的免费配额有限，超限可能导致服务受限或项目暂停。上线前需核对实际 egress、Edge 调用、Auth MAU、数据库用量和余量。 [费用控制与 Spend Cap](https://supabase.com/docs/guides/platform/cost-control) · [账单与 Free Plan](https://supabase.com/docs/guides/platform/billing-on-supabase) |
| 正式项目关闭密码登录 | BLOCKED | 正式 Auth settings 实测 github=false、email=true。云端 UI 已移除密码入口；服务端仍须在正式项目的 GitHub OAuth/PKCE 验证通过后关闭 Email/Password Provider。关闭后验证 GitHub 登录、会话刷新、登出、RLS 和密码登录的服务端拒绝。 [Advisor 记录](m3/ui-business-20261106/result.json) · [密码安全与套餐要求](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| 真实 GitHub OAuth / PKCE | **NOT_RUN** | 客户端 PKCE、基于 BASE_URL 的回跳、失败提示、会话刷新和登出已通过本地模拟。生产 callback 为 https://gallindmwjiwsitczjzu.supabase.co/auth/v1/callback；GitHub OAuth App、Provider、Site URL 和 Redirect URLs 待完成。 [验收说明](M3-COMMUNITY-READINESS.md) · [GitHub Auth](https://supabase.com/docs/guides/auth/social-sign-in/auth-github) · [回跳地址](https://supabase.com/docs/guides/auth/redirect-urls) |
| 软删除、留存与账号注销 | BLOCKED | UI 软删除及读回通过，RLS 隐藏已删除方案，版本与相关记录可继续留存。应用缺少保留期和注销流程。方案与审核员外键可能阻止账号删除，点赞和事件级联需要核对聚合，JWT 可有效至到期。上线前明确内容、备份和日志留存，并验证会话撤销、关联数据处理和注销。 [迁移](../supabase/migrations/20261101091101_community_platform.sql) · [用户管理](https://supabase.com/docs/guides/auth/managing-user-data) · [备份](https://supabase.com/docs/guides/platform/backups) |
| 本地 GitHub Actions | PASS | deploy-pages.yml 已推送；固定 SHA Actions，包含 Gitleaks、422 Vitest、38/38 acceptance guard、6/6 M3 Playwright、生产构建及最终扫描。 |
| 远端 GitHub Pages / CI | PASS | Workflow run 42243418707 完成成功；生产 HTML 与 4 个 JS/CSS 资源均 HTTP 200。 |

静态站点已公开部署，但生产 Auth settings 仍为 GitHub disabled / Email enabled；真实 OAuth 未验收，故云端社区登录尚不能使用。历史测试项目的密码登录和真实 UI 业务闭环为 **PASS**，28 次 HTTP 含 11 次 OPTIONS，4 次业务写，1 条新方案已软删除。本次未重跑云端写入。托管双会话并发为 **NOT_RUN**，8/8 来自隔离本地 PostgreSQL。 [浏览器与 SQL 读回](m3/ui-business-20261106/result.json) · [本地并发](m3/http-ui-20261106/local-concurrency.json)
