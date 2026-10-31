# P2-D 验收：可信声明式算子扩展与版本注册

日期：2026-10-31，Asia/Shanghai。基线 `4633833052c4cda23b45ed82c350c0d5bfd7998b`，分支 `codex/p2-d-packs`。开始读取 AGENTS、PROJECT-STATUS、P2-C 架构/验收、P2准入、S0-2验收及v3参考P2规划，核对实际源文件；没有重做已GO的P2-C。范围见 [架构](P2-D-ARCHITECTURE.md)。

**结论：P2-D 上述有界声明式扩展闭环 GO。** 完整P2及v3.0仍未完成。声明式流水线与任意第三方脚本是不同安全边界；测试数量不构成通用插件生态完成证明。

## 验证入口与证据

| 检查 | 本轮结果与证据 |
| --- | --- |
| 最终工作区 Vitest | **355/355，20文件**，原327项与28项扩展专项：[日志](p2-d/tests.txt) |
| 类型 / 生产构建 | tsc --noEmit、tsc -b、Vite build均退出0：[类型](p2-d/typecheck.txt)、[构建](p2-d/build.txt)、[退出记录](p2-d/check-exits.json) |
| 基准及专项 | **62/62，3文件**：引擎、资源DAG/逻辑规模、扩展安全与预算：[日志](p2-d/benchmark.txt) |
| 新增生产 Chromium | **4/4**定向通过：[日志](p2-d/browser-targeted-green.txt)；全量见最终记录 |
| 全量生产 Chromium | **47/47**（原42项+5项本轮），无skip/flaky：[日志](p2-d/browser.txt)、[JSON](p2-d/browser-results.json) |
| 精确索引源码 | **344/344，19文件**，类型/构建均退出0：[单元](p2-d/isolated-tests.txt)、[退出](p2-d/isolated-exits.json) |
| 隔离源码生产 Chromium | 独立4176端口，**5/5**：[日志](p2-d/isolated-browser.txt)、[JSON](p2-d/isolated-browser-results.json)、[退出](p2-d/isolated-browser-exits.json) |

使用本地 Node24.22.1、Vitest3.2.7、Playwright1.64.1、Chromium156.0.8078.4、Windows11 专业版10.0.26200，1440×1000，单Playwright worker。无Firefox/WebKit或实物低端覆盖。生产构建保留已有中文数据大chunk与静/动态import混用警告，未宣称包体优化。

## D1–D5 验收对应

| 需求 | 实施与实际验证 |
| --- | --- |
| D1 共享协议 | 精确pack/operator身份、publisher/source、IR/contract兼容范围、序列类型、参数默认/验证、增量/确定性/共享预算、精确依赖、显式迁移与JSON格式；内置ID遮蔽/同版本覆盖/错误版本拒绝 |
| D2 安全机制 | 可信随代码发布声明+未知发布者默认禁用；白名单流水线复用旧执行器；无外来脚本/网络/文件权限；循环/深度/大小/原型键/恶意资源/权限/代码/压缩封装拒绝与安装原子性专项 |
| D3 可用界面 | 安装/导入/导出/启停/卸载/详情/依赖/状态；两个真实扩展算子加入现有工作流，编辑参数，经生产Worker获得结果；迁移/降级错误；禁用卸载后原节点仍在，图与Inspector显示缺失状态 |
| D4 分享和资产保护 | v7必要packManifest与资源传递闭包；真实独立context清空所有表，阻外部HTTPS、保留本地HTTP，导入并通过生产Worker重算；动态源/Mapping/子图引用重分ID，包精确版本不替换；失败事务及冲突不写入部分资产；原v1–v6回归 |
| D5 纵向验收 | UI安装→编辑→Worker→收藏/刷新/禁用/卸载/恢复；另一场景真实NameScript/P2-A/动态Mapping→Worker→P2-B动态词库替换及前后缀→收藏→分享→空DB恢复；预算/取消、百万逻辑组合前缀、旧阶段全量回归及精确索引独立测试 |

28项扩展单元包含：第一方/伪造publisher区别、未知包手动启用、两个算子/代码/子图一致、剪贴板声明与冲突、Pair/members失效和原parts/notes、运行中禁用拒绝批次及done、卸载恢复不改图、精确版本并存、参数重命名迁移/降级拒绝、断依赖与循环/14层DAG、同版本覆盖、11类恶意声明、原型键/深JSON/压缩封装/巨大文件/隐藏资源参数、AST/lab不适用、百万组合惰性前缀/共享预算/AbortSignal、v7资源与包闭包/UUID冲突、事务写失败全部回滚、导入不重新启用禁用包、真实schema6数据库升级资产相等及迁移后不依赖未用旧版。

五条新生产浏览器测试位于 [packs.spec.ts](../e2e/packs.spec.ts)。安装页面 [截图](p2-d/installed.png)，空库前后完整结果/包/来源/运行快照见 [roundtrip](p2-d/offline-roundtrip.json)。UI用例检查pageerror为空，已有收藏刷新后可见。另有Web Lock阻塞启动→立即停止→释放→准确取消落盘的确定性竞态测试。新测试harness仅构建到dist/packs-harness，不进入生产入口。

空DB恢复场景的子图和NameScript由测试helper构造并真实解析执行，主图安装/编辑/运行/收藏/启停/卸载/恢复走UI。原P2-A/C全量浏览器另外覆盖子图和动态资源编辑UI；不把helper构造宣称为全UI操作。v7分享工作流和资源声明，不自动搬迁收藏全集；收藏跨刷新在原DB验证，空DB恢复后重新运行并保留真实新资源身份。

