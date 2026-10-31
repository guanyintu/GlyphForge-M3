# P2-C 验收：动态词库与独立 Mapping

日期：2026-10-31，Asia/Shanghai。开发基线 `ca76906`（P2-B GO），工作分支 `codex/p2-c-resources`。没有重做P2-B；本轮新增资源切片及必要的共享执行器适配。

**结论：P2-C 下述受控字符 Mapping 与有界动态候选链 GO。** 不是完整P2、完整Mapping产品规划或整份v3.0完成。范围、执行语义与延期见 [架构](P2-C-ARCHITECTURE.md)。

## 最终实测

| 检查 | 结果与原始证据 |
| --- | --- |
| 全量 Vitest | **327/327，19文件**；原295项及新增32项：[日志](p2-c/tests.txt) |
| 全量生产 Chromium | **42/42**；原37项及新增5项：[日志](p2-c/browser.txt)、[JSON](p2-c/browser-results.json) |
| 类型 / 生产构建 | tsc --noEmit、tsc -b、Vite build 全部退出0：[退出](p2-c/check-exits.json)、[类型](p2-c/typecheck.txt)、[构建](p2-c/build.txt) |
| 引擎与资源基准 | **34/34** 基准/专项检查通过：[日志](p2-c/benchmark.txt) |
| 精确暂存的隔离源码 | **316/316，18文件**，类型/构建退出0：[单元](p2-c/isolated-tests.txt)、[退出](p2-c/isolated-exits.json) |
| 隔离源码生产 Chromium | 独立4176端口，**5/5** P2-C用例：[日志](p2-c/isolated-browser.txt)、[退出](p2-c/isolated-browser-exits.json)、[JSON](p2-c/isolated-browser-results.json) |

隔离源码由Git索引导出，不带用户既有的4行关系冲突修复及11项未提交P1审计测试；327与316差额来自这些审计测试。其余本轮源码经换行归一化与工作区完全相同，见 [源码指纹](p2-c/manifest.json)。隔离测试不是全量浏览器替代品：42项全量在工作区完成，隔离额外运行5项新增浏览器场景。

Node v24.22.1、pnpm11.25.0；Windows10，Headless Chromium156.0.8078.4，1440×1000。本轮没有实物低端、Firefox或WebKit覆盖；Chromium CPU节流回归仍只是模拟条件。

## C1–C5 对照

| 要求 | 本轮完成与边界 |
| --- | --- |
| C1 模型与DAG优先 | Resource稳定ID/内容版本、静态兼容适配、定义format1、mapping类型、传递DAG、缺失路径/循环/深度数量限制、源版本向量、精确内容/种子键；先通过底层专项再接UI |
| C2 动态组合与一致性 | 使用原图/AST/子图/关系模板/中文/变异白名单执行器；惰性拉取、静态256行、预览60行、定义最多10k候选；外层共享300k步/10秒；定义快照+全闭包版本检查+批次/done同事务检查。无候选持久缓存，源改删后清预览/报错重算；硬取消及独立10秒预览watchdog |
| C3 独立Mapping | 资源中心创建/命名/编辑/独立文件导入导出/复用/引用；图、图级NameScript、program AST、中文/火星文、实验室、变异器共用规则解析和mapchars转换。旧内联JSON保持可用。本轮为受控单码点到候选规则，多词最长匹配延期 |
| C4 兼容和资产保护 | 沿用S0-2预算/类型/错误、P2-A/B；上游版本/下游警告、重算状态、缺失提示；schema6加法字段、无资产重写；旧DB/历史/工作流/v1–v5回归；v6传递定义与静态快照、原子导入/UUID重分配/引用重写，不覆盖本地资源 |
| C5 验证 | 32新单元+5新生产浏览器；循环/菱形/改删/异步交错/事务版本/取消/空资源/错误包/离线空DB/子图重绑定/种子/来源/10万及百万逻辑规模。全部原单元与生产浏览器回归通过 |

32项单元包括：循环与缺失路径、菱形去重、类型和深度、名称不改变内容键、计算引用拒绝、关系模板显式投影、编辑冲突/循环编辑回滚、源/Mapping编辑重算与旧键拒绝、删源/删Mapping、交错读者、事务内拒绝旧批次及done、取消、空库/空映射、图/NameScript/AST/火星文一致性、P2-A/B复用、v6空DB离线/ID冲突/内部子图引用重写/错误格式原子拒绝、删资源后旧编辑器不能复活、共享预算与旧schema6资产逐项往返。

五项生产浏览器实际执行：

