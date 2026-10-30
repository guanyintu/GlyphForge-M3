# P2-A：参数化子图与序列函数

2026-10-31，基于 `21e0b67`。这是 P2-A 的有界实现；不改变 G01/G02/G04 等 Entry、动态资源或社区功能的归期。

## 定义、接口与版本

`Workflow.subgraphs` 是可选的嵌入定义清单，旧 version 1 工作流无需迁移。每份定义具有稳定 `id`、正整数 `version`、显示名称、参数列表、`returns: CandidateSequence`、内部节点、明确的返回节点和布局。边继续使用 `inputs`，不将原来的 members/group 或装饰分组解释成函数。

参数类型复用 S0-2 `ScalarType`，加图端口原有的 `CandidateSequence`。String/Number/Boolean 对应 string/number/boolean；标量有默认值即允许省略，没有默认值即必填。序列参数必须连线，不接受标量、AST 集合或 Pair 的隐式转换。最多16个参数、100份定义版本、2000个内部节点；主图及每份内部图分别最多200节点。

调用节点只绑定 ID/version，显示名不参与查找。同名函数及重命名不会改变引用。内部修改发布新版本，并将当前工作流直接引用旧版本的调用更新到新版本；其他工作流、历史和嵌套依赖继续固定原版本。单纯改名保持版本。旧版本不自动删除。子图库拒绝以不同内容覆盖同 ID/version；显式复制定义或冲突合并产生新 ID。

## 作用域和依赖

每次调用创建独立标量绑定和内部节点 Map，序列参数是对调用者输入迭代器的显式访问。参数绑定通过 `parameterBindings` 指向当前函数参数；不查找调用者局部变量，不允许闭包。内部节点与参数不能重名；代码中的跨作用域序列引用、参数类型不符和重复声明拒绝。不同函数内部可使用相同节点 ID。

资源 ID 和模板 slots 必须静态绑定，不能通过参数偷偷捕获资源。依赖从内部节点和 program AST 一并收集；运行快照版本清单、分享 manifest 和 Worker 版本检查覆盖内部资源。没有复制资源内容或初始化新数据库。子图依赖按 ID/version 构成 DAG；保存、导入和执行均检查所有定义，拒绝循环，最多12层。工作流自动保存允许保存尚未连好的编辑草稿，显式发布子图与运行前必须校验；再次加载仍保留草稿以便修复。

## 执行与来源

执行器直接递归求值内部节点，不嵌套调用 `execute`。总 steps、开始时间、AbortSignal、输出去重/数量、背压批次均只有一份；内层不创建新计数器。生产执行仍为300000步、10秒、10000输出、64条批次、1024代码单元/文字。Worker watchdog 与 UI 硬终止保持原生命周期，watchdog 增加结构化 BUDGET 诊断。

函数返回单一 CandidateSequence，无内部去重或截断，最终输出统一处理。序列参数按需求重放输入，保持原图笛卡尔积顺序与固定种子语义；不引入跨实例候选缓存。资源仍按256行分页读取；并发存活的迭代器可能各持有一页，空间随活跃调用/图深度增长，不能声称常量总内存。group 等旧内置算子的有界缓冲策略不变。

函数边界原样传递 Candidate；身份变换保留 Pair/members/parts/notes。改变展示文字时沿用 candidateText 失效整体 Pair/members；组合沿用 combineCandidates 保留并去重来源 parts、合并 notes。AST Pair/集合仍须原有显式投影/for/emit，不把函数返回序列冒充 AST String。历史快照包含定义，但资源仍只有当前内容与版本号，不承诺历史内容重放。

错误保留 `callId/internalId` 路径；代码生成的节点增加 line，ContractError 传播不覆盖最内层位置。静态错误提供可用的节点或代码行；依赖环和整体格式错误可能只给定义 ID/version。

## NameScript 支持范围

复用现有 ProgramParser tokenizer/Expr/sequence AST，将序列函数编译成同一子图 IR，由共享图执行器求值。示例：

```text
fn f1("stable-id", 1, "添加标记") (input CandidateSequence, tag string = "星") {
  let arg = argument("input");
  let marked = prefix(arg, tag);
  let flipped = reverse(marked);
  return flipped;
}

let words = resource("nature");
let first = f1(words, "月");
let second = f1(words);
let combined = concat(first, second, " / ");
let result = output(combined);
```

`f1` 是代码内局部唯一的函数符号，头部存储稳定 ID/version/显示名。所有函数声明在主图前；支持前向函数引用，循环仍拒绝。参数类型直接写在参数名之后。函数体为 DAG 的 let 算子/函数调用和一个 return；标量参数仅为常量、函数参数引用及负数常量，不支持任意计算表达式。内置算子按“序列输入在前、共享契约中的参数在后”排列，pattern 在此语法中为 `pattern(a, b, "AB")`。

原有图式 NameScript 的 `pattern("AB", a, b)`、sequence/program 中的 for/if/let/emit 和内置 AST 标量/集合调用保持原有语法与执行。函数体内可嵌入独立 `sequence { ... }`，但不能捕获外层函数参数或调用序列函数。暂不提供返回标量/Pair/集合的用户函数、多返回端口、递归、高阶函数、闭包或任意 TS/JS 转换。这是明确支持边界，不是这些规划全部完成。

不支持的代码在解析阶段拒绝；App 仅在完整解析和验证成功后替换工作流，保留原节点与定义。程序节点不因子图导出而丢失 AST。

## 持久化、复制与分享

定义嵌入工作流和运行记录，复用已有 IndexedDB 表，不迁移主库 schema6。另建 `glyphforge-functions-v1` 子图库，schema1，以 `id@version` 保存显式发布的定义和依赖，供其他工作流复用；它只保存小型定义，不保存词条全集。应用刷新会同时加载工作流和子图库。

节点剪贴板附带被选调用的传递定义依赖，粘贴对同 ID/version 的不同定义重分配 ID，重写内部与外部调用，不覆盖本地定义。外部连线继续显式断开并提示，缺少词库仍沿用现有提示与运行诊断。

含子图的便携包使用 v5；不含子图继续导出 v2/v4，v1～v4 导入兼容。v5 携带可达定义及内部资源的传递依赖，导入先验证版本、类型、DAG，再为定义和资源分配新 ID，最后通过既有事务写资源与工作流。失败不破坏已有资源。没有新增公开脚本执行接口、eval 或 new Function。

入口：主画布底部「子图与函数」，选择输出节点以外、单一出口的节点后封装。编辑器支持接口命名/默认值、暴露节点标量参数、添加序列参数、内部节点/嵌套调用与返回节点选择；保存后返回子图库，再返回主图配置各调用与输出。
