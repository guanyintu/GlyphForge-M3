# P2-G 验收：压缩分享码与安全离线分享

日期：2026-11-01，Asia/Shanghai。基线 `e3e93b9` / P2-F 源码 `7af6379`，分支 `codex/p2-g-sharing`。协议/预算/导入流程见 [架构](P2-G-ARCHITECTURE.md)。

**结论：CONDITIONAL GO，限本轮预算内的安全离线分享。** P2-F CONDITIONAL GO、枚举级优化 NO-GO 不变。不是完整P2/v3.0完成。

## 可复现检查

```powershell
node scripts/validate-p2-g.mjs             # 全量单元、类型、生产构建、120项基准、全量生产Chromium
node scripts/validate-p2-g.mjs --targeted  # 单元/类型/构建/基准仍全量，仅浏览器限定本轮5条
node scripts/stage-p2-g.mjs               # 字节保护与严格白名单，状态文档只暂存新增节
node scripts/isolate-p2-g.mjs --browser   # 从精确暂存索引另建目录检查
```

runner保存旧docs字节，旧测试重跑结果另归档为本轮replayed文件，最后恢复历史证据；失败尝试保存在attempt-*，不覆盖为成功。stdout、命令、退出码分别记录。最终数字与口径如下。

## 新增覆盖

- 分享协议30条Vitest，包含240次非法字母表变异、120次合法base64url/原生流变异；合法解码必须仍与校验覆盖的完整包一致，不要求忽略压缩头提示位的原生实现误拒合法数据。
- v1–v7每版JSON内容逐字段往返与实际导入；只读预览对所有表计数前后相同；原资源版本、数组顺序与新ID冲突隔离。
- 真实生产Worker：最小合法两节点（resource→output）、NameScript多节点、三层P2-A子图、P2-B变异、v6动态DAG/Mapping、v7扩展动态闭包，在真正0行空DB迁入。逐字段比较迁出前、JSON导入、码导入三路所有Candidate字段及步数；只剥离新runId/workflowId，规范化新工作流/资源/子图ID，保留text/顺序/parts/version/notes/derivation/lineage等语义字段。不把不同设备新运行ID强行要求相同，不伪造旧生成历史。
- v7禁用扩展导入后仍禁用；未知发布者与恶意权限/JS/版本/不完整闭包拒绝由新单元和原P2-D生产浏览器回归共同覆盖。未通过确认的协议预览不调用写事务。
- 8/16MiB高度可压缩长串伪造小声明，在逐块解压阶段拒绝；单元监听证明大文本未进JSON.parse。字符/编码/压缩数据/解压长度、checksum、截断、未知版本、保留原型键、深结构、套娃和历史顶层字段拒绝。
- 取消、两并发/第三任务拒绝、模式/勾选变更、卸载、超时Worker终止；模拟不响应Worker的8秒主线程硬终止实测。系统已提交的剪贴板写入不能撤回，取消抑制迟到UI，边界明确显示。
- 旧v1–v5与v7分别注入末尾workflow写失败，所有快照/扩展安装回滚；真实Chromium IDB另注入末尾错误。旧事务对资源版本/包同ID版本冲突的检查保留。
- 真实UI：轻量生成无快照；便携取消勾选后仅导出剩余资源；复制剪贴板→新context阻断所有非本地HTTP→粘贴预览/检查→确认→运行/刷新。缺依赖确认后沿用ImportBindings；合法大JSON文件导入后生成码超限，原JSON便携包仍能下载。
- 10k快照压缩和独立WorkerV8堆采样；百万逻辑图只运行受控60结果前缀，原P2-E/F全量回归另含10k输出与157批持久化，不宣称枚举百万输出或压缩生成历史。

## 真实失败及修复

