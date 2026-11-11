# PlayerTrack 词库与工作流接入审计

2026-11-11。本轮按最新用户指令把六套风格作为首页可选工作流交付，并用网格卡片替代原工作流下拉框。实现、真实失败、验证与文件范围见 [工作流与卡片记录](docs/FF14-WORKFLOW-CARDS.md)，完整聚合数据见 [语料报告](PLAYERTRACK_CORPUS_REPORT.md)。

复用 schema7、Resource/Entry/relations、现有 Worker/图/NameScript/运行与收藏；新增可选 corpus 元数据和有界组合节点。词库独立保存，手工权重与统计权重分开，位置统计按精确原名称长度分层。JSON、v6 便携工作流和重复安装均有测试；待审和拒绝项不进入生成。

本轮发布基线为线上 main / 4875d034de83ece35d0be181dbd3a0df2f5dd231。保留 M3 来源清理与配置门禁，不删除旧配方或用户数据。发布代码清单与 SHA 见 [冻结文件清单](docs/playertrack/prepublication-files.json)；六套独立包见 [工作流清单](public/workflows/playertrack-manifest.json)。

本地验证为 467 项单元、30 项生产 Chromium、6 项 M3 mock Chromium、7 Python、类型与生产构建通过，SQL/guard/配置拒绝/扫描负向检查沿用现有发布门禁。完整证据位于 [本轮目录](docs/playertrack/)。这些不等于真实 Supabase、跨浏览器或实物低端验收。

11,019 个聚合素材包含 620 AUTO 和 10,399 PENDING；1,324 个关系候选默认待审停用。自动边界/风格仍含启发式，真人词库质量验收未完成；实际数据只有 1～6 字，长名称处理另有合成测试。未把发布称为整份 v3.0 规划完成。
