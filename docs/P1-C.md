# P1-C：关系方向、逆向搜索与游戏规则

日期：2026-10-30（Asia/Shanghai）。范围：本轮请求的 P1-B 阻断修复、P1-C1～C4；没有开发 P1-D/P2。代码基线为审计独立提交 `a473b95`，开发分支 `codex/p1c-reverse-search`。最新验证汇总见 [验收与性能报告](P1-C-VALIDATION.md)，原始日志与截图在 [p1c/](p1c/)。

## Git 归属与恢复

开始时已读取 PROJECT-STATUS、AUDIT_P1B、git status/diff，核对审计报告中的初始工作区记录。六个源码文件、审计测试/配置、Playwright 开发依赖、审计报告及证据归属上一轮审计，独立提交为 `a473b95`。仓库没有 Git 身份，提交使用命令级 `Codex <codex@openai.com>`，没有改全局配置。

原有 `P0-CHECKLIST.md`、`P1-PROGRESS.md`、`README.md`、`VALIDATION.md` 的修改不纳入该审计提交，也没有被本轮源码开发覆盖。原始文档 diff 保存在 [user-baseline.patch](p1c/user-baseline.patch)，状态入口修改前快照为 [PROJECT-STATUS.before.md](p1c/PROJECT-STATUS.before.md)。AGENTS.md 和 docs/reference/ 维持原有文件。本轮新增功能建立在审计提交之上，未 reset、清理或重初始化仓库。

## 关系语义与数据兼容

`PairValue`/`RelationRow` 增加方向 `symmetric | directed | unknown`、`reverseQueryable`，以及可选权重（0–100）、标签（最多 16）、备注、来源。关系仍是原来的独立资源及二元行，没有增加第二套资源数据库，也没有把普通 Entry 与关系端点建立新的外键。

| 概念 | 实现约定 |
| --- | --- |
| 模板左右槽位 | 始终使用保存的 left/right；任何查询都不交换槽位 |
| 正向查询 | 从保存的 left 返回 right；与关系类型独立 |
| 反向查询 | 从保存的 right 返回 left；仅对称关系或显式 reverseQueryable=true 允许 |
| 未知方向 | 缺失字段和历史行都视为 unknown；默认只允许正向；编辑器明确显示问号并可修改 |
| 查询方向参数 | forward/reverse/both 选择沿保存端点的遍历；默认 both，但仍执行反查权限 |
| 关系类型 | associated / antonym / couple / parallel 保留；普通关联不会推断成反义关系 |
| 唯一身份 | resourceId + left + right + relation + direction；属性通过修改原行更新，不靠属性创建重复身份 |

schema 3→4 加性迁移：增加 left/right 索引和含 direction 的复合唯一索引，逐行补 unknown/false；不丢弃原表，不更改行 ID、资源版本或模板。再次打开不会重复迁移。schema 4→5 仅在同一数据库增加 `gamePresets` 表。升级不猜测历史反义词是否对称。现有六配方的输出及共享绑定通过回归。

关系文件 JSON v2、CSV/TSV 2–9 列保留全部新属性，仍读取旧 JSON v1 和旧 2–3 列文件。CSV 列顺序为 left,right,relation,direction,reverseQueryable,weight,tags,note,source；tags 使用 JSON 数组，开关使用 true/false。旧格式缺字段补 unknown/false。新关系便携包使用 v4，防止旧客户端静默丢弃方向；继续读取 v1～v3 工作流/资源包。NameScript、工作流 IR 和算子版本保持现有版本；关系候选与来源片段携带完整属性。

实现入口：[模型](../src/core/model.ts)、[关系校验](../src/core/relations.ts)、[存储与迁移](../src/storage/db.ts)、[文件](../src/core/relation-files.ts)、[分享](../src/core/sharing.ts)、[编辑器](../src/components/RelationEditor.tsx)。

## 多词库与模式逆向

[ReverseSearcher](../src/core/reverse-search.ts) 在最多 64 个字符簇、512 个 UTF-16 单元内建立输入所有连续片段，使用现有 `entries.text` B-tree 的 anyOf 查询真实条目。可选多个资源或全部资源；返回 resourceId、entryId、字符簇起止、UTF-16 起止、exact/fragment/normalized/pinyin 匹配类型。位置从 0 起，区间为左闭右开。重复文字位置分别记录。

分词采用 DAG/动态规划，每个位置保留 Top-K 路径，允许跳过一个未覆盖字符簇。按覆盖量、精确覆盖量、片段数量、稳定次序排序；完整覆盖优先，部分覆盖返回实际覆盖率。界面 K=10，API 硬上限 20。不枚举所有路径，不把重复显示词库当同一来源。

检测 AAB、ABB、AABB、ABBA、ABAB（A/B 为不同字符簇）、重复字符、重复半段和字符簇回文/镜像。关系端点使用新增索引，遵守反查权限，明确区分反义和对仗关系；“两端出现”仅是共现，不能证明生成历史或对仗质量。

