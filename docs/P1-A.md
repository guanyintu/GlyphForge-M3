# P1-A 中文文字与实验室

本阶段沿用 P0 的候选序列、统一算子注册表、图 IR、AST 解释器、Worker 和资源分享协议。没有建立另一套文字实验算法或数据库。后续 P1-B 已完成，见 [关系词库与配方](P1-B.md)；P1-C / D 尚未开发。

## 使用

侧栏打开「文字实验室」，每行输入一条文字，选择算子并开始实验。可以勾选候选、批量复制、继续加工、恢复最近八步的结果，或另存到新词库。取消、超时和执行错误保留上一次完成的结果。离开实验室终止任务；加工记录只在本次页面会话内保留，长期保存请另存词库或工作流。

汉字结构输入例子：

- `明` → `日、月`（左右）；`思` → `田、心`（上下）。
- 拆解结果选中后选择「部件反查与组字」，精确模式查到 `明`、`思`。
- `木、木` 可以找到 `林`，保留部件重复次数。
- 指定部件搜索使用「包含指定部件」，勾选递归可以搜索内部部件；精确模式在递归时比较指定深度内的末级部件集合。
- 结构描述和未编码部件编号均不代表真实汉字。组字只返回收录的 Unicode 汉字，不组合虚构字符。

## NameScript

图中新增算子均为单输入序列算子，参数顺序如下（必须显式填写所有参数；节点面板、实验室提供默认值）：

```text
pinyin(input, mode, tone, separator, limit)
homophones(input, matchTone, limit)
rhyme(input, reference, matchTone)
hanconvert(input, mode, probability, limit)
mapchars(input, mappingJSON, probability, limit)
decompose(input, depth, structure)
components(input, depth)
compose(input, match, deep, structure, minStrokes, maxStrokes, limit)
hanfilter(input, structure, minStrokes, maxStrokes)
```

`pinyin.mode`：`pinyin / first / initial / final / tone / polyphonic`；`tone`：`symbol / num / none`。首字母固定去调，声母使用标准模式，零声母显示 `∅`；轻声数字为 `0`，关闭口语变调。非汉字保留，缺失生僻字读音时不编造读音。多音模式按单字枚举候选读音，其组合不保证符合词义、姓氏或语境。

`hanconvert.mode`：`traditional / simplified / martian`。简繁是 OpenCC 的 `cn ↔ t`；不是台湾或香港用语本地化。火星文是项目自编的 20 字趣味候选表，没有统一标准；未覆盖字符保留。自定义映射为 JSON 对象，键是单个码点，值是候选字符串数组，例如 `{"月":["玥","鈅"]}`。

`structure`：`any / left-right / top-bottom / enclosure / other`。递归深度 1–6；每条输入最多 1–128 个拼音、映射或查询候选。笔画范围 0–64，存在地区异体笔画值时任一满足即通过，缺失数据不算零画。`compose.match` 为 `exact / contains`，精确组字忽略部件排列次序，比较重复次数，不能确定唯一字形布局；可通过结构筛选缩小范围。

`probability` 为 0–1，固定种子、输入和参数可复现。按字符簇决定是否替换，命中后有界枚举多个候选；概率不是每个候选的独立抽样权重。简繁先按完整词组转换再按位置选取；字符簇数变化时按整条概率处理。概率小于 1 可能产生混合简繁。

显式控制流中的中文函数接收**单条字符串**、返回候选集合，仍调用同一算子实现：

```text
for source in ["明", "思"] {
  for parts in decompose(source, 1, "any") {
    emit(parts);
  }
}
```

普通图的例子（`source` 需在资源中心建立或重新绑定）：

```text
let a = resource("source");
let split = decompose(a, 1, "any");
let restored = compose(split, "exact", false, "any", 0, 64, 64);
let spelling = pinyin(restored, "pinyin", "symbol", " ", 32);
let result = output(spelling);
```

图与代码往返、参数编辑、撤销重做、便携包资源恢复继续采用 P0 协议。新增算子版本为 1，IR 仍为 1，分享包仍为 2。旧 P0 客户端会明确拒绝未知算子；不承诺旧客户端能够执行新算子。

## 数据与许可

- [CJK Decomposition](https://github.com/amake/cjk-decomp) 原作者 Gavin Grover，amake 修订，固定提交 `c29b391fd6267e7a3541387e03a3dd60b1cd34d1`。采用其明确允许选择的 Apache-2.0，保留原 README 和许可。转换为 85,238 条结构记录（包含约一万条未编码的中间部件编号，不是 85,238 个真实汉字）。覆盖旧版统一汉字与扩展 A–D，通常只选一种大陆字形分析；数据已停止维护，不能视为全部结构或全部现代扩展汉字的权威全集。解析器支持多记录、深度限制和环路保护；没有数据的字符不推测拆分。
- [Unicode Unihan 17.0.0](https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip)：取 `kTotalStrokes` 102,998 字、`kMandarin` 44,348 字。遵守 [Unicode License V3](https://www.unicode.org/license.txt)。同音索引只使用该字段的收录读音，不保证每个多音字的全部异读可被反查。
- [pinyin-pro](https://pinyin-pro.cn/use/polyphonic.html) 3.29.5：MIT；[OpenCC JS](https://github.com/nk2028/opencc-js) 1.4.2：实现 MIT，词典 Apache-2.0。许可副本在 `public/licenses/`，安装版本锁定在 pnpm-lock.yaml。

再生成结构、笔画及读音数据：`python scripts/prepare-chinese-data.py`（开发时需网络；应用运行不需要外部 API）。原始输入 SHA-256、固定版本和条数见 `src/data/chinese/sources.json`。依赖许可证位于 `public/licenses/`，发布 `dist` 时也会包含这些文件。

## 性能与边界

所有大型库通过动态 import 在执行 Worker 内按需加载；普通工作流和首页不解析中文字典。实验室复用一个 Worker，模块、同音索引和浅/深部件倒排索引在该 Worker 生命周期内复用；取消会终止 Worker，下一次重建。字典为只读版本化构建资源，不依赖可变用户词库，因此无需随词库编辑失效。这不替代 P1-C 的可变词库检索索引。

沿用 300,000 步、10 秒计算和 10,000 个唯一结果的引擎限额，实验室外加 15 秒墙钟保护（含加载）。每批输出 64 条，界面每页最多 60 条，最多保存八步结果。映射 JSON 最多 16,384 个代码单元、256 个键、每键最多 32 个候选；输出仍限 1,024 个代码单元。另存词库仍遵守 P0 每条 256 个代码单元限制；事务失败不会留下空资源。

押韵目前采用现代普通话末字韵母严格相等，不提供十三辙、古音或跨韵部近韵。候选有上限且不按词频排序，不将“没有显示”解释为“绝对不存在”。