1. 首轮单元21/24：夹具把saveNewResource后真实递增的v4误断言为v3；未知包默认禁用导致正确拒绝导出；JSON.parse全局spy抓到了Vitest sourcemap解析。改为捕获真实起始版本、显式启用仅为准备导出夹具再禁用，并识别大载荷解析；原断言目标保留。另最初测试引入node:zlib/crypto但仓库未配Node类型，改用原生浏览器API造包，没有添加依赖。见unit-first/second/third.txt。
2. 第一轮生产浏览器发现原页面Google Fonts远程请求；移除远程字体CSS，保留系统回退。取消按钮小任务可能先完成，改用受控500ms Worker延迟验证终止、切模式和卸载，保留无迟到结果断言。
3. 真实复杂包包含合法可选undefined字段，协议编码在原JSON序列化之前guard错误拒绝。改为有预算的JSON.stringify先序列化，UTF-8长度检查后验证解析结果，新增回归。旧JSON语义未改。
4. 浏览器harness漏导出dependencyIds、库构建Worker资产base错误，修复harness导出和本地asset base；产品主应用Worker原已成功。大包测试过早打开分享面板，被尚未结束的文件导入关闭；现在等待真实导入工作流出现。
5. 完整Candidate比较初次遗漏lineage中的新workflowId，出现正常新ID差异；仅把明确新分配ID规范化，完整来源内容保留，不只比较文本。
6. 有界目录spy发现旧静态readResource内部仍会重新扫描元数据。分享码路径在确认没有定义资源的分支改用同一readStaticResource分页，并在末尾核对完整plan；旧JSON入口默认行为不变。专项spy和1MiB读取预算测试通过。
7. 用户可见v6/v7超限提示曾固定写15MiB，与码的1MiB预算不符；修正为实际预算与JSON文件降级建议。卸载清空任务引用，避免finally再发布过期UI。

8. 暂存门禁拒绝新增状态节LF/CRLF不一致，以及旧测试临时写入的历史证据；修正新增节字节并等待runner恢复。首次shell未在stage失败后停止，误跑HEAD索引（372单元/浏览器找不到本轮spec），明确不算P2-G隔离证据并保留attempt-head-only-*；isolate新增前置门禁。
9. 首次真正隔离402单元/类型/构建通过、Chromium4/5，CDP的Target.getTargets在Worker注册完成前返回，堆测试未发现target。改为显式等待目标注册再采样，保留原断言和attempt-worker-ready-*，不是放宽内存或成功标准。

全部失败的原始日志保留，最终成功不覆盖attempt记录。完整检查与性能实数见下节。

## 最终检查与测量

| 检查 | 实际结果 / 原始证据 |
| --- | --- |
| 全量Vitest | **413/413，23文件**：[日志](p2-g/full-tests.txt) |
| 类型、tsc -b、Vite生产构建 | 全部退出0：[命令/退出](p2-g/full-exits.json)、[类型](p2-g/full-typecheck.txt)、[构建](p2-g/full-build.txt) |
| 引擎/资源/扩展/来源/估算/分享基准 | **120/120，6文件**：[日志](p2-g/full-benchmark.txt) |
| 全量生产Chromium | **58/58，无skip/flaky**，连续两轮全量通过：[最终日志](p2-g/full-browser.txt)、[JSON](p2-g/full-browser-results.json)、上一轮attempt-* |
| 最终协议边界补跑 | 最后依赖100项门禁后，**413/413、120/120、类型/构建、5/5本轮Chromium**：[退出](p2-g/targeted-exits.json)、[浏览器](p2-g/targeted-browser.txt) |
| 精确索引 | **402/402、22文件；类型/构建退出0；5/5本轮Chromium**：[退出](p2-g/isolated-exits.json)、[单元](p2-g/isolated-tests.txt)、[浏览器](p2-g/isolated-browser.txt) |

工作区与精确索引相差11项来自未提交的历史P1审计测试；原db.ts用户修复未混入索引。全量覆盖P0–P2-F的schema7/旧库升级、v1–v7 JSON、子图/变异/动态Mapping/扩展/来源/估算、运行收藏留存等原回归。最后新增依赖清单门禁的边界在最终专项与精确索引验证，不把早一轮全量日志冒充该行修改后的重跑。

实际运行环境：Chromium 156.0.8078.4、Node v24.22.1、Windows x64，见[runtime](p2-g/runtime.json)。

### 真实内容与压缩率

[完整迁出前三路Candidate与步数](p2-g/full-roundtrip.json)、[最终协议边界版本三路结果](p2-g/targeted-roundtrip.json)；以下为第二轮完整回归的单次包，资源/定义UUID变化会影响不同运行间压缩字节数。

| 场景 | JSON版本 | 原UTF-8字节 | deflate字节 | envelope字符 | 结果 | 三路相同步数 |
| --- | --- | --- | --- | --- | --- | --- |
| 最小合法两节点 | 2 | 681 | 370 | 576 | 2 | 10 |
| NameScript / prefix | 2 | 766 | 395 | 609 | 2 | 13 |
| 三层P2-A子图 | 5 | 2695 | 861 | 1231 | 2 | 19 |
| P2-B变异 | 2 | 660 | 413 | 633 | 4 | 518 |
| v6 DAG / Mapping | 6 | 3747 | 1097 | 1546 | 2 | 37 |
| v7扩展闭包 | 7 | 6480 | 1543 | 2141 | 2 | 52 |

