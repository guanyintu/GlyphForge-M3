# PlayerTrack 本地聚合词库

2026-11-11。实际数据、质量口径与测试见仓库根目录 [语料报告](../../PLAYERTRACK_CORPUS_REPORT.md) 和 [接入审计](../../PLAYERTRACK_DICTIONARY_AUDIT.md)。

打开 GlyphForge 侧栏「FF14 玩家语料词库」安装单套或六套风格；「基础素材与全量审核」另外按需安装。素材、权重、标签、审核与启停独立保存。AUTO 可以生成，PENDING/REJECTED 默认不能生成。未知素材先改语义标签、人工审核，再启用。

在词库详情选择模式与长度，点击「使用此词库生成」。海都默认 2～3 字，其他风格默认 2～6 字；普通生成界面可继续调整。点「编辑」可复用原资源节点、语料组合、concat/pattern、NameScript 和便携工作流。跨库组合直接使用两个独立资源，不必复制词条。

「导出词库 / 导入 JSON」保存完整元数据和关系。重复导入按文本、关系端点追加，保留本地已存在项的标签、统计和审核；从空浏览器导入可以完整恢复。工作流便携包也携带语料元数据；轻量包依赖本地词库。不要用原有纯文本词库导出代替完整语料备份。

重新处理本机原库：

```powershell
python scripts/playertrack_corpus.py
python scripts/test_playertrack_corpus.py
python scripts/report_playertrack_corpus.py
```

可以传 `--db`、`--out`；WSL 显式传 `/mnt/c/Users/.../AppData/Roaming/XIVLauncherCN/pluginConfigs/PlayerTrack/data.db`。正常处理和测试只需 Python 标准库，不联网。数据库正在变化时校验会拒绝产物，应等待 PlayerTrack 空闲后重试。

`lexicon.json` 是人工边界和风格种子，`boundaries.tsv` 是 jieba 0.42.1 通用边界子集；来源、筛选条件和 SHA 在 `boundaries.source.json`，MIT 许可在 `jieba-LICENSE.txt`。重建子集可运行 `python scripts/build_playertrack_boundaries.py <jieba-0.42.1.tar.gz>`，它不接触玩家数据库。常规运行不需要重新下载第三方资源。

数据文件只含聚合频率与提取素材，没有玩家 ID 或完整玩家名单。单字/多字长度文件互斥；叠字、位置、关系文件是附加视图，不应加总成不同素材数。

推荐直接在生成首页点击六套 FF14 工作流卡片；无需先进入语料页安装。完整可导入工作流在 public/workflows，每套含两个资源快照；运行 `node scripts/export-playertrack-workflows.mjs` 可重建。原语料管理入口继续用于审核、标签、权重与启停。
