# GlyphForge M2 发布候选版

2026-11-01（Asia/Shanghai）；M2原基线 `93d453b`，本轮起点 `9b7b366`，冻结源码 `7e78360`，分支 `codex/m2-release-readiness`。**两项目标阻断已修复；RC NO-GO：必要全量回归新发现估算跨标签失效，尚未解决。** 保留全部旧失败，不新增P2阶段。

## 本轮两项阻断收口（冻结源码 `7e78360`）

**两项目标阻断已修复；整体 RC 仍为 NO-GO。** 最终必要回归发现既有估算跨标签失效：原生数据库元数据已更新到20,000，原页仍显示144项旧估算。冻结提交全量61/62，最小探针2通过/1失败；随后兼容全量66/66不能抵消该失败。遵守本轮只修两项目标的范围，没有扩展修改估算模块，也不新增P2-H/P2-I。

### 归属与最小修复

- 起点 `9b7b366`；产品修复 `77b4904`，夹具定位修正 `5276ed7`、入屏时序修正 `7e78360`；之后仅更新本页和PROJECT-STATUS。当前分支仍是 `codex/m2-release-readiness`。
- 本轮扫描1208个版本控制/未跟踪路径，起点展开234项差异（9 tracked修改、225 untracked）；原ownership清单184项之外的50项全部属于旧M2证据/trace/辅助资料，见[补充归属](../../GlyphForge-M2-evidence-5276ed7/ownership-addendum.json)。没有把它们作为新产品代码提交。
- 关系保护：历史db.ts的SHA-256仍为 `51252a11ac8572ea98868534d120c33eae36df7b12dab83587ad715737972f70`，与前轮备份逐字节一致；旧P2-C快照也含这段保护。仅纳入原4行事务内冲突查询，不改schema、迁移、唯一索引和批量去重语义。原逻辑先删除待编辑行，再将冲突目标当作已有行跳过，因而静默丢行；现在在删除前按资源/左右词/关系/方向的唯一键拒绝其他ID。
- 独立负向检出在9b7b366上再次失败；新增5项回归在旧源码3失败/2通过，加入4行后与原历史11项共16/16通过。覆盖归一化冲突、同ID元数据更新、方向/资源隔离、删除后写失败回滚、双连接竞争和v3→schema7旧行。另有真实UI拒绝冲突并逐字段核对IDB行、count/version/updatedAt及刷新后的相等性。证据：[relation-red](../../GlyphForge-M2-evidence-5276ed7/relation-red/output.txt)、[relation-regressions-red](../../GlyphForge-M2-evidence-5276ed7/relation-regressions-red/output.txt)、[relation-green](../../GlyphForge-M2-evidence-5276ed7/relation-green/output.txt)。

### 动画根因与验证边界