真正空DB起始9张表全0；每个包预览前后表计数一致；6个场景迁出前、JSON导入和码导入的完整Candidate及步数一致。仅新分配ID规范化，未删除来源语义字段。

[生产UI](p2-g/full-ui.json)中的便携码 1131 字符；新context仅允许127.0.0.1，外部请求为0；预览前后所有表计数不变，确认后重新运行/刷新结果相同。[预览截图](p2-g/full-preview.png)。

### 时间、UI与内存口径

[原始安全/性能](p2-g/full-security-performance.json)的1000实体词条/百万逻辑图序列化为9737字节，压缩2480字节（25.47%），3390字符。三个新Worker样本：编码端到端28.8–33.0ms（中位29.8），解码端到端16.9–17.2ms（中位17.1）。编码含Worker启动、IDB导出、JSON/哈希/压缩，解码含启动、解压/哈希/解析；**不是纯原生codec微基准**，不预测其他设备速度。

这三个样本窗口主线程10ms计时器最大间隔11.5ms，观察到>=50ms long task为0。与后续在主线程构造16MiB攻击夹具的时间/内存分开；不能用整条安全测试结束堆大小归因于产品压缩。窗口Renderer堆 11830333→11961262 字节；安全夹具结束另为 46379886 字节，包含攻击原文/压缩夹具。

16MiB炸弹通过伪造1MiB声明，约17.9ms在流式输出上限拒绝；没有完整解压后再检查。无响应Worker约8016.4ms被主线程终止；8秒是可调度页面中的定时预算，不承诺系统冻结期间绝对墙钟终止精度。

[独立分享Worker堆](p2-g/full-worker-heap.json)：10,000条快照 99548→23537 字节（23.64%），31467字符，导出/编码约83.1ms。4点CDP Worker V8 usedSize观测最大4112152字节，Renderer结束13983028字节；不是RSS或包含原生codec的绝对峰值，未测真低端/跨浏览器。大合法JSON包>1MiB UI明确拒码且仍可下载JSON。

原10k输出/157批、百万逻辑60项前缀、100k实体导入及12层子图等由原P2-E/F生产Worker全量重跑，新的原始数据另归档为[p2-e重跑](p2-g/replayed-full-docs_p2-e_worker-performance.json)、[p2-f重跑](p2-g/replayed-full-docs_p2-f_worker-final.json)。不压缩生成历史、不宣称百万输出穷尽；没有新枚举剪枝。

## 已知边界与交付判据

原图契约要求一个有输入的output，单独一个节点无法形成可运行工作流；本轮覆盖其拒绝，不擅自放宽原图语义，最小合法两节点往返已实测。

只真实验收本机生产Chromium。未安装/未实测Firefox/WebKit、真低端硬件；CPU模拟不当真实低端。Worker CDP V8 heap与Renderer heap分开，均不是RSS、原生codec绝对峰值或总进程峰值。短样本不外推尾延迟。SHA仅检错，原包权限与资源/扩展信任由原验证器决定。

上限内可离线分享；需要本地HTTP服务，无服务停止后的PWA启动。没有URL/ZIP/二维码、后端上传/云短链/远程存储。大包继续走既有JSON文件；不是“所有合法JSON包都能生成短码”。保守预算可能提前拒绝某些接近上限的包。高级枚举剪枝、原历史G/Q、Entry迁移、任意第三方JS和社区均未做。

## Git保护与隔离

实际扫描835路径，182个历史modified/untracked（不按用户估计273宣称实测）。外部字节备份、逐文件SHA、起始worktree/index binary patch已保存，见[基线](p2-g/baseline.json)；本机备份路径仅在baseline-local.json。原src/storage/db.ts、P1审计/测试/用户文档与旧阶段证据不纳入本轮提交。

PROJECT-STATUS工作区保留原字节正文，只插入P2-G节；暂存blob由HEAD正文加该节构造，避免混入原用户差异。严格白名单和所有非本轮文件SHA检查见git-isolation.json。无reset/clean/stash或覆盖历史证据；没有推送。


最终判定：预算内分享码与本地JSON降级 **CONDITIONAL GO**。条件是保留浏览器/低端/原生内存与已提交剪贴板不可撤回边界；依赖缺失时不把预览说成完整预检。P2-F枚举级剪枝NO-GO未解除。建议下一阶段验证Firefox/WebKit和实物低端、原生峰值，再独立评估更大文件的分段处理；在线分享、URL/二维码与全局Entry另行立项。
