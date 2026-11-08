# 原版 xlsx 接入 GlyphForge

2026-11-09。用户要求是把原版做进产品，而非只在聊天中生成样例。本轮新增可直接选择的「海都潮人 ID · 原版 xlsx」工作流；此前扩充版保留。原版工作簿不修改，历史词库、收藏、草稿及联网关闭状态保持。

## 实际改动

- 只读提取原五列公式使用的四列词库，来源表格坐标、原始重复行、公式、作者/版本与校验和存入独立 catalog；原版素材为 61/78/195/201 行。
- 现有资源唯一约束归并一行重复双字前缀，四个静态池为 61/78/194/201 词，四个动态抽样定义；v6 便携包全部携带，不把词条写入节点或生成公式。
- 小xx和直出均读取原版双字后缀 B 列；五种拼接使用原 AST/引擎，不混扩充版素材或评分关系。普通界面直接选择，点击编辑才显示画布；新增普通选择器的通用配方入口，未做独立生成器。
- 默认合并生成 75 个唯一结果，保持现有预算/有界抽样/种子/去重。没有承诺 Excel RAND 逐格同分布、重复行权重或每列15个并排呈现；这些差异在使用说明明确保留。未将本轮称为整个 v3.0 完成。

## 本轮验证

6/6 新单元和全部 442/442 单元通过；18/18 Chromium 通过（4 原版、7 原海都、7 普通/编辑模式）；类型检查、tsc -b、生产构建通过。覆盖原词条完整性、五公式/B列直出、固定种子/长度/去重、独立资源修改后真实 Worker 结果更新、八资源便携包空库往返、并发安装只建一份、旧编辑/收藏保护、手机/刷新普通模式。

首轮浏览器测试在加载 JSON 测试夹具时遇到 Node 的 import attribute 要求，尚未运行产品用例；改为测试工具 readFileSync 读取夹具，随后 18/18 通过，失败日志保留。执行器、AST 语法、资源 schema 和社区代码未修改；本轮未重跑此前 79 项完整浏览器和 120 项基准，前轮记录属于 e06c128。发布/线上结果待后续记录。

## 文件清单

- 数据与便携：examples/haidu-chao-ren.original.catalog.json、haidu-chao-ren.original.portable.json、haidu-chao-ren.original.README.md。
- 来源提取与构建：scripts/import-haidu-xlsx.py、scripts/export-haidu-original.mjs。
- 工作流/安装/入口：src/core/haidu-workflow.ts、src/storage/haidu.ts、src/App.tsx、src/components/WorkflowGenerator.tsx。
- 验证：src/tests/haidu-original.test.ts、e2e/haidu-original.spec.ts；CI 加入原版浏览器用例。
- 文档：本页、PROJECT-STATUS.md、项目和海都 README。

证据：[442单元](haidu/original-all-unit.txt)、[18浏览器](haidu/original-browser-second.txt)、[首轮加载失败](haidu/original-browser-first.txt)、[类型](haidu/original-typecheck.txt)、[构建](haidu/original-build.txt)。
