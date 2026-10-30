# P1-D：结果展示与轻量动画验收

日期：2026-10-30（Asia/Shanghai）。开发基线 `be0dc0a`，沿用 `codex/p1c-reverse-search`。本轮只实现 P1-D，不改变 Candidate、数据库 schema、执行器或生成顺序。最终代码版本由 [manifest.json](p1d/manifest.json) 的 SHA-256 索引。

## 实现与 P0 集成

- 结果区新增「漂浮碰撞」。以带随机偏移的网格空位初始化，随机初速度、正弦微漂浮、速度阻尼、矩形碰撞避让、边界反弹；三轮位置纠正，仅对相向速度施加冲量。不是高精度刚体物理。
- 保留 P0「爆炸散开」与「灵感动画」（抽卡）的实现和数量限制；三个动画入口共享同一结果、收藏、复制、导出和来源按钮。爆炸仍是有限 CSS 入场；持续运动由独立漂浮模式提供，不强制接管旧模式。
- 列表/卡片/旧动画模式对仍挂载的可见候选采用 320ms WAAPI FLIP；物理模式排序/筛选后保留同 key 的位置，用短暂目标牵引洗牌。纯展示去重开关复用原结果管线，不改生成集合。引擎本来已去重，因此正常生成结果切换去重通常没有数量变化。
- 使用 `Intl.Segmenter` 扩展高亮到完整字符簇，保留原有字面包含筛选语义。组合附加符号、肤色、旗帜和家庭 Emoji 不被拆断。只有匹配部分有底色，开启动态时短暂强调。
- 收藏先同步调用原操作，再对星标进行 340ms 回弹/光晕，动画不等待或延后 IndexedDB 操作。复用收藏持久化及来源元数据。
- 暂停、继续、停止，18 秒可见活动时间后自动停止；关闭动画、reduced-motion、document.hidden、视野外时取消 RAF。恢复时清除上一帧时间，避免位置跳跃；暂停时间不计入自动停止期限。
- 全局开关沿用原 localStorage 键；动态监听系统 reduced-motion 变化，同时关闭物理、FLIP、爆炸、抽卡和高亮入场。收藏反馈及复制提示定时器均有清理。

## 性能边界和架构

| 模块 | 责任 |
| --- | --- |
| [physics.ts](../src/animation/physics.ts) | 视觉 Body、空间容量、碰撞/阻尼/约束、帧预算；不依赖 Candidate |
| [loop.ts](../src/animation/loop.ts) | 单一有归属的 RAF、暂停/重启/销毁、自动截止 |
| [useResultMotion.ts](../src/animation/useResultMotion.ts) | DOM transform、媒体/可见性/IntersectionObserver 生命周期、FLIP |
| [highlight.ts](../src/animation/highlight.ts) | 复用既有 Unicode 分段，按完整字符簇标记字面命中 |
| [Results.tsx](../src/components/Results.tsx) | 原筛选/排序/收藏/导出集成、模式控件、稳定 key、可见结果窗口 |
| [p1d.css](../src/p1d.css)、[main.tsx](../src/main.tsx) | 复用绿色/紫色/暖色标签与响应式布局，导入样式 |

物理输入先截取最多 48 条；再按容器宽高的 156×54px 单元限制密度，标签最高 144×42px。桌面本次为 42 个，390px 手机尺寸为 10 个；不是所有设备固定展示 48 个。小容器继续减量，零结果不创建物理循环。其余结果仍由原虚拟列表/卡片访问，复制/导出始终使用完整的当前筛选集合。

低核数（≤4）或公开内存提示≤4GB，初始最多 20 个；持续 45 个 RAF 间隔平均超过 30ms，full→low（20 个、物理绘制最多约 30Hz），再次超预算转 static（12 个、无物理 RAF）。该降级在当前结果组件生命周期内不自动升级，以免反复切换；换页面重新进入会重新评估。6 倍 CPU 节流本身若仍能保持帧预算，不人为强制降级。

位置、速度、运行状态都在动画 refs 中，每帧只更新有限 DOM transform，不调用 React setState；只有质量等级或停止状态变化进入 React。每帧最多 48² 对候选的有界比较，没有新依赖。布局测量只在可见候选、展示/布局改变时进行；ResizeObserver 变化后立即按空位重排，防止窄屏时旧坐标堆叠。关闭或暂停后撤销 will-change。

## 分阶段检查

