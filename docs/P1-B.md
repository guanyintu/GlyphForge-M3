# P1-B：关系词库与通用命名配方

完成日期：2026-10-30，Asia/Shanghai。基于 P0 提交 `399bd2d`、P1-A 提交 `8369489` 继续开发；开发分支 `codex/p1b-relations`。未重新初始化项目，未新增运行时依赖或云端服务。

## 六种配方

打开「选择配方」即可创建普通工作流。首次使用时补充九个小型示例资源；以后保留用户对这些资源的修改，不覆盖、不重复导入。配方支持节点编辑、NameScript、自动保存、复制、撤销重做、生成来源、收藏和便携包。

| 配方 | 通用组合方式 | 真实输出示例 | 可导入示例 |
| --- | --- | --- | --- |
| 情侣 ID | 多个关系槽位 + 共享变量模板 | 月亮邮差 / 星星收件人 | [couple](../examples/p1b/couple.portable.json) |
| 战队统一前缀 ID | 普通词库 + 成员分组 | 星河·彗星 / 星河·极光 / 星河·天狼 | [squad-prefix](../examples/p1b/squad-prefix.portable.json) |
| 战队主题 ID | 主题词库 + 统一模板 + 随机分组 | 极光巡游者 / 月亮巡游者 / 彗星巡游者 | [squad-theme](../examples/p1b/squad-theme.portable.json) |
| 反义词组合 | 仅 antonym 关系 + 共享前后缀模板 | 冷面骑士 / 热面骑士 | [antonyms](../examples/p1b/antonyms.portable.json) |
| 对仗关联组合 | 多个对应槽位 + 明确词序 + 等长检查 | 春风入梦 / 秋雨归心 | [parallel](../examples/p1b/parallel.portable.json) |
| 双人镜像 ID | 普通共享变量 + 可编辑的变量交换模板 | 猫追月 / 月追猫 | [mirror-pair](../examples/p1b/mirror-pair.portable.json) |

示例数据与模板由项目编写，无额外外部数据许可。重新生成这些文件：`pnpm examples:p1b`，复用真实存储与分享导出器，在 fake-indexeddb 中运行，不访问用户的浏览器数据库。六份文件均由自动化测试实际导入并执行。

情侣/对仗的左右词来自同一行，一次绑定所有模板共享；不同槽位之间才进行有界组合。反义关系必须显式标记；associated 关联、couple 情侣、parallel 对仗关联均不会自动当成 antonym。对仗只保证显式对应、模板顺序和长度约束，不承诺文学格律或词性判断。

战队按词库选择共同主题，N 与批次均可动态修改；公共前缀、可选公共后缀、分隔符和每人最大长度均可编辑。随机模式用固定种子的有界蓄水池抽样和洗牌，同版本数据可复现；关闭随机后按输入顺序选取。同一运行的各批次使用不同成员名。候选不足时明确报错，不补重复成员或循环凑数。

共享后缀、叠字和符号包裹作为通用模板能力保留，例如：`「{animal}{animal}·{sky}」` / `「{sky}·{animal}{animal}」`。镜像使用变量与槽位重排，可交换角色、倒置词序或改变结构，不限于字符倒序。

## 关系编辑器与存储

「资源中心 → 新建关系词库」提供逐行添加、修改、删除、重命名、批量粘贴、CSV/TSV/JSON 导入和 CSV/JSON 导出。关系类型有中文标签，批量文件使用英文编码。每页最多读取 60 行；类型筛选明确只针对当前页。批量 TSV 例子（列之间为 Tab）：

```text
月亮	星星	couple
冷	热	antonym
春	秋	parallel
```

CSV 支持引号、字段内逗号和换行。JSON 可以是 `{left,right,relation}` 对象数组，或导出的 `{format:"glyphforge-relations",version:1,rows:[...]}`。省略 TSV/CSV 第三列时使用面板当前选定类型；JSON 必须显式指定类型。相同资源内的「左词、右词、类型」去重；修改成已存在关系时合并行。

Dexie schema 从 2 加性升级到 3：增加 `relations` 表，保留原 `resources / entries / workflows / favorites / runs / generated`。关系资源继续使用稳定的 Resource ID，kind 为 relation；普通词条仍在 entries，关系行单独保存数字 ID、left、right、relation 和 resourceId。唯一复合索引防重复，`[resourceId+id]` 支持分页。不会将现有普通词库推断或转换成关系。

增删改在事务中同时维护资源 count/version；运行时保留完整词对、关系类型、资源版本和配方快照。删除关系资源时同时删除对应行。单独文件解析在现有资源 Worker 中执行，整批先校验再事务写入；停止或离开会终止该 Worker。提交前取消不会部分写入，已提交的整批保留。

普通分享继续导出 v2；依赖关系资源的分享包使用 v3，额外保存 relationRows。IR 和算子版本仍为 1，导入兼容 v1/v2/v3。恢复快照创建新资源 ID，并重映射槽位、pairs 节点、AST pairs 调用；轻量分享要求关系类型兼容的本地资源重新绑定。旧客户端会拒绝 v3 或未知算子。

## NameScript 与共享变量

三种新算子均注册在原算子协议中，由现有 Worker、执行限额与来源追踪管理，没有独立的配方引擎。

