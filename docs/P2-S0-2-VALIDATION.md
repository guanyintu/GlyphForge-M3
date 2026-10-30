# P2-S0-2 统一类型与算子契约验收

日期：2026-10-31（Asia/Shanghai）。起点 `077292e`，含开始时未提交的 P1 最终审计修复与用户文档修改；先读取 PROJECT-STATUS、P1 最终审计、P2 准入架构、S0-1 验收并核对实际代码/Git。

**结论：S0-2 GO；结合已提交并回归通过的 S0-1，可以进入 P2-A（参数化子图）。** 本结论是前置阶段完成，不是 P2 或整份 v3.0 完成。范围仅 S0-2 和回归中发现的工作流保存竞态；未开发子图、函数、扩展包、动态词库或修改数据库 schema、工作流 IR、分享格式/算子版本。

## 共享契约与入口

[contracts.ts](../src/core/contracts.ts) 提供 ValueType、逐算子参数描述、AST 签名、入口适用性、结构化诊断和执行策略。默认参数仍唯一保存在 model/chinese-definitions；注册表、图验证/代码打印、剪贴板、分享依赖、AST 检查/求值、中文核心和实验室均接入同一 normalizeParams。中文/关系/游戏的领域验证器继续复用，没有重写算法。operators 中保留原异步迭代执行实现；不是公开插件注册协议。

- 图端口使用具名 `CandidateSequence = AsyncIterable<Candidate>`，不将 AST 的 String、Number、Boolean、集合、Pair 强制转换成图序列。图调用的输入是序列；AST 的同名调用有明确的标量签名和结果类型，集合须通过 for 遍历、String 才能 emit。保留现有图式 NameScript 和 sequence/program AST 两种语法。
- 缺失参数补默认值；显式 undefined、错误标量类型、NaN/Infinity、错误枚举/范围/JSON/过长字符串拒绝，不用 String/Number 强制转换通过验证。未知旧参数字段保留但不执行。normalizeParams 返回新对象，验证/运行不修改原工作流；剪贴板与导入的副本会补齐参数。
- AST 可省略尾部可选参数；旧完整位置参数顺序不变。concat 的可选第三参数与图分隔符一致；pattern 仍为 `(template, a, b)`，prefix 仍为 `(text, prefix)`。动态参数在求值时校验，即使中文返回集合没有被遍历，也不会漏过非法参数。
- 兼容包仍为 v1～v4，IR/算子版本仍为1。无需新数据迁移。graph API 仍接受原 ResourceReader，新增可选 resourceMetadata hook；生产 Worker 总是提供元数据。第三方/测试 reader 未提供元数据时保留逐行防御，无法凭空判断空源类型，不承诺对这种 reader 进行空源校验。

各内置算子的语义对照（图式代码均按对应图节点执行；“无”表示未开放该入口，不进行隐式适配）：

| 算子 | 图输入 → 输出 | AST | 文字实验室 |
| --- | --- | --- | --- |
| resource | 0 → CandidateSequence | 固定 ID → Strings；for 逐项投影 String | 内部合成输入源 |
| pairs | 0 → 带 Pair 的 CandidateSequence | 固定 ID/关系 → Pairs；for 绑定 Pair | 无 |
| template | 0 → 带 members 的 CandidateSequence | 无；图式代码完整往返 | 无 |
| group | 单名序列 → members 整组序列 | 无；图式代码完整往返 | 无 |
| program | 0 → emit 产生的 CandidateSequence | 词法作用域 let/for/if/emit | 无 |
| pattern | 两序列笛卡尔积 → 序列 | 模式、String、String → String | 无 |
| concat | 两序列笛卡尔积 → 序列 | String、String、可选分隔符 → String | 无 |
| filter | 序列 → 筛选后的序列 | 用 length/contains 等 Boolean 表达式及 if；无 filter 函数 | 同图 |
| prefix | 序列 → 序列 | String、可选前缀 → String | 同图 |
| reverse | 序列 → 序列 | String → String，Unicode 字符簇倒序 | 同图 |
| output | 序列 → 统一去重/限额输出 | emit(String) 进入所属 program 的输出序列 | 内部统一输出 |
| gamecheck | 序列 → 筛选/标注序列 | String、可选规则 JSON → Boolean；不伪装成标注集合 | 无 |
| pinyin | 序列逐项转换 → 序列 | String + 同一默认/参数顺序 → Strings | 同图 |
| homophones | 同上；输入需单个汉字 | String + 同一参数 → Strings | 同图 |
| rhyme | 同上；不符者零输出 | String + 同一参数 → Strings | 同图 |
| hanconvert | 同上；种子控制候选/概率 | String + 同一参数 → Strings | 同图 |
| mapchars | 同上；有界多候选 | String + 同一参数 → Strings | 同图 |
| decompose | 同上；受深度/数据边界约束 | String + 同一参数 → Strings | 同图 |
| components | 同上；一个部件一个结果 | String + 同一参数 → Strings | 同图 |
| compose | 同上；逗号/顿号分隔部件 | String + 同一参数 → Strings | 同图 |
| hanfilter | 同上；不符者零输出 | String + 同一参数 → Strings | 同图 |