1. **D1**：读取状态、P1-C 架构/验收与 v3.0；检查 Git diff 和提交，重新执行原 168 项，全部通过。保存 [用户原始差异](p1d/user-baseline.patch.gz)、[Git 起始状态](p1d/git-before.txt)、[进度原文](p1d/P1-PROGRESS.before.md)；未 stash、清理、覆盖或强制切分支。
2. **D2**：先完成物理与循环模块，16 项专项计算/边界测试通过后接入 UI。
3. **D3**：增加 FLIP、字符簇高亮和收藏反馈，最初 20 项专项测试、类型检查及生产构建通过；浏览器验证重排稳定 DOM、原文高亮和收藏重载。
4. **D4**：真实浏览器发现暂停时原生 cancelAnimationFrame 被错误地当作调度器成员调用，修复为显式包装调用；手机截图发现缩放时边界堆叠，补充立即空间重排和回归。5 项专项 Chromium 用例全部通过后进行最终 D5。
5. **D5**：补充长帧不延长自动停止期限、JSON 不含视觉坐标、实际重新生成等断言，执行下方全量回归与最终测量。

初始失败保留于 [首轮浏览器日志](p1d/d3-d5-browser-initial.txt) 和 [第二轮日志](p1d/d4-browser.txt)。第二轮另一处失败是测试未归一化 Windows 剪贴板 CRLF，名字本身没有变化；手机卸载测试需恢复桌面宽度才能点击折叠的导航，亦已修正。最终结果以下方记录为准。

## 实际检查与覆盖

最终命令、浏览器数据见 [tests.txt](p1d/tests.txt)、[typecheck.txt](p1d/typecheck.txt)、[bench.txt](p1d/bench.txt)、[browser.txt](p1d/browser.txt)、[浏览器 JSON](p1d/browser-results.json)、[性能 JSON](p1d/performance.json)。

| 命令 | 最终实测结果 |
| --- | --- |
| `pnpm test` | **190/190，13 文件**；原 168 项 + 本轮 22 项，3.43s |
| `pnpm typecheck` | 退出码 0 |
| `pnpm test:e2e` | **15/15 Chromium**；原 10 项 + 本轮 5 项，浏览器约 2 分钟；先执行严格 tsc -b 与 Vite 生产构建，构建 11.82s |
| `pnpm bench` | 原执行器基准 **2/2**；10,000/百万潜在组合与 100,000 重复源扫描均通过 |
| `git diff --check` | 通过；本机 CRLF 提示不影响运行，证据 [diff-check.txt](p1d/diff-check.txt) |

最终退出码见 [check-exits.json](p1d/check-exits.json)。

| 验收项 | 实际证据 |
| --- | --- |
| 0/1 结果 | 筛选无命中时空态并销毁循环；恢复后重新创建；单个候选正常展示 |
| 20～60 候选 | 60 源候选、桌面受控物理；四边反弹/碰撞/长时间不重叠由纯计算验证，浏览器采样检查矩形重叠与越界 |
| 1,000+ 结果 | 1,200/2,000 结果真实生产 Worker 生成，物理数≤48；低设备提示下 1,000 条最多 20 个 |
| 模式/暂停/停止 | 冻结前后帧计数不增长；动态关闭/开启、reduced-motion 切换、旧模式回归 |
| 生命周期 | 模拟 hidden/visibilitychange；实际 IntersectionObserver 视野外暂停；resize 后约束；实际导航卸载，观测所有待执行 RAF 为 0，旧容器帧计数不变 |
| 筛选/排序/去重 | 派生结果内容正确，同文本 DOM 标记仍保留；排序有实际 WAAPI；原 Candidate 不写坐标 |
| Unicode | 重复猫字、字面正则标点、扩展汉字、组合字符、Emoji/肤色/旗帜完整字符簇 |
| 收藏/复制/导出 | 收藏状态与重载持久化；只看收藏；剪贴板真实读回；TXT/JSON 下载原文/数量一致，不受受控展示数量影响 |
| 降级/自动停止 | 低设备提示上限、18 秒实际停止；6× CDP CPU 和单列出的受控主线程压力 |
| P0～P1-C 回归 | 原 168 项单元/集成、原 10 项 Chromium、真实关系/中文实验室/逆向/规则/生成 Worker/取消/存储回归 |

新增测试位于 [p1d-motion.test.ts](../src/tests/p1d-motion.test.ts)、[p1d-highlight.test.ts](../src/tests/p1d-highlight.test.ts)、[p1d.spec.ts](../e2e/p1d.spec.ts)。浏览器测试全部使用 Playwright 独立 context 与实际生产构建，样本写入其隔离 IndexedDB 后由真实执行器生成；不接触用户浏览器 profile。

截图已打开目视检查：[桌面漂浮](p1d/physics-desktop.png)、[手机漂浮](p1d/mobile-physics.png)、[局部高亮卡片](p1d/highlight-cards.png)。手机结果区无横向溢出，标签在显示边界内；长名字省略，仍可查看完整来源详情和复制。

## 最终性能实测

环境：Windows 11 专业版 10.0.26200，Intel i5-13600KF / 20 逻辑处理器，Chromium navigator.deviceMemory 提示 32GB（浏览器提示值，非整机内存测量）；Node 24.22.1、pnpm 11.25.0、Playwright 1.64.1、Headless Chromium **156.0.8078.4**。1440×1000 CSS 像素，真实生产 Worker 生成 2,000 个名字，物理只展示 42 个。CPU 节流通过 CDP `Emulation.setCPUThrottlingRate` rate=6。