```text
// pairs 返回带左右端的候选序列，可直接输出以检查关系库。
let source = pairs("p1b-antonyms", "antonym");
let result = output(source);
```

```text
let names = template("[{\"name\":\"sky\",\"resourceId\":\"p1b-sky\",\"kind\":\"pair\",\"relation\":\"\"},{\"name\":\"role\",\"resourceId\":\"p1b-roles\",\"kind\":\"pair\",\"relation\":\"\"}]", "[\"{sky.left}{role.left}\",\"{sky.right}{role.right}\"]", " / ", 16, false);
let result = output(names);
```

```text
let names = resource("p1b-space");
let team = group(names, 4, 2, "星河", "队", "·", " / ", 16, true);
let result = output(team);
```

参数顺序（与节点控件共用）：

```text
pairs(resourceId, relation)
template(slotsJSON, templatesJSON, separator, maxLength, equalLength)
group(input, count, batches, prefix, suffix, separator, joiner, maxLength, random)
```

slotsJSON 中每个槽位包含 name、resourceId、kind（word / pair）、可选 relation。普通槽位使用 `{name}`，关系槽位使用 `{name.left}` / `{name.right}`。共享普通槽位可在两个模板中同时引用。没有 eval 或任意 JavaScript。节点面板可直接编辑槽位和逐行模板，不需要手写 JSON。

显式控制流新增 pair / pairs 类型和 left、right、relation 访问函数，变量作用域与原 AST 相同：

```text
for sky in pairs("p1b-sky", "couple") {
  for role in pairs("p1b-roles", "couple") {
    let shared = "小";
    if relation(sky) == "couple" {
      emit(shared + left(sky) + left(role) + " / " + shared + right(sky) + right(role));
    }
  }
}
```

pairs 的资源 ID 必须是固定字符串，relation 为空表示全部显式关系。不能把 pair 直接 emit 为文字，必须选择左右端。资源选择器选择关系库时自动生成 pairs 调用。控制流输出仍为普通字符串；通用模板/分组则额外保存 members，详情面板支持逐个成员复制。

普通 P0/P1-A 文字算子可继续加工整组显示文字；若文字发生变化，会清除已失效的成员/词对标记，继续保留原始来源。若要逐个成员添加前后缀或符号，应修改模板或 group 参数。成员分组明确拒绝把已有整对/整组当成一名成员。

## 限额与验证

- 关系端点各最多 256 个代码单元；单次文件导入/导出最多 10,000 行、导入最多 2 MB。便携包仍限 15 MB、每资源快照 100,000 行。
- 模板最多六个槽位、八个名字；单个模板最多 256 字符，槽位/模板 JSON 参数各最多 16,384 字符。
- N 和批次数均为 1–100；最多扫描 10,000 个唯一可用成员，遵守原 300,000 步与 10 秒限额。随机分组需要有界缓冲，注册协议标明非流式；普通模板惰性枚举。
- 每个名字最大长度 1–100 个 Unicode 字符簇，完整组（含分隔符）仍限 1,024 个代码单元。工作流结果上限按「组」计算，最多 10,000 组。未测大规模关系库吞吐、完整浏览器峰值内存或低端设备性能。

自动化：`pnpm exec vitest run src/tests/relations.test.ts` 31 项通过；`pnpm test` 六文件 111 项通过，含全部 P0 60 项、P1-A 20 项；`pnpm typecheck`、`pnpm build`、`pnpm bench` 通过。P0 基准独立重跑：百万潜在组合取前一万约 61 ms / 40,041 步，十万重复源约 80 ms / 200,002 步，最大批次 64；单轮数据不构成加速保证。

覆盖六配方及提交示例的实际执行/代码往返/便携包恢复、多槽位配对不串位、普通关联排除、共享槽位、动态 N 与跨批去重、镜像模板、Unicode 等长、错误与限额、活动取消、300+ 行分页、schema 2 真实升级、编辑事务、来源持久化、文件引号和协议校验、复制与历史、P0/P1-A 后续加工。

生产浏览器：原有 17 个资源和旧工作流正常读取；六配方运行通过；真实导入 parallel.portable.json 后恢复新资源并正确执行；战队在参数面板改为四人两批，再从 NameScript 改回三人两批，输出人数对应改变。自建“P1-B关系验收”逐行添加山/海，批量添加冷/热与月亮/星星并去重，修改为高山/海，JSON 导出经实际读取核对；重载仍保留三行与 v4。实际 CSS 视口 1440 与 390 宽下无文档横向溢出，390 宽关系对话框约 353 px；控制台错误/警告为零。截图：[来源与成员](p1b/detail.jpg)、[窄屏关系编辑器](p1b/mobile.jpg)。浏览器交互为人工可复核的 CUA 验证，不等同于 CI 浏览器测试。

P1-C 的联合分词/排序/动态检索与 P1-D 新动画继续独立推进。

最终构建补充复核：P0 既有 AABB + 包含猫配方仍生成八条；P1-A 实验室「明 / 思」拆解为「日、月 / 田、心」，首次约 194 ms（含字典加载，单次测量）。实验室保持原十二种文字加工选项，分组算子仅在工作流中使用。最终页面控制台错误/警告为零。
