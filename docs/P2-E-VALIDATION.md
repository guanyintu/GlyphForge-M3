# P2-E 验收：来源引用与组合元数据剪枝

日期：2026-10-31，Asia/Shanghai。基线 `e637beb4a5a6ed0d90e0612c8151e546b6c9f908`，分支 `codex/p2-e-lineage`。范围见 [架构](P2-E-ARCHITECTURE.md)。

**结论：CONDITIONAL GO，限最小纵向来源闭环与直接组合的纯元数据构造剪枝。** 最终检查如下；不把初轮或历史数字当最终结果。完整E3枚举级剪枝、执行估算和完整P2/v3.0未完成。

## 最终检查结果

| 检查 | 实际结果 / 证据 |
| --- | --- |
| 工作区完整 Vitest | **373/373，21文件**：[日志](p2-e/tests.txt) |
| typecheck / tsc -b / Vite build | 全部退出0：[退出](p2-e/check-exits.json)、[类型](p2-e/typecheck.txt)、[构建](p2-e/build.txt) |
| 引擎/资源/扩展/本轮基准 | **80/80，4文件**：[日志](p2-e/benchmark.txt) |
| 全量生产 Chromium | **50/50，无skip/flaky**：[最终全量](p2-e/browser-final-full.txt)、[JSON](p2-e/browser-final-full-results.json) |
| 证据恢复脚本修复后再验证 | 全量单元/类型/构建/基准和**3/3**本轮Chromium均退出0：[退出](p2-e/check-exits.json)、[浏览器](p2-e/browser.txt) |
| 精确索引隔离 | **362/362，20文件**，类型/构建均0：[日志](p2-e/isolated-tests.txt)、[退出](p2-e/isolated-exits.json) |
| 隔离生产Chromium | **3/3**本轮 + **5/5**旧P1-D：[本轮](p2-e/isolated-browser.txt)、[旧场景](p2-e/isolated-p1d-browser.txt) |

11项单元数量差为历史未提交P1最终审计测试。生产/测试源码共21个文件与精确索引快照匹配（仅换行规范化），5个验证helper另做语法检查：[源码匹配](p2-e/validated-source-match.json)。Node v24.22.1 / Chromium 156.0.8078.4 / Windows 10.0.26200；完整依赖版本见[环境](p2-e/environment.json)。沿用已有中文大chunk/静动态import警告，不称为包体优化。

## 验证范围

- 冻结旧惰性engine/operators，对旧实现 / 新实现关闭优化 / 默认开启做160组种子/版本差分，另测Unicode/空源/重复路径边界；比较原有全部Candidate字段、顺序、实际读取事件、步数和截断，新实现开关间还比较完整lineage。
- 逐个步数预算位置1～74、超长文字、取消、中文、Pair/members、嵌套子图、变异、扩展；真正IndexedDB中的两层动态DAG/Mapping/子图/扩展在3个固定种子×2个静态资源版本下与冻结旧动态适配器差分。
- 有界引用截断、非法/隐藏树导入拒绝、旧备份兼容、缺失父来源、旧记录不伪造路径；同名跨工作流/运行不覆盖收藏，S0-1保护及运行备份恢复；逆向executed/matched/inferred/unknown分层。
- 真实生产Chromium：选择结果→来源详情展开/复制→收藏→刷新→拒绝同名新运行覆盖→逆向证据→历史；生产Worker动态Mapping/子图/扩展→变异→导出→清空所有表→恢复→刷新；10k输出/百万逻辑组合有界前缀/8层子图/背压/并发取消及专用Worker堆采样。
- 旧P0～P2-D全量单元、Chromium、类型/构建、引擎和资源/扩展基准；旧库原生迁移和事务失败恢复、便携v1～v7继续由原专项执行。没有新增数据库版本。

## 真实失败与修复

新专项首轮11/14：[原始日志](p2-e/targeted-first.txt)。三处为夹具：简繁mode误写s2t（实际traditional），静态创建后版本已是2而非1，逆向类误写ReverseSearchService（实际ReverseSearcher）。纠正为真实参数、显式版本9与实际类名；没有删原断言。类型检查同时发现测试联合stats类型与Node process环境引用，改成正确RunStats类型并去掉无关Node堆记录。[第二轮14/14](p2-e/targeted-second.txt)，后来增加专项与差分。

