# P1-B 可执行示例

在 GlyphForge 工作流页点击「导入」，选择任一文件。每个包包含运行所需的真实资源；导入会创建新的资源与工作流 ID，不覆盖本地素材。

| 文件 | 配方 |
| --- | --- |
| [couple.portable.json](couple.portable.json) | 情侣：月亮邮差 / 星星收件人 |
| [squad-prefix.portable.json](squad-prefix.portable.json) | 战队统一前缀：三人，可编辑 N、批次、前后缀与分隔符 |
| [squad-theme.portable.json](squad-theme.portable.json) | 星际主题：三人两批、统一结构、随机去重 |
| [antonyms.portable.json](antonyms.portable.json) | 反义：冷面骑士 / 热面骑士，排除普通关联行 |
| [parallel.portable.json](parallel.portable.json) | 对仗关联：春风入梦 / 秋雨归心 |
| [mirror-pair.portable.json](mirror-pair.portable.json) | 双人镜像：猫追月 / 月追猫 |

所有文件由 `pnpm examples:p1b` 调用实际导出器生成，并在 `relations.test.ts` 中实际导入和执行。[完整说明](../../docs/P1-B.md)。