IntersectionObserver通知队列可以包含同一目标的多条记录，见[W3C通知算法](https://www.w3.org/TR/intersection-observer/#notify-intersection-observers-algo)。旧回调只读第一条；原生几何产生的 `[false,true]` 合批交付可将已入屏目标错误地持续暂停。新增浏览器回归只控制交付时机，使用Chromium原生记录与真实RAF/坐标；旧源码确定失败，修复读取最后记录后5/5通过。见[motion-batch-red](../../GlyphForge-M2-evidence-5276ed7/motion-batch-red/output.txt)、[motion-fixed-independent](../../GlyphForge-M2-evidence-5276ed7/motion-fixed-independent/output.txt)。

前轮全页截图探针记录了短暂width=0/离屏及恢复，原失败则有正常文档RAF采样、三段0物理帧、quality=full且停止。旧trace没有记录IO批次数，不能声称逐条证明历史失败必然来自同一批次；现在已确定复现并修复了导致同类停滞的源码缺陷。890px视口另确定暴露测试在入屏前断言运动的时序问题：3/3失败，移动原断言到入屏之后3/3通过。原静态降级、冻结、重叠/边界及错误断言保留；新增各阶段物理帧>0和正常/节流阶段坐标变化，截图移到计时后。未改45帧窗口、30ms门限、18秒时限、节流或取消策略。

独立压力5/5、890px压力3/3；冻结7e78360全量与本轮兼容全量中压力均通过（2/2），且物理帧与坐标确实变化。IO/隐藏页/暂停、恢复、卸载RAF清理、低设备自动停止、收藏稳定键沿用原全量回归。Windows x64、Node24.22.1、Chromium156.0.8078.4 headless、workers=1、无retry，无人工切窗口；6×CPU和每帧35ms竞争分列。依赖使用原安装node_modules junction，版本见[环境](../../GlyphForge-M2-evidence-5276ed7/environment.json)，不冒充全新依赖安装验收。

### 冻结与完整门禁（所有已观察失败保留）

新证据按用户限定范围存于项目旁 `../GlyphForge-M2-evidence-5276ed7`，不新增仓库证据文件、不覆盖原docs证据；链接为本机相对路径，证据目录本身未提交。隔离检出路径和源指纹见[冻结记录](../../GlyphForge-M2-evidence-5276ed7/final-frozen.json)、[运行时指纹](../../GlyphForge-M2-evidence-5276ed7/verification.json)。复现：独立检出7e78360，安装锁定依赖后执行 `node scripts/validate-m2.mjs`。该命令完整运行Vitest、tsc --noEmit、tsc -b、生产Vite构建、6文件基准、Playwright全量，并归档/恢复旧docs证据。

| 版本/范围 | Vitest | Chromium | 其余门禁 |
| --- | --- | --- | --- |
| 77b4904首轮隔离 | 407/407，23文件 | 61/62：新增toast定位错误 | 类型/构建/120基准通过；[pre-final-77b4904](../../GlyphForge-M2-evidence-5276ed7/pre-final-77b4904/exits.json) |
| 5276ed7中间隔离 | 407/407，23文件 | 62/62 | 类型/构建/120基准通过；随后890px夹具3/3失败，未据此放行；[intermediate-5276ed7](../../GlyphForge-M2-evidence-5276ed7/intermediate-5276ed7/exits.json) |
| **7e78360新建干净隔离检出** | **407/407，23文件** | **61/62：估算跨标签失效** | **类型/构建/120/120基准通过**；[frozen-7e78360](../../GlyphForge-M2-evidence-5276ed7/frozen-7e78360/exits.json)、[frozen-7e78360](../../GlyphForge-M2-evidence-5276ed7/frozen-7e78360/browser.txt) |
| **7e78360运行时 + 历史工作区夹具** | **418/418，24文件** | **66/66** | **类型/构建/120/120基准通过**；[compatibility-workspace](../../GlyphForge-M2-evidence-5276ed7/compatibility-workspace/exits.json)、[compatibility-workspace](../../GlyphForge-M2-evidence-5276ed7/compatibility-workspace/browser.txt) |

最后一行实际在主工作区执行；产品src及4项配置的Git blob/统一换行内容与冻结源码核对（91文件，31文件仅LF/CRLF物理字节不同，内容差异0），增加的11项Vitest/4项Chromium来自原历史P1最终审计夹具，另保留旧p1c/p1d的证据输出和堆采样差量。它不替代上一行纯提交源码检出，也不把未提交测试冒充提交资产。主工作区旧证据由runner恢复原字节。

没有掩盖新失败：[scale-diagnostic](../../GlyphForge-M2-evidence-5276ed7/scale-diagnostic/output.txt)含原生IDB已更新、原页旧144估算及2通过/1失败；只做外部最小探针，没有提交其debug文件、修改估算产品逻辑或放宽风险断言。[中止记录](../../GlyphForge-M2-evidence-5276ed7/aborted-validation.json)保留一次Git拒绝覆盖隔离测试后误启动并停止的无效验收，不计作完整门禁。此前原63/64、独立1/1和本页下方旧失败继续保留。

### 残余与提交边界

- P0：本轮关系数据发布阻断解除；没有发现新的P0阻断。P0本地闭环结论不扩展为完整v3.0完成。
- P1：目标动画阻断解除；**新增发布阻断是估算跨标签元数据失效（冻结全量1失败、探针1/3失败）**。完整Chromium稳定全绿条件未满足，故RC NO-GO。后续继续同一M2处理此失败，不另设P2阶段。
- 旧运行/收藏、v3关系与v5旧库迁移、schema7、仓库旧便携包/v1–v7/GFS1、子图/动态词库/Mapping/变异/来源/扩展和取消已在上述完整回归核对；新旧库各100轮、原持久profile进程重开夹具和10k/100k/1m导入通过。这是仓库资产及原生IDB夹具验收，没有读取或迁移用户实际浏览器profile全部数据。
- P2-E/F/G有界条件、枚举级剪枝NO-GO及历史G/Q继续有效；Firefox/WebKit、实物低端/原生峰值、完整屏幕阅读器矩阵仍缺证据，P1有界验收不等于整份规划完成。
- 本轮唯一提交文件清单：`src/storage/db.ts`、`src/animation/useResultMotion.ts`、`src/tests/m2-relations.test.ts`、`e2e/m2.spec.ts`、`e2e/m2-motion.spec.ts`、`e2e/p1d.spec.ts`、`docs/M2-RELEASE-READINESS.md`、`PROJECT-STATUS.md`。PROJECT-STATUS仅暂存M2区段，历史P1审计、AGENTS、README等差异未混入。无push、主分支合并或公网发布。


## 风险与修复

| 优先级 | 证据与影响 | 本轮处理 |
| --- | --- | --- |
| P0 | 刚改名后立即点击当前侧栏项，旧快照覆盖新编辑，结果被清空 | 已修复并通过最终生产浏览器：当前项只导航，不加载旧快照；刷新仍保留新名 |
| P1 | 未应用 NameScript 切换时丢失；Ctrl+S/导出让人误以为已保存代码 | 已复现；切换/导入/导出前明确保护，显示未保存状态和显式放弃入口；关闭页面提醒 |
| P1 | 侧栏截断到12项，更多工作流无入口 | 已复现；取消静默截断，沿用滚动列表 |
| P1 | IndexedDB 启动失败后错误短暂消失，永久加载 | 已复现；持久错误与无删除重试 |
| P1 | 小屏收藏/工作流导航不收起遮罩；空工作流无行动指引 | 已修复；390px遮罩、示例与无横向溢出通过，空态增加三步引导 |
| P1 | 节点菜单被studio裁切，底部结果输出按钮被遮罩截获，真实点击超时 | 已修复为视口内滚动菜单；新词库→空图→真实点击输出→键盘输入连接→生成→代码往返→收藏通过 |
| **P0 / 原阻断已修复** | 历史db.ts重复关系编辑保护仍未提交，纯源码会静默丢原行 | 前轮HEAD/索引失败保留；本轮已最小纳入提交并通过独立回归，见上方收口 |
| **P1 / 原动画阻断已修复** | 最终动画压力测试期待static，实际full且已停止；三段均0物理帧 | 前轮63/64和1/1保留；本轮源码/时序修复与真实运动重复验证见上方收口 |
| P2 | 大中文字典按需加载但构建块较大；历史G/Q剩余能力 | 保留限制，不为RC扩展任意JS、云服务、Entry迁移或枚举剪枝 |

## 用户旅程与 v3.0 对照

以下判断对应最终工作区及下方本轮日志；有界范围的“完成”不表示v3.0全部愿景完成，独立源码仍受上方阻断限制。

| 旅程 / v3.0范围 | 状态 | 验收入口与边界 |
| --- | --- | --- |
| 首次启动→示例→资源/关系创建导入→图/代码→筛选收藏复制导出（§3–6、15） | 完成（本地有界闭环） | 最终生产 `audit.spec.ts`、`p1-final.spec.ts`、`m2.spec.ts`；新空态与恢复入口 |
| 中文/逆向/游戏规则/动画（§3、7–9、12） | 部分 | 原P1测试；中文数据有限、推断不算执行来源、不承诺游戏可注册 |
| 子图/序列函数、变异、多轮创作（§4、8、15 P2） | 完成（有界范围） | 原P2-A/B；无递归/标量用户函数；变异回退会话内保留 |
| 动态资源/Mapping/声明式扩展及诊断（§2、5） | 部分 | 原P2-C/D；G01单码点Mapping，未知发布者禁用；不执行JS |
| 保存/刷新/旧库/收藏/历史来源真实性（§11、14） | 部分 | 最终生命周期新旧库各100轮/回滚/受保护来源通过；schema7保持；资源历史全集未归档 |
| v1–v7 JSON / GFS1→空库恢复/缺失重绑/事务回滚（§10） | 完成（协议预算内） | 分享生产Worker与真正空DB测试；码≤1MiB JSON，文件≤15MiB，不携带生成历史 |
| 取消/10k输出/100k实体/百万逻辑前缀（§11、16） | 完成（实测预算内） | 最终规模/来源Worker回归；沿用步数/时间/结果预算，不重置子图/动态预算；无新增枚举优化 |
| 离线本地服务/无第三方网络/键盘/触屏（§16、19） | 部分 | 本机Chromium；需本地HTTP，无PWA；完整屏幕阅读器矩阵、Firefox/WebKit/实物低端证据不足 |
| 全局Entry/成员管理、任意工作流逆执行、全IDS、完整控制流/算子集（G02–G06/G08） | 部分/有意简化/未实现 | 保留原矩阵剩余项，不作为现有有界本地产品的新增发布承诺 |
| 任意JS/社区/云同步/在线市场（G09、P3） | 未实现，延期 | 不构成当前本地版功能依赖 |

## 工作区归属与证据

实际扫描1015路径，起始历史差异184文件：9个tracked修改、175个untracked文件。按路径：src 2、e2e 3、docs 171、scripts 2、根目录6。目录折叠下的 `git status` 行数与展开文件数不同，不沿用“约290项”的估计。

[逐项归属](m2/ownership.json)：1项运行时修复、4项审计夹具、2项审计工具、11项文档/指令、166项证据与本地辅助文件。后者不等于166项产品技术债。

- 已提交功能：P0/P1及P2-A～G，以HEAD和旧阶段记录为界；P2-E/F/G仅有界CONDITIONAL GO，枚举级剪枝仍NO-GO。
- 历史产品/审计差异：`src/storage/db.ts`、两份旧E2E、未跟踪P1最终审计测试/矩阵和根文档，必须保留；是否进入发布源码需单独归属决定。
- 其余多为旧轮次原始证据、备份、临时隔离/暂存脚本，不等于产品技术债；不删除。清单与SHA见[基线](m2/baseline.json)，本机外部备份位置在 `m2/baseline-local.json`。
- 本轮产物仅本页、短状态更新、实际产品修复、少量M2浏览器回归和执行日志。runner将旧证据重跑结果另存后恢复旧文件原字节。

## 前轮门禁与证据（原始失败保留）

最终产品源码冻结后执行 `node scripts/validate-m2.mjs`：[命令/退出](m2/full-1793498153870/exits.json)、[最终源码指纹](m2/full-1793498153870/source.json)。环境：Windows x64、Node24.22.1、Chromium156.0.8078.4。

| 检查 | 真实结果 |
| --- | --- |
| 完整Vitest | **413/413，23文件**：[日志](m2/full-1793498153870/tests.txt) |
| typecheck / tsc -b / 生产构建 | 全部退出0；构建保留中文大块及混合动态导入警告，不称包体优化完成 |
| 引擎/资源/扩展/来源/估算/分享基准 | **120/120，6文件**：[日志](m2/full-1793498153870/benchmark.txt) |
| 完整生产Chromium | **63/64，1失败，无skip**：[日志](m2/full-1793498153870/browser.txt)、[结构结果](m2/full-1793498153870/browser-results.json) |
| M2精确索引隔离 | **402/402、120/120、类型/构建通过、6/6新增Chromium**：[退出](m2/isolated/exits.json)、[浏览器](m2/isolated/browser.txt)；11项差额为历史未提交P1审计测试 |
| 关系冲突负向门禁 | [HEAD失败](m2/committed-base-conflict.txt)、[精确索引同样失败](m2/isolated/conflict-negative.txt)，非通过；两者db blob相同见[记录](m2/isolated/conflict-negative.json) |
| 动画独立诊断 | 同一最终dist + 原工作区夹具，仅在外部隔离目录加IntersectionObserver探针、端口4176：**1/1通过**，[探针/采样](m2/motion-probe/browser.txt)。未复现全量0帧，未定位根因，不替代完整门禁 |
| 安全/离网 | [88个生产文件静态模式扫描](m2/security-runtime.json)未见网络调用、eval/new Function或常见密钥；新增真实旅程第三方请求0，原恶意包/压缩炸弹/权限拒绝测试通过。此为有界检查，非形式安全证明 |
| 修改保护 | [最终复核](m2/preservation.json)；旧证据重跑单独归档并恢复原字节，历史db/夹具未进入M2索引；README/状态只提交新增M2节 |

实际性能不外推：10k/100k/1m实体导入本轮约0.52/4.80/56.38秒，[资源实测](m2/full-1793498153870/replayed-docs_p1-final_resources-performance.json)。100k实体、多词库完整拒绝、10k输出157批、百万逻辑60项前缀和深子图保持预算，[Worker规模](m2/full-1793498153870/replayed-docs_p2-f_worker-m2.json)、[来源与取消](m2/full-1793498153870/replayed-docs_p2-e_worker-performance.json)。堆样本区分Worker/Renderer，不冒充RSS或绝对峰值；最终规模测试期间另有一次隔离动画探针，样本耗时不用于优化收益比较。

真实失败未覆盖：[旧dist五条红测试](m2/red-1793497041019/browser.txt)、[重试状态/定位夹具](m2/targeted-1793497113313/browser.txt)、[标签精确匹配修正](m2/targeted-1793497226312/browser.txt)、[首次全量62/64](m2/full-1793497405358/browser.txt)。首次全量另发现CDP注册竞态；现仅增加最多5秒等待Worker目标注册，保留原10k数量、批次、取消和内存断言。随后最终全量为上述63/64，不能称全绿。

## 放行条件与已知限制

1. **原源码阻断已修复**：4行关系保护已进入77b4904；本轮冻结7e78360独立检出通过针对性回归。
2. **原动画阻断已修复；新P1门禁仍阻断发布**：IO合批状态及入屏采样问题已修复，冻结和兼容全量压力2/2通过；估算跨标签失效在冻结全量及独立探针仍有真实失败，整体RC NO-GO。
3. 保留G/Q延期：无PWA冷启动、任意JS/云分享/市场/全局Entry迁移/枚举级剪枝；中文/Mapping/逆向语义有界，历史资源全集与多同名收藏未完成。Firefox/WebKit、实物低端、原生内存峰值和完整屏幕阅读器矩阵**证据不足**。
4. P2体验项：新节点可能默认重叠，可用「自动布局」；大量工作流列表尚无分页/搜索专项；新运行成功后的旧错误toast最长约3.5秒才消失。

已人工检查[桌面](m2/desktop.png)和[390px小屏](m2/mobile.png)。两项目标修复已收口；后续仍继续M2处理本页新增估算门禁，不新增子阶段。未合并主分支、未推送或发布公网，未清理历史资料。
