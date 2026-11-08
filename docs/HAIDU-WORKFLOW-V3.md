# 海都工作流 v3：方向纠正与验收

2026-11-08。用户最新要求：海都应当是 GlyphForge 的工作流，按原 Excel 五列流程实现，再优化；联网分享先关闭。本轮以该指令替代之前海都专用普通/编辑页面的交付方向。

## 具体修正

- 移除海都专用侧栏入口、HaiduGenerator 组件、专属 CSS 和 Results compact 分支。
- 海都进入现有「从灵感配方开始」菜单，打开后就是原工作流工坊；节点、AST、NameScript、运行设置、预览、收藏、来源、历史和本地导入导出继续复用。
- 工作流有五个实际程序分支：单字前词+单字后词、单字前词+双字后词、双字前词+单字后词、小+双字、双字直出。
- 四个独立素材池实际驱动生成，不再是悬空素材节点。用既有动态资源/group 算子按种子有界抽样，四个抽样定义也能在资源中心编辑；program → curate → output 仍走同一执行器。
- 扩展通用 curate 节点的可选 reviewedResourceId：独立关系表用于评分与风格参考，不能凭空产生名字；保留原词库片段及实际读取的评分关系版本。单字组合与直接词库读取先发生，再去重排序。
- 新 v6 便携包包含五个静态资源和四个动态定义：320 双字核心、129 单字后词、65 单字前词、240 双字后词、1,267 条关系参考。旧 v1/v2 包仍能导入；旧编辑和收藏不被覆盖，旧 v2 页面提供打开新版副本的入口。

## 联网分享关闭

- 生产构建显式 GLYPHFORGE_ONLINE_SHARING=0；不显示社区广场，不路由到 OAuth 社区页面、不初始化 Supabase SDK、不自动上报运行或同步旧 outbox。独立客户端门禁在有云端配置和登录回跳的情况下也拒绝初始化。
- 已核对正式项目 glyphforge-m3-production / gallindmwjiwsitczjzu 的现有 community_private.control，仅将 enabled 从 true 改为 false，并另行读取确认 false。既有写函数带 Community writes paused 检查。没有删业务记录、账号、词库或收藏，没有改 schema、迁移、RLS 或 Auth。
- 本地 JSON、便携包、压缩分享码保持离线可用，面板明确为「本地导入与导出」。这是本机序列化，不是云端上传。
- 原社区功能代码与测试保留。测试环境可显式启用开关验证旧行为，生产默认及部署步骤均关闭；默认浏览器全集中的社区演示用例要求显式启用，不把停用配置下的跳过算成通过。

## 验证口径

本轮实际通过 436/436 Vitest（28 文件）、120/120 基准、完整生产 Chromium 72 项（含 7 项海都），3 项联网演示用例因关闭而跳过；另有 6/6 显式启用的旧社区浏览器通过。类型检查、tsc -b、生产构建、42 项嵌入式 SQL、38/38 guard、7/7 危险构建拒绝、6/6 扫描负向通过。完整冻结门禁归档在原工作区 docs/m2/full-1794142179787/exits.json，全部退出码为 0；浏览器 7.1 分钟。线上发布结果以本页后续记录和 PROJECT-STATUS 为准，不沿用上一轮的 440 单元或 8 项专用界面用例数。

专项覆盖五种实际形状与来源、四类素材参与、添加词条无需改关系即可产出、关系只评分、完整 v6 往返与资源重绑、旧 v1/v2 与收藏保护、固定种子、多样性、字数/包含/排除、继续抽取去重、普通编辑器入口、资源修改后真实 Worker 更新、手机布局、本地导出恢复和云端零请求。

已发现并保留真实失败：第一版断言把同名结果都要求标成直出来源，违反原执行器首路径去重；改为检验所有核心都存在，并保留真实首路径。包含过滤不能保证未抽中的后缀出现，改用确实在本轮可用的核心验证组合筛选。第一轮浏览器发现标题仍是旧文案，已改产品标题；手机状态行本来隐藏，改等待实际运行按钮，未放宽移动溢出与真实运行断言。

默认五列原始空间 3,840 项，本机模拟 IDB 全量执行约 0.43 秒、93,680 步，最终 3,836 唯一结果；真实 Chromium 的 24 项生成、持久化和 UI 约 1.40 秒。都是单机单次样本，不是 P95、RSS 或实物低端结论。

## 限制

- 抽样后的候选再接受筛选；包含条件未命中时可换种子或增大抽样数。更改静态池会重新计算动态定义，不保存候选缓存。
- 抽样池低于配置数量会明确失败，需要在资源中心减少抽样量；最多 10k 候选、300k 步/10 秒保护不变。
- 评分仍是启发式，真实玩家审读与撞名验证未完成；Firefox/WebKit/实物低端未测。
- 四字与叠字实验不加入本轮原表五列默认流程；旧 v2 与相应能力未删除。未将此次修正称为整份 v3.0 产品规划完成。

## 本轮修改文件

- 工作流和资源：src/core/haidu-workflow.ts、src/storage/haidu.ts、scripts/export-haidu-chao-ren.mjs、examples/haidu-chao-ren.catalog.json、portable.json、v2.portable.json、README.md。
- 原引擎中的可选关系评分绑定：src/core/curation.ts、operators.ts、contracts.ts、resource-catalog.ts、sharing.ts、src/components/GraphEditor.tsx、supabase/functions/community/validator.js。
- 既有界面与联网开关：src/App.tsx、src/components/Results.tsx、src/community/availability.ts、client.ts、src/vite-env.d.ts、vite.config.ts、.github/workflows/deploy-pages.yml；删除海都专用组件及 CSS。
- 验证：src/tests/haidu.test.ts、community-auth.test.ts、community-disabled.test.ts、e2e/haidu.spec.ts、community.spec.ts、m3-ui.config.ts；文档为本页、PROJECT-STATUS.md 和项目 README。

原参考 Excel 未上传。原工作区历史未提交修改保留；仅在原 M3 发布分支提交上述差量，未用 M2 覆盖 M3。

发布前 lint 通过，234 个冻结源指纹全部一致；Gitleaks 8.30.1 对所有 refs 历史、暂存区、含 dist 的工作区和提交消息均零未处理命中。首轮只命中完整门禁 source.json 中 13 个源码 SHA256，逐个与实际文件计算值核对后，将完整验收目录保留归档到原工作区（不发布测试指纹与日志）；没有新增忽略规则、删除证据或放松门禁。
