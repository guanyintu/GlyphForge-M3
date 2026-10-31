# P2-F 验收：真实瓶颈、只读估算和纯计算复用

日期：2026-10-31，Asia/Shanghai。基线 `9f4087a82de4b284d022ebf7d3e6af0c346701e4`，分支 `codex/p2-f-performance`。实现/证据提交：`7af6379f15eba14b430d9377d87d543fd8cf30db`。契约和证明见 [架构](P2-F-ARCHITECTURE.md)。

**结论：CONDITIONAL GO，限只读规模/风险估算和两条纯计算复用；枚举次数优化 NO-GO。** P2-E 的高级剪枝条件未解除；完整 P2 和 v3.0 未完成。没有压缩分享码、任意 JS、网络插件或社区功能。

## 检查与证据

最终检查全部通过；[全量退出记录](p2-f/full-exits.json) 和 [完整日志](p2-f/full-browser.txt) 保留原始命令、退出码及失败后的重跑结果。

| 检查 | 范围 / 证据 |
| --- | --- |
| 全量 Vitest | 383/383，22 文件：[日志](p2-f/full-tests.txt) |
| 类型 / tsc -b / Vite build | [退出](p2-f/full-exits.json)、[类型](p2-f/full-typecheck.txt)、[构建](p2-f/full-build.txt) |
| 引擎 / 资源 / 扩展 / 来源 / 估算基准 | 90/90，5 文件：[日志](p2-f/full-benchmark.txt) |
| 全量生产 Chromium | **53/53，无skip/flaky**：[最终日志](p2-f/full-browser.txt)、[JSON](p2-f/full-browser-results.json) |
| 加强专项 Chromium | 3/3：[日志](p2-f/targeted-browser.txt)，不是全量替代 |
| 精确暂存索引隔离 | **372/372，21文件；类型/构建退出0；3/3本轮Chromium**：[退出](p2-f/isolated-exits.json)、[单元](p2-f/isolated-tests.txt)、[浏览器](p2-f/isolated-browser.txt) |

隔离与工作区的11项差额来自未提交的历史P1审计测试，原 db.ts 用户修复亦未纳入索引；没有把工作区383项冒充纯提交源码检查。

本轮增加 10 个单元测试，其中一条执行 192 组生成种子/7种资源版本的四路差分。覆盖随机 group、concat/pattern/filter、子图、Unicode 字符簇接缝、重复路径、notes、parts/version、Pair/members/lineage、全部字段、首路径去重、读取事件、步骤、截断。冻结实现 / 关闭 / 开启逐字段一致；P2-E 前版本仅剥离其尚无的 lineage 字段。1–120 步预算位置逐一比对诊断，文字超限仍在 mix 节点；取消保留错误位置。旧来源专项的 160 组种子与动态 DAG/Mapping/子图/扩展版本差分也全部继续执行。

估算验证：BigInt 超 Number 精度范围、精确静态数量、空静态、非法 count、动态 count=0 不当空源、输出 limit 不当枚举限额、缺失/循环/禁用包/Mapping 更新、取消读元数据、第二次快照不一致拒绝、12 层通过/13 层拒绝。用拒绝扫描的 spy 证明不调用实体表扫描和全资源 toArray。浏览器另验证跨编辑标签页资源变更自动重算、运行中版本变更报错、独立并发任务终止无迟到消息/写入、生产逆向 Worker 缓存 miss→hit→版本变化 miss。

旧 schema7/运行/收藏、v1–v7 便携包、S0-2 的预算/错误/空库类型、P2-A/B/C/D/E 与来源面板均沿用原全量单元及生产 Chromium 回归。本轮没有新增 schema、全局 Entry 或第二套执行器。

## 性能与实际瓶颈

原始 [Worker P2-E 基线](p2-f/worker-baseline.json) 在新复用规则之前测量；[本轮样本](p2-f/worker-full.json) 包括优化 on/off 六轮交替，每侧六样本、3种种子各重复2次，另每图一轮带分阶段计时的样本。只有 profile=false 样本用于墙钟比较。并列引擎时间和 Worker 启动至 done 的墙钟，后者还含终态与历史留存清理。全部保留实际慢样本，不挑最快值。汇总在 performance-summary.json 归档。