首轮全量生产Chromium **49/50**：[日志](p2-e/browser-full-first.txt)、[JSON](p2-e/browser-full-first-results.json)。P1-D旧测试刷新后检查新运行的同名结果仍有旧收藏标志；本阶段明确按runId/workflowId区分，旧收藏实际上保留。断言改为刷新后进入收藏页检查原收藏，原即时收藏/筛选/复制/动画断言均保留；新增P2-E浏览器断言确认新运行同名收藏明确拒绝且原来源ID仍在。App原先吞掉具体错误仅显示“收藏保存失败”，本轮改为显示实际冲突说明。历史p1d其余未提交改动逐字保留，索引只含这一行独立差量。

全量产品检查50/50通过后，runner恢复最后一份旧worker-consistency证据遇到Windows UNKNOWN写入错误，父命令退出1。立即保存本轮文件并从字节基线恢复、核对SHA；没有留下旧证据被改写。helper现先落盘子检查退出，再对恢复写入短重试并记录未恢复错误；修复后完整单元/类型/构建/基准及3条浏览器再次通过，恢复错误为空。[故障与恢复](p2-e/evidence-recovery.json)、[全部旧证据哈希](p2-e/old-evidence-preserved.json)。首次暂存保护检查也因测试正在写旧证据而拒绝；先只构建源码索引，测试结束恢复后才完成严格核对及最终暂存，未绕过最终保护。

## 性能口径

本地Node24 / Chromium生产构建，具体命令、退出与浏览器UA由原始JSON/日志索引。六轮交替on/off的100×100拒绝组合，每输入16个来源片段：[最终基准](p2-e/benchmark.txt)。两侧均真实枚举，输出均0，**30304步完全相同**，开启时10000次纯来源构造省略。关闭/开启中位数为 **186.80 / 76.99ms（2.43×）**：[原始样本与汇总](p2-e/performance-summary.json)；不把单机夹具收益外推到全通过或IDB主导场景。

10k单元输出记录每条lineage最大168字符、合计1,680,000字符；这是本夹具JSON字符数（均ASCII），不是任意图的全结果体积上限。[生产Worker原始样本](p2-e/worker-performance.json)含10k/157批次、8层子图、百万逻辑组合前缀；并发任务终止后无迟到消息/写入，主任务仍成功。最新样本含启动/持久化消息耗时1183.3ms，引擎1130.9ms / 50085步；单条最大13引用、1929 JSON字符。Worker V8 10点采样最大usedSize=20709916字节。

Worker内存通过CDP `Target.attachToTarget`后对专用execution.worker目标采集 `Runtime.getHeapUsage`；usedSize是V8堆采样，包含GC波动，**不是Worker RSS、进程私有内存或绝对峰值**。rendererHeapEnd另列，不能充当Worker测量。没有穷尽百万输出或百万实体导入承诺；步数/10秒/输出上限仍有效。

时间限额/用户取消/外部资源变化取决于真实墙钟，优化可能改变期限前的部分结果；此类情形不声称完全等价。固定步数预算位置与诊断通过差分。

## Git保护与复现

起始604个非忽略路径完整字节备份至外部临时目录，175个历史modified/untracked路径：[SHA及归属](p2-e/baseline-summary.json)。本地baseline-local记录备份路径及binary worktree/index patch。新分支，无reset/clean/stash。主库db.ts旧关系冲突修复未改、未纳入提交。

状态仅提交新增P2-E节；p1d仅提交上述收藏身份断言，工作区其余历史文档、审计代码/测试保持。全量测试会写旧阶段证据，runner在finally恢复原字节，本轮stdout独存p2-e。[原文件保护](p2-e/original-files.json)、[索引归属及源码SHA](p2-e/git-isolation.json)由stage脚本核对。精确Git索引导出独立目录执行，不借用历史P1审计测试。

```powershell
node scripts/validate-p2-e.mjs             # 全量检查，含生产Chromium
node scripts/validate-p2-e.mjs --targeted  # 浏览器仅本轮3条，其余全量
node scripts/stage-p2-e.mjs                # 验证历史字节，按归属构建索引
node scripts/isolate-p2-e.mjs              # 精确索引单元/类型/构建
node scripts/verify-isolated-browser-p2-e.mjs # 独立4176端口，3条生产Chromium
```

## 未验收和接续条件

只交付本文件与架构定义的有界范围。估算区间、枚举级剪枝、AST内部语句/逐中间值、全部参数绑定展开、静态历史全集、多路径保留/多同名收藏迁移、动态内部剪枝计数汇总延期。来源摘要超32项会显式截断；32MiB运行导出超限会拒绝而不会丢来源。Firefox/WebKit、实物低端、Worker RSS/绝对峰值和历史G/Q剩余项目未测。下一步先针对真实高耗时图做收益分析，再选择一个可维持随机消费/计步/错误定位的前缀规则；当前不做压缩分享码、任意JS或通用优化器。