## 性能和取消口径

[生产Worker原始数据](p2-d/browser-benchmark.json)记录1000×1000真实静态源行构成的**百万逻辑组合**，扩展组合过滤只消费前60条，**72.8ms / 378步**（引擎22.9ms）。耗时ms含Worker启动、运行持久化和结果消息；stats.duration仅引擎时间，totalIncludingCancelMs还含另一个取消任务及迟到检查。mainHeap=11,522,468字节，仅renderer结束时的一次采样，**不是Worker、RSS或峰值内存**。

生产取消场景另起相同规模重复结果洪流，terminate Worker、写cancelled并检查后续无消息。单元另外测试AbortSignal和20步共享预算；旧生命周期全量回归继续覆盖硬取消/预算/恢复/留存。此测试不承诺穷尽百万输出、恶意脚本隔离或百万实体导入性能。P2-C十万/百万资源前缀与P1实体导入基准仍按各自口径保留。

## 真实失败和修复

- 首轮原327项为325通过、2失败：[日志](p2-d/tests-first.txt)。失败是旧测试固定断言schema6；升级新增表后改为schema7，原资产相等断言保留，并新增真正原生schema6夹具验证升级。
- 新专项首轮23/25：[日志](p2-d/packs-first.txt)。Pair测试错误地经普通resource输入关系候选，改为pairs；另一个是实际v7 exporter对内存对象保留undefined，严格JSON边界拒绝，修复exporter返回真正JSON对象。
- 新专项第二轮24/25：[日志](p2-d/packs-second.txt)。mapchars对恒等映射仍添加领域注记，测试改为确认原注记保留，继续检查文本、Pair/members及parts；没有删掉领域行为。
- 首次全量生产Chromium **45/46**：[日志](p2-d/browser-full-red.txt)、[JSON](p2-d/browser-full-red-results.json)。旧生命周期夹具在“running=0”时立即读取取消计数，观察到19/20。通过Web Lock精确阻塞最后一次beginRun，确认running=0也可能表示尚未插入；释放后正确写cancelled。修复夹具为等待原定20条持久取消记录，保留锁释放/切图/崩溃断言，没有降低数量。新增独立确定性场景，见 [观察值](p2-d/startup-diagnosis.json)、[定位日志](p2-d/startup-lock-green.txt)。最初用资源写事务阻塞时观察读取也被排队，改用Web Lock；仅测试时序修复，没有改变产品取消/留存语义。
- 新浏览器首轮2/4：[日志](p2-d/browser-targeted-red.txt)、[JSON](p2-d/browser-targeted-red-results.json)。新夹具同名按钮定位缺少包名范围，变异helper把source/settings签名写错；修正fixture后4/4。没有放宽实际结果、来源或持久化断言。

## Git隔离与原资产保护

起始145个历史modified/untracked文件及一个本轮基线helper字节备份至独立临时目录，保存Git binary diff及SHA-256。本地baseline-local清单索引原始备份；[基线SHA/归属摘要](p2-d/baseline-summary.json)排除本轮helper，列出145个历史文件。[保护摘要](p2-d/original-files.json)和[索引归属](p2-d/git-isolation.json)记录最终结果。新分支，无reset/clean/stash，没有操作用户真实浏览器数据库。

只有db.ts和PROJECT-STATUS与旧差异重叠：db索引只添加extensionPacks属性与schema7表，旧4行关系编辑修复逐字保留在工作文件；状态只提交新增P2-D节，旧正文按HEAD保留，工作文件中的用户/历史状态修改不变。历史文档/未提交审计测试/e2e修改不纳入提交。全量测试会写历史证据，验证runner在finally恢复原字节，当前完整stdout保存在p2-d（仅统一换行、去除行末空白及末尾空行，不改消息和数值）。隔离测试由精确Git索引导出，不借用未提交审计代码；差额11项沿用前阶段归属。31个源码/测试/验证脚本与独立检查快照逐项匹配，见 [提交源码匹配](p2-d/validated-source-match.json)；环境实测见 [environment](p2-d/environment.json)。

```powershell
node scripts/validate-p2-d.mjs            # 全量单元、类型、生产构建、专项、Chromium
node scripts/validate-p2-d.mjs --targeted # 浏览器仅五条P2-D，其余仍全量
node scripts/isolate-p2-d.mjs            # 从精确索引导出独立源码
node scripts/verify-isolated-browser-p2-d.mjs # 独立4176端口，P2-D浏览器
```

## 保留风险与范围

受支持的是有限白名单声明式工具，不是任意第三方JS插件。自定义代码仅有 [威胁模型/未来隔离路径](P2-D-ARCHITECTURE.md)，本阶段没有启用脚本；同源Worker不作为恶意代码沙箱。没有签名市场、撤销服务、任意子图包、自动版本求解/升级、多包大规模目录或任意AST/lab算子注册。

声明比较采用精确JSON内容；字段顺序不同可能被视为未验证/冲突，保守拒绝而不猜测等价。依赖安装要显式提供完整闭包；删依赖后必须恢复缺失版本，相关图原样保留。子图库保存声明但不自动替用户安装/启用。旧静态内容归档、跨ICU逐字节复现、完整Worker/RSS峰值、跨浏览器与实物设备、G01～G09/Q01～Q03其余缺口继承历史状态。阶段GO只适用于本次有界声明式扩展闭环；完整P2和v3.0仍未完成。