| 场景 | off/on 墙钟中位 ms | off/on 观测P95 ms | off/on 引擎中位 ms |
| --- | --- | --- | --- |
| heavy-reject-full | 1109.3 / 1026.4 | 1264.9 / 1066.9 | 1081.1 / 994.2 |
| three-source-reject-full | 2208.4 / 2220.0 | 2437.4 / 2661.3 | 2182.9 / 2181.8 |
| pattern-reject-full | 380.5 / 342.8 | 402.9 / 371.4 | 353.2 / 313.4 |
| concat-reject-full | 362.9 / 334.5 | 369.7 / 349.5 | 335.0 / 306.3 |
| tenK-output | 954.0 / 981.9 | 1007.6 / 1082.4 | 927.1 / 955.0 |
| million-prefix | 307.5 / 61.4 | 621.2 / 617.3 | 22.4 / 23.9 |
| dynamic-mapping-extension-depth12 | 339.5 / 579.6 | 582.7 / 592.1 | 18.5 / 19.6 |
| mutation-unicode | 52.3 / 51.9 | 54.8 / 57.9 | 23.7 / 23.1 |

40k完整拒绝图引擎吞吐中位（off/on）为 37002 / 40234 组/秒；10k输出含持久化墙钟吞吐为 10485 / 10192 项/秒。该表受留存状态干扰，尤其前缀/动态场景的墙钟比例不能作为优化收益；三词库尾样本、全输出和变异亦可能变慢。完整阶段计时和条件见 [汇总](p2-f/performance-summary.json)。

P2-E单独基线 on/off 中位数：pattern-reject-full 794.9/697.6 ms；concat-reject-full 656.4/592.5 ms；tenK-output 1606.7/1608.6 ms。全通过场景没有稳定收益，不能泛化为通用加速。

这些夹具使用生产 Worker 自己建立 run 的入口，Worker 内执行留存；工坊 managed-run 的留存由 App 执行。此处 done 墙钟不是工坊首结果呈现延迟，后者未单独采样。

- 真实 100000 实体词条以1000条分批写入 IndexedDB；另有 100/100/10/200/200 实体源。不是把虚拟 reader 数量冒充实体导入。
- 200×200 **40000 组完整枚举**，161206 步，0输出；三词库图 **10000 组完整枚举**，47607 步，0输出。100×100 pattern/concat 全拒绝均 40606 步，不只消费前60条。
- 全通过 **10000 输出、157批持久化**，50606步。百万逻辑组合图明确仅输出60项，实际291步、构造61个组合用于确认截断；**不是百万输出穷尽**。
- 两层动态 DAG + Mapping + 扩展 + 12层子图实际10项/229步；变异 Unicode/锁定/Pair父输入图实际34项/6180步。每侧的完整 Candidate JSON（除新 runId）即时逐字段比较后保存 SHA256，开关间步骤相等。

加强专项的阶段计时示例（最终全量样本另存，不混称同一次）：40k拒绝图引擎1072.6ms，其中 readInclusive743.3ms、filter253.9ms、text10.5ms、lineage7.9ms。三词库图引擎2167.7ms，readInclusive2034.0ms；10k输出图引擎992.1ms，其中批次持久化568.1ms、资源读取297.4ms、消息入队11.7ms。它们显示数据库往返和输出写入主导，不能把所有时间归到“枚举算术”。

留存阈值同样是真实成本：加强专项某60项前缀样本引擎55.5ms、墙钟616.3ms，其中历史清理489.1ms。交替生成新 run 时两侧可能恰好清理不同规模的旧运行，因此端到端 on/off 比例会受留存历史状态影响。**不能把这类偶然差异归功于纯计算优化**；引擎时间、持久化和清理计时分开提供。没有为好看数据关闭留存或隐去慢样本。

P2-E 基线的 on/off 只包含其元数据省略规则，用来单独判断既有收益；新增 F 规则的等价性由冻结 E 实现四路差分证明。新规则只是模板索引和引用字符串复用，没有宣称独立显著墙钟加速。拒绝率低、parts少、I/O及留存主导的图可能不变或变慢。

每次生成新建 Worker，模块/运行缓存冷，IDB/OS 缓存可能热；没有清磁盘缓存，不称为严格磁盘冷热对照。生产逆向 Worker 的同实例三次请求另见 [并发与逆向](p2-f/concurrency-reverse.json)；大库逆向还由旧100k生产 Worker 专项重跑。带计时的动态 readInclusive 包含内部计算，不能与其内部 text/lineage相加；剩余时间包含迭代器、tick、验证、调度和计时开销，不冒充精确枚举 CPU 自耗时。