简繁候选按每个原文片段调用已有 OpenCC，保持位置映射，返回真实存在的异体条目。拼音选项使用已有 pinyin-pro，按拼写比较真实词条，支持无声调连续拼音输入和中文同音候选。按资源 keyset 分页，每页最多 256 条、总扫描最多 10,000 条，达到上限明确提示；默认读音不穷尽多音字，也不承诺近音搜索。可选依赖在 Worker 内动态加载。

有限模板分析只处理已保存的共享变量 `template` 节点。用已命中的真实资源候选做有界前向验证，保留同一行左右绑定、共享变量、字数和等长约束。最多读取 20 个工作流、分析 20 个模板节点，每节点 10,000 步/100 ms/200 个唯一输出。命中可生成组合才列为“可能来源”，未穷尽会提示预算或范围限制。它不是指定完整工作流的通用逆执行；任意自定义代码不在承诺范围内。

## 三类证据

- **确定来源**：`generated` 中实际存在此文字的记录，且对应 `runs` 快照仍存在。界面不接受候选组合、收藏中的 workflowId 或词库命中作为历史证明。快照已缺失时保守降为未找到可追溯记录。
- **确定匹配**：真实词条、明确字符结构或规则/方向允许的关系匹配。简繁和拼音分别标注变换/候选类型，不冒充原文精确命中。
- **可能来源**：分词组合和已保存模板的有限可生成性验证；不写入生成历史，也不宣称真实来自该模板。

逆向页由 [专用 Worker](../src/workers/reverse.worker.ts) 查询；React 仅持有有上限的结果。可终止当前查询；取消后丢弃迟到消息，下一次新建 Worker。正常连续查询复用 Worker 及缓存。资源版本变化会清空界面和旧任务。命中可打开对应词库并定位文字；也可创建带真实资源引用和词条过滤的普通工作流，支持节点、NameScript、保存、复制和分享。部分覆盖只组合用户选择的命中片段，不把空缺自动伪造成已知词条。结果详情可跳转逆向分析。

## 索引、缓存和边界

- 词条 text 和复合索引复用现有 IndexedDB；关系 left/right 索引增量由 IndexedDB 事务维护，无全库 Trie 重建或 n-gram 副本。
- 缓存最多 8 项，以输入、选项、资源 ID/事务版本签名为键。运行历史和模板每次重新校验；资源删除/修改/导入得到新签名。读取结束再次比较资源签名，变化时拒绝发布最终结果。
- 硬限额：500 处词条命中、200 行关系、20 条分词、20 个模板推断；首查及缓存均按最多 50 条发出批次；总预算 10 秒，超限/缺资源/查询失败均有显式错误。
- 普通检索不做 offset 深页扫描；拼音使用 `[resourceId+id]` keyset 分页。旧生成器种子旋转的 offset、资源编辑器深页仍保留，不以新检索基准宣称这些路径已优化。
- JSON 导入原有 64 MB 整体解析、便携包 15 MB 整体 JSON 边界仍保留。没有新引入整库 JSON/React 拷贝；峰值内存尚未覆盖这些旧路径。

## 可配置游戏规则

[游戏规则](../src/core/game-rules.ts) 支持每种长度独立 min/max：Unicode 码点、可见字符簇、UTF-8 字节；UTF-16 仅显示为诊断指标。长度复用 [Unicode 工具](../src/core/unicode.ts)，组合 Emoji 和组合附加符号不会按 string.length 误计可见字符。

支持汉字、拉丁、全部字母、数字、组合标记、符号、标点、空白类别的并集，禁用字符、空白及特殊字符开关、零宽/默认不可见字符检测。阻止零宽选项涵盖 Emoji 连接符和变体选择符，界面明确解释；关闭时保留风险提示。NFKC 变化、拉丁/希腊/西里尔混排、Il1O0 使用有限形近风险提示，不承诺完整 Unicode confusables 数据库检测，也不查询任何游戏的注册占用。

用户在结果工作台或节点参数中创建、修改、选择、保存/另存预设到同一 IndexedDB。工作台可检查名字并查看长度、错误和风险，结果行可选中检查。`gamecheck` 节点支持 filter/annotate；NameScript 使用相同算子，AST 条件中可调用 `gamecheck(text, rulesJSON)`。节点保存规则快照，分享后独立可执行；修改预设不会暗中改变已保存工作流，需重新选用。此项是规则数据配置，不代表已核验具体游戏的当前官方规则。

本轮也补上审计 U05：结果“存为词库”事务失败会显示错误，不再产生未处理的异步拒绝。

## 留存风险与接续

P1-C 在以上限额和明确算法范围内完成子阶段闭环。原 v3.0 的整个 P1、全部资源模型及所有设备质量目标仍未完成。历史 runs 快照增长、种子旋转 offset、整体 JSON 峰值、低端设备、百万关系、跨浏览器、完整 E2E 矩阵、动画/reduced-motion 实机证据继续保留。关系端点仍是行内文本，权重只作为资源属性，不参与本次分词评分。

建议可以进入 P1-D 的有界动画开发；Q01/Q02 等质量欠项应继续追踪，不能因本次测试通过而关闭。