1. 全UI创建静态素材「月/星」→独立Mapping→动态「源→Mapping→前缀」→后台预览→v6依赖导出→工作流→P2-A界面创建子图/添加调用/连接输出→生产Worker→收藏→变异→收藏/结果文件导出→刷新→检查收藏及运行定义/版本快照→同DB文件导入重算。核对完整持久化记录，不把虚拟列表可见项当全集。
2. 独立Mapping文件真正导入；实验室mapchars、火星文、变异器火星文选择同一资源，均输出「玥」。
3. 121项真实IndexedDB源分页；修改Mapping后旧页清空，新页为新规则；删除源后依赖路径明确、禁止重算。[预览截图](p2-c/dynamic-preview.png)、[缺失截图](p2-c/missing-dependency.png)。
4. 真实IndexedDB读写事务阻塞预览读取→取消→释放→无迟到行；再次重算成功；重新阻塞并等待实际10秒watchdog→明确失败→释放后仍无迟到行。
5. 阻断外部HTTPS、保留本地HTTP；v6导入与生产Worker执行十万/百万逻辑组合，检查结果、步骤、真实来源版本。

## 性能口径

[生产Worker原始数据](p2-c/browser-benchmark.json)：原始源分别为1000×100、1000×1000真实静态行，v6导入后执行消费前60项，均 **442步**，分别 **44.3ms / 48.6ms**（含Worker启动、执行及持久化）。主renderer两点usedJSHeapSize为12,676,063 / 16,697,249字节，**不是Worker、RSS或峰值内存**。隔离源码另有 [独立样本](p2-c/isolated-browser-benchmark.json)。

这是10万/百万**逻辑组合**前缀测试，不是本轮新增百万实体词条导入性能承诺，也不是穷尽输出百万项。原全量浏览器继续覆盖P1实体词条导入/查询/取消基准，历史数据文件逐字恢复，当前完整stdout在本轮browser.txt中。fake-indexeddb专项时间单列在benchmark.txt，不混作浏览器实测。

没有持久候选缓存；每轮页/批次/定义/深度/数量受限。未测长期大定义历史磁盘峰值、完整Worker/RSS/GPU峰值，不能据此关闭Q01–Q03其余项目。

## 失败与修复记录

初始新增UI夹具把导航写成不存在的「资源词库」，导致三项未进入资源页；修正为实际「资源中心」，保留 [夹具红灯JSON](p2-c/browser-fixture-red.json)。

首次全量 **38/42**：[日志](p2-c/browser-full-red.txt)、[JSON](p2-c/browser-full-red-results.json)。一项是Mapping select缺少显式aria-label，已补齐；另外三项原生命周期回归暴露真实产品缺陷：写事务内await import在独立入口冷加载时使原生IndexedDB提前提交。复现为PrematureCommitError后，把db/run-lifecycle依赖改为静态导入，保留原事务内版本检查；[复现说明](p2-c/native-transaction-diagnosis.txt)。没有删除回归或放宽断言。

修复后对最终源码重新运行全量，**327/327、42/42、类型/构建/基准全部通过**；另有隔离316项及5项生产浏览器通过。构建保留既有中文数据大chunk及静/动态导入混用提示，不把提示当作构建失败，也未宣称已完成包体优化。

## 资产、提交和可复现性

本轮使用新分支，无reset/clean/stash。起始字节备份与patch在本地p2-c/baseline目录及baseline-local清单（70路径，含当时新建的保护脚本）；不把历史用户文档、审计或原数据库修复混入提交。最终 [原文件保护](p2-c/original-files.json)、[索引归属](p2-c/git-isolation.json) 和 [源码指纹](p2-c/manifest.json) 记录边界。PROJECT-STATUS只提交新增P2-C节，数据库只提交本轮资源适配差量。

schema不变。新增定义不会改写旧静态资源；schema6重开资产内容相等、v6冲突导入不覆盖原资源/行、非法包不写入任何部分，均有新单元；全量浏览器的新/旧库各100轮、历史保留/收藏/恢复/真实浏览器进程关闭重开继续通过。保护校验不等于迁移任意损坏的第三方DB；没有该项承诺。

```powershell
node scripts/validate-p2-c.mjs
# 仅把浏览器缩为P2-C，其余仍全量
node scripts/validate-p2-c.mjs --targeted
# 从当前Git索引导出独立源码并检查，再用4176跑P2-C
node scripts/isolate-p2-c.mjs
node scripts/verify-isolated-browser-p2-c.mjs
```

## 保留范围

- Mapping仍是单码点规则；多字最长匹配、正则/脚本和完整中文覆盖没有实现。
- 动态资源不物化/持久增量索引，不自动持续重算；深页重放可能触达预算。dynamic.count=0是未知数量占位，UI显示「按需计算」，不承诺精确全集计数。重复候选计入定义limit，最外层output去重。
- 不提供静态词库任意历史内容归档、完整祖先树、资源级撤销、全局Entry/Membership或任意动态DAG可视化设计器。现有依赖列表/当前工作流及NameScript编辑提供有界入口。
- v6内部子图随工作流/动态定义嵌入，执行使用局部ID作用域；不自动覆盖全局子图库。轻量包绑定另一套动态DAG时需依赖清单匹配，不推断等价性。
- 动态词条没有加入逆向B-tree；先存为普通词库后参与词条检索，真实已生成来源仍可查。关闭本地HTTP服务后的离线启动、跨ICU逐字节复现、长期性能及跨浏览器/实物设备仍未验收。
- 可信扩展包、压缩分享码、自定义代码隔离和原G/Q其余差距继续保留；本轮GO不将这些延期项标成完成。