AST 独有的 range、length、contains、startsWith、endsWith、text、left/right/relation 也在共享签名表中。Number/Boolean 不隐式 emit；集合必须同质，不能把集合或 Pair 传给 String 函数。没有新增控制流类型、函数调用或自动集合提升。

## Candidate 与 Pair 适配

Candidate.text 是图的展示值，pair/members 是可失效的整体语义，parts 是来源快照，不是全局 Entry 引用。Pair 只能通过 left/right/relation 显式投影到 AST String；投影保留来源 parts，emit 不重新制造 Pair/members。普通资源迭代到 AST 时保留 parts 和 notes。

图端单输入文字变换沿用 candidateText：文字相同保留对象/Pair/members，改变后清除不再有效的整体元数据。pattern/concat 生成新组合，清除整体 Pair/members，保留来源中的 pair，并与 AST 一致去重 parts、合并 notes。输出的 workflowId/seed/runId 由当前执行器附加；来源去重不等于丢失真实来源，也不承诺重建历史资源内容。这个 notes/重复来源收敛是有意行为修复，不改变旧图生成的文字及顺序。

## 错误、确定性、流式与预算

ContractError 包含可序列化 diagnostic：PARAMETER、TYPE、SCOPE、RESOURCE、BUDGET、CANCELLED、EXECUTION；保留可用的 operator/parameter/nodeId/line。内层诊断穿过外层节点/块时不被覆盖，UI 仍可使用兼容的 message。Worker 常规 error 消息增加 diagnostic（原10秒 watchdog 仍发送兼容的 message），不改变 started/batch/progress/done 协议。参数错误跨入口共享类别；定位分别对应节点或 AST 行，不声称两种入口位置完全相同。底层算法/存储未知异常归 EXECUTION；旧 tokenizer 的部分语法错误仍保留原行号文字，不是每个第三方异常都有参数名。

确定性条件为相同参数、种子、资源版本及内置数据版本；不把“deterministic=true”解释成与资源变化无关。所有算子继承同一次运行的 tick/取消/时间预算；生产默认限制为：300,000 步、10 秒、10,000 唯一输出、64 条背压批次、1,024 代码单元/条；AST 不重置预算。group 标记 buffered（受10k唯一候选/人数批次边界约束），其余 incremental，表示可增量交付，允许字典初始化、局部候选展开和数据库分页，不声称零缓存或所有处理 O(1)。UI 12秒硬停止和实验室15秒 watchdog 仍保留。

生产 Worker 在进入 resource/pairs/template 绑定和 AST 资源迭代时，先读资源 kind 再读数据，空普通库与空关系库错绑同样 TYPE 错误；缺失为 RESOURCE。运行中版本检查和已提交部分结果保留不变。S0-1 的恢复、保护、留存及取消协议继续回归。

## 回归中发现的保存竞态

首轮全量 26/27，旧关系配方测试在刷新后回到默认图。[首轮日志](p2-s0-2/browser-initial.txt)/[JSON](p2-s0-2/browser-initial-results.json) 保留。trace 显示刷新前配方候选已正常生成；不是模板类型拒绝。

最小夹具在真实 IndexedDB 的 workflows store 持有写事务，等待旧图 autosave 排队，切换到新配方后释放旧写入，再按“已保存”提示刷新。修复前稳定返回旧图，见[红灯](p2-s0-2/recipe-reload-red.txt)。App 现在立即保存切换目标，再发布持久选择；过期保存回调不能更新活动 ID/保存状态。普通编辑继续650ms防抖。复现测试与原用例均列入最终回归，不延长等待来掩盖问题。

## 最终验收与复现

```powershell
node scripts/validate-p2-s0-2.mjs
# 仅本阶段浏览器，其余单元/类型/构建仍全量：
node scripts/validate-p2-s0-2.mjs --targeted
```