| 条件 | 采样时长 / RAF 样本 | 平均 / P95 / 最大 RAF 间隔 | 物理更新/对象/状态 | 长任务（>50ms） |
| --- | --- | --- | --- | --- |
| 正常 CPU | 2,006.4ms / 117 | **17.14 / 16.8 / 50.0ms** | 117 / 42 / full | **1 次，最大 55ms** |
| CPU 6× | 2,012.5ms / 92 | **21.78 / 33.4 / 50.0ms** | 92 / 42 / full | **0 次** |
| CPU 6× + 每帧注入 35ms 忙循环 | 6,050.9ms / 148 | **40.63 / 66.6 / 83.4ms** | 50 / 12 / 最终 static | **11 次，最大 67ms** |

正常/6× 的采样 RAF 频率分别约 58.3/45.9Hz；这是页面 RAF 间隔，不是 GPU 呈现帧率。压力窗口包含 42→20→12 的降级过程及静态后时间，不能把其 RAF 频率当成物理动画帧率。额外忙循环是为可重复触发预算保护而注入的合成负载，**与仅 CPU 6× 的表现分开报告**。55ms 单次长任务无法仅靠本采样归因给动画，仍如实保留；没有宣称绝无长任务。

6× CPU 下，真实点击收藏到按钮 `aria-pressed=true` 的 MutationObserver 测得 **200.7ms**，包含 IndexedDB 与 React 更新；不是设备输入到屏幕呈现的完整延迟。操作先提交，340ms 视觉反馈没有延迟数据操作。CPU-only 条件本次没有达到平均 30ms 的降级阈值，因此保留 42 个；额外压力条件确认降级后物理帧计数停止。

三个采样末端均 **0 对大于 1px 的矩形重叠、0 越界对象**，不是连续每帧的无接触证明。卸载用例观测旧容器 frames=109 后保持不变，200ms 后全页面待执行 RAF=**0**；暂停/关闭/reduced-motion 分别有 160ms 不增长断言。这里记录任务清理，不据此声称浏览器堆零增长或已完成内存泄漏长期测试。没有采集动画峰值堆、GPU 或整机 RSS。

原回归的性能样本也保留在 browser.txt：100,002 词条冷查询 33.6ms、缓存 2.0ms、深位置 28.5ms，活动取消后无迟到消息。所有时间均为本机单轮样本，不代表统计基准或所有设备保证。

## Git 与交付范围

起始仅有 P0-CHECKLIST、P1-PROGRESS、README、VALIDATION 四份已修改文档，及未跟踪 AGENTS.md、docs/reference/；历史“约 53 文件”不符合此次实际状态。本轮保留原文差异，只纳入自己新增的动画、测试和阶段证据。P1-PROGRESS 的既有范围说明保留，提交时只暂存本轮阶段更新；不夹带原有文档修改。

原始 diff 以 gzip 无损保存，解压后可直接查看；新生成的文本日志仅清除行末空白和多余末尾空行，未修改测试结果或性能数字。代码、阶段文档与证据提交标题为 `feat: add bounded P1-D result motion and acceptance evidence`，提交后仍保留上述用户工作区差异；精确提交号通过当前 Git log 和最终交付回复确认。

## 限制与最终集成

- 采用轻量轴对齐矩形与定长标签，不模拟旋转刚体或精确字形；碰撞时可有短暂相邻接触，不能据有限测试承诺任意尺寸/任意随机状态绝不接触。
- 生成器重新运行会按原行为清空旧结果，清空跨越的 DOM 无法保留；新一轮使用相同文本 key，原数组仍存在时的筛选/排序可复用 DOM。虚拟窗口外候选不做离屏 FLIP。
- hidden 分支通过模拟页面可见性属性及原生事件链路验证，不等同于 Windows 最小化/系统休眠的全部真实场景。reduced-motion 使用 Chromium 媒体模拟动态开关验证，未更改 Windows 设置。
- 只有本机 Headless Chromium、1440×1000 与 390×844 CSS 像素。CPU 节流和低设备提示不是实物低端设备；没有 Firefox/WebKit、触屏、屏幕阅读器全矩阵或整机功耗、GPU/Worker 峰值内存测量。
- 不重复开发 P0 爆炸/抽卡；持续漂浮为独立可控模式。本轮没有 P2 参数化子图、AI、新词库模型或 3D/重型物理引擎。

P1-D 完成仅代表本报告的有界结果展示子阶段。具备进入 **P1 最终集成验收** 的条件；完整 P1 集成验收尚未执行，v3.0 的 G01/G02 等模型差距、Q01 性能和 Q03 全矩阵继续追踪；Q02 仅补齐上述 Chromium/节流/动态 reduced-motion 范围。
