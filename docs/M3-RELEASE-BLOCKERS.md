# GlyphForge M3 上线阻断清单

2026-11-06（Asia/Shanghai）。**M3-C BLOCKED · M3-D BLOCKED · 公开上线 NO-GO**。项目证据来自 `glyphforge-m3-test`（`rsntccggnvmuazvpxstf`）已提交的同日只读核查。本次沿用该快照，平台能力以官方文档为准，实际配置未知的项目标为 UNKNOWN。

| 发布门禁 | 状态 | 证据与解除条件 |
| --- | --- | --- |
| Data API 匿名读取 | BLOCKED | 浏览器直连 PostgREST。RLS 限制可见行，客户端每页取 12 条。已有 SQL 会话和数据库角色设置均未查到 `pgrst.db_pre_request`。官方数据库写计数示例只覆盖写方法，GET/HEAD 使用只读事务。数据库网络限制覆盖 Postgres 和连接池。上线前须核实暴露面，验证匿名列表和快照下载的速率、体积和停用控制，包括项目直连地址。 [客户端](../src/community/client.ts) · [Data API 安全](https://supabase.com/docs/guides/api/securing-your-api) · [网络限制](https://supabase.com/docs/guides/platform/network-restrictions) |
| Auth 入口频控 | UNKNOWN | Supabase Auth 按端点限流。两个合成账号的真实登录已通过，项目实际阈值、密码登录防滥用和告警证据待核实。上线前核对 Authentication → Rate Limits，并验证所选公开登录路径的拒绝行为。 [Auth 限流](https://supabase.com/docs/guides/auth/rate-limits) |
| Edge 入口与调用计费 | BLOCKED | 已核查 `community` ACTIVE v1、`verify_jwt=true`。函数校验 Origin 和用户后才执行数据库 reserve。项目入口阈值未知。平台按函数调用计量，各响应状态均可计入，OPTIONS 免调用计费。上线前须验证项目直连地址的入口防滥用、告警和紧急停用。 [Edge 限流](https://supabase.com/docs/guides/functions/examples/rate-limiting) · [调用计费](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations) |
| 数据库 RPC 写入与容量预算 | PASS | UTC 日限为账号 240、全局 20,000。四次 UI 业务写各消耗一次 reserve 和一次业务扣减，实测全局加 8、两账号各加 4。另有发布数及快照日 2 MiB、累计 16 MiB 限额。Advisor 的 5 条 INFO 对应默认拒绝的私有表及 `usage_events`，客户端无业务写 RPC 执行权。 [迁移](../supabase/migrations/20261101091101_community_platform.sql) · [容量](../supabase/migrations/20261101114038_community_storage_budget.sql) · [读回](m3/ui-business-20261106/result.json) |
| 套餐、Spend Cap 和平台费用 | UNKNOWN | 既有管理核查未取得实际套餐、Spend Cap、用量或账单。Pro Spend Cap 按组织配额覆盖 egress、Edge 调用等指定项目。Compute、PITR、自定义域适用各自的计费规则。上线前核对组织 Billing 的实际开关、共享配额、费用与告警。 [费用控制](https://supabase.com/docs/guides/platform/cost-control) · [账单](https://supabase.com/docs/guides/platform/billing-on-supabase) |
| Leaked Password Protection | BLOCKED | 同日 Advisor 记录 1 条 WARN，泄露密码保护关闭。该保护可用于 Pro 及以上。公开使用密码路径前须启用并验证保护，若公开策略仅允许 OAuth，须验证密码入口已关闭。 [Advisor 记录](m3/ui-business-20261106/result.json) · [密码安全](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| GitHub OAuth / PKCE | UNKNOWN | 客户端启用 PKCE 和 URL 会话检测，按 `BASE_URL` 生成回跳地址。快照中 GitHub identity 为 0。Provider 开关、GitHub callback、Supabase Site URL 和 allowlist 待核实。上线前验证实际回跳、换码和异常回跳。 [客户端](../src/community/client.ts) · [GitHub Auth](https://supabase.com/docs/guides/auth/social-sign-in/auth-github) · [回跳地址](https://supabase.com/docs/guides/auth/redirect-urls) |
| 软删除、留存与账号注销 | BLOCKED | UI 软删除及读回通过，RLS 隐藏已删除方案，版本与相关记录可继续留存。应用缺少保留期和注销流程。方案与审核员外键可能阻止账号删除，点赞和事件级联需要核对聚合，JWT 可有效至到期。上线前明确内容、备份和日志留存，并验证会话撤销、关联数据处理和注销。 [迁移](../supabase/migrations/20261101091101_community_platform.sql) · [用户管理](https://supabase.com/docs/guides/auth/managing-user-data) · [备份](https://supabase.com/docs/guides/platform/backups) |
| 本地 GitHub Actions | PASS | 唯一工作流由手工或 PR 触发，权限为 `contents: read`，产出 `pages-candidate-NOT-RELEASED`，无部署 job。 [工作流](../.github/workflows/pages-preview.yml) |
| 远端 GitHub Pages / CI | UNKNOWN | 本地无 Git remote。远端 Pages 发布源及其他自动化待核实。公开发布需另行授权。 [Pages 发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) |

真实 UI 闭环为 **PASS**，28 次 HTTP 含 11 次 OPTIONS，4 次业务写，1 条新方案已软删除。托管双会话并发为 **NOT_RUN**，8/8 来自隔离本地 PostgreSQL。 [浏览器与 SQL 读回](m3/ui-business-20261106/result.json) · [本地并发](m3/http-ui-20261106/local-concurrency.json)