专用 Worker V8 heap 由原 lineage 生产浏览器专项在本轮重新 CDP 采样，归档在 replayed-full-docs_p2-e_worker-performance.json。Renderer heap 单独保存在本轮 Worker 报告和旧动画专项重跑记录中，**两者均不是 RSS 或绝对峰值**。本轮9点采样 Worker usedSize 最大 17698556 字节，同次 Renderer 结束采样 25679621 字节。未测 Worker RSS/实物低端/Firefox/WebKit。n=6 的观测 P95 使用 nearest-rank，等于这六个样本最大值，不外推总体尾延迟。

## 真实失败

1. 首次类型检查发现计时函数 record 与已有 run record 变量重名、generator.return 参数及测试 PromiseExtended 类型不符，修正类型和命名后再验收。一次本地 Python helper 忘记指定 UTF-8 读取而失败，未写文件；改为显式 UTF-8。
2. 初次浏览器模块语法检查发现 SHA256 夹具多一个括号；[原始失败](p2-f/attempt-1793458543423-baseline-browser.txt)。后续基线真实 Worker 性能测试通过，UI夹具因选了无关资源失败：[基线日志](p2-f/baseline-browser.txt)。
3. 估算单元初次误以为 resourceWorkflow 默认 limit=200，实际为10000；修正为真实默认，未改变估算器：[日志](p2-f/targeted-first.txt)。随后严格类型检查补全 Candidate 和 Dexie Promise 类型：[失败类型](p2-f/attempt-1793458840089-targeted-typecheck.txt)。
4. 并发夹具同时修改两个任务共同的资源，待取消任务先合法进入 error；改用独立资源验证取消，另保留“资源修改必须 error”断言：[失败日志](p2-f/attempt-1793459732188-targeted-browser.txt)。
5. 首次全量 **52/53**，UI估算未收到同页第二份独立打包 Dexie 的写入通知：[原始全量](p2-f/attempt-1793459929650-full-browser.txt)。将夹具改为独立编辑标签页，验证真实跨标签资源更新；风险高的断言保留，增强专项3/3通过。未证明同页多份库的具体事件失配原因，不将该场景宣称为产品修复；产品继续依赖既有 Dexie 通知协议，外部原生 IDB 绕过协议不保证即时 UI 通知，estimateIsCurrent 仍可读取验证。
6. 第二次全量 **52/53**，本轮3条通过，旧来源测试点击收藏后立即刷新，没有等待异步保存完成：[原始日志](p2-f/attempt-1793460582730-full-browser.txt)。补上收藏按钮 aria-pressed=true 的等待，确认提交可见后再刷新；同名新运行拒绝覆盖及原 runId 来源断言全部保留。没有放宽产品收藏语义。

## Git 隔离与复现

实际起始扫描为670个路径、179个历史 modified/untracked 文件（不是按约252猜测）。[逐文件字节/SHA](p2-f/baseline.json)和外部完整备份、binary worktree/index patch 已保存，路径在本地 baseline-local.json；本轮不提交该本机路径。没有 reset --hard、clean、stash 或覆盖旧用户审计。首次commit因Git未配置作者身份退出1；随后仅通过命令级 -c 沿用最近5次提交的 Codex <codex@openai.com> 身份，不修改全局/仓库配置，见[记录](p2-f/commit-attempt.json)。原用户 db.ts 修复与历史P1测试/文档均保持字节；PROJECT-STATUS只插入本阶段节，索引从 HEAD 加本阶段节构造，原用户差量不入提交。

旧测试会生成旧阶段证据，runner先保存其原始字节，将重跑输出另存 p2-f/replayed-* 再恢复旧文件；原始 stdout、退出码和 JSON单独归档。本轮失败尝试另存 attempt-*，不覆盖为成功记录。暂存白名单拒绝混入历史 index，逐个验证所有非本轮文件；精确索引另导出隔离目录执行检查。

```powershell
node scripts/validate-p2-f.mjs             # 全量单元/类型/构建/基准/53条Chromium
node scripts/validate-p2-f.mjs --targeted  # 仅浏览器限定本轮，其余仍全量
node scripts/summarize-p2-f.mjs
node scripts/stage-p2-f.mjs               # 严格字节保护与白名单索引
node scripts/isolate-p2-f.mjs --browser   # 精确索引单元/类型/构建与3条Chromium
```

## 条件与接续

有界估算和纯计算复用可交付；减少枚举次数的高级规则、所有动态/AST内部基数、精确步数与时间预测、跨运行缓存和I/O重排未交付。P2-E 的估算器待补项得到本轮保守范围实现，其余高级剪枝条件未解除。历史 G/Q、来源全集/多同名收藏和跨浏览器/低端限制延续。后续若要减少重复读取或持久化成本，须先定义可观察读取/版本核验/预算语义，再单独证明并测量，不能暗中改变当前契约。