| 检查 | 最终结果与证据 |
| --- | --- |
| Vitest 全量 | **238/238，16文件**；原210项 + 新28项，包含引擎基准：[tests](p2-s0-2/tests.txt) |
| 生产 Chromium 全量 | **28/28**，原25项 + 新3项：[browser](p2-s0-2/browser.txt)、[JSON](p2-s0-2/browser-results.json) |
| 类型检查 / 生产构建 | 均退出0：[typecheck](p2-s0-2/typecheck.txt)、[build-types](p2-s0-2/build-types.txt)、[build](p2-s0-2/build.txt)、[退出记录](p2-s0-2/check-exits.json) |
| 独立索引源码快照 | **227/227，15文件**，类型/构建均退出0；未包含原有未提交的11项 P1 最终审计测试：[tests](p2-s0-2/isolated-tests.txt)、[退出记录](p2-s0-2/isolated-exits.json) |
| 保存竞态定向重复 | 修复后3/3；是同一用例3次运行，不与28合计功能数：[green](p2-s0-2/recipe-reload-green.txt) |
| 差异与归属 | 工作区/隔离索引 diff check通过；原54文件中4个有本轮指定重构，其余50个SHA-256逐字相同；备份zip逐文件校验通过 |

新增单元覆盖9种中文算子和prefix/reverse/filter的节点→图式代码→AST→实验室对照，pattern/concat笛卡尔积及notes/来源一致，动态非法参数、作用域/Pair/同质集合类型、缺省参数、共享预算/取消、空资源及v1～v4便携包在空资源表恢复。生产测试使用真实构建Worker和IndexedDB，6个代表算子比较节点/代码/AST与独立lab Worker，覆盖概率/固定种子；[Worker对照](p2-s0-2/worker-consistency.json)、[空库诊断与终态](p2-s0-2/empty-resource-diagnostics.json)。完整旧回归继续包括100组属性图、关系六配方、百万普通词条、逆向/动画、Worker取消、S0-1新旧库各100轮及持久profile进程重开。

最终运行使用 Node24.22.1、Vitest3.2.7、Headless Chromium156.0.8078.4，单Playwright worker；单位测试/隔离构建曾并行运行，不据其耗时比较性能。新测试专用bundle仅位于dist/contracts-harness，不进入生产入口。所有旧固定路径证据已逐字恢复；本轮图/性能/历史数据见[p2-s0-2/regression](p2-s0-2/regression/)。


## 工作区保护与提交范围

起始54个已修改/未跟踪文件逐字备份到独立临时目录，并保存 Git binary diff、SHA-256 清单；[基线清单](p2-s0-2/baseline.json) 索引备份。没有 reset/clean/stash，也不操作用户浏览器数据库。测试使用独立 Playwright context；历史输出在 finally 中恢复并将新证据转存本阶段。

本轮重构与起始修改重叠的是 App、script、graph-editing、PROJECT-STATUS：前3个在既有修复基础上实现统一验证/默认值和保存竞态修复，等价吸收同一边界的旧 helper，不撤销其行为；状态文档保留原正文并新增本节。其他原始文件要求逐字保持，最终以[归属校验](p2-s0-2/git-isolation.json)为准。db 冲突编辑修复、原有用户文档、P1 审计文档/测试和旧 e2e 调整不纳入本轮提交。状态页通过独立索引仅提交新节，保留其原有未提交修改。

独立索引从077292e建立，检出临时源码快照后单独验证，证明本轮提交不依赖未提交的 P1 审计代码。它与完整工作区测试数量不同，不能互换。源码指纹见[manifest](p2-s0-2/manifest.json)。

## 仍保留的边界与下一阶段

S0-1 仍受历史资源无内容快照、主动保护数据可增长、Web Locks/32MiB备份等既有边界限制。S0-2 不创建函数/子图/扩展包 API，不把图布局分组解释为可执行子图。P2-A 仍须落实显式参数/返回、捕获规则、作用域/遮蔽、调用深度和共享预算、旧图/分享兼容测试后再开放交互。

本次仅 Chromium；Firefox/WebKit、真实低端、物理磁盘故障、200节点交互、长期Worker/数据库峰值及 G01～G09/Q01～Q03 的其他差距继续保留。普通 ResourceReader 不带元数据的空集合类型不可推断；group和字典有界缓存也不等于全程常量内存。本轮不扩大这些支持声明。
