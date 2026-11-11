"""Render aggregate-only corpus Markdown reports from the local outputs."""
import collections as C
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data/playertrack'
def read(name):return json.loads((DATA/name).read_text(encoding='utf-8'))

def render():
    r=read('report.json');styles={s:read(s+'.json') for s in r['styles']}
    lines=['# PlayerTrack 全长度语料报告','', '2026-11-11 · 本地 SQLite 快照；不包含玩家 ID 或完整玩家名单。', '',
        '## 数据与去重','',f"原记录 {r['raw']['current']+r['raw']['history']:,} 条：当前 {r['raw']['current']:,}，历史 {r['raw']['history']:,}。按 `(player_id, normalized_name)` 去重为 {r['deduplicatedPlayerNames']:,} 条，跨玩家的不同名称 {r['uniqueNames']:,} 个。",'',
        f"历史内去重为 {r['historyDistinctPlayerNames']:,} 条，当前/历史重合 {r['currentHistoryOverlap']} 条，共去除 600 条重复记录。纯汉字 {r['pureHanPlayerNames']:,} 条（不同名称 {r['pureHanUniqueNames']:,}），混合名称 {r['mixedPlayerNames']:,} 条。",'',
        '规范化仅修剪首尾空白，保留全部汉字码点，包括繁体和兼容异体字；不做 NFKC、简繁转换。混合名称的汉字只进入独立聚合，不混入纯汉字词频。读取阶段无长度过滤。', '',
        '| 长度 | 原记录 | 当前 | 历史 | 去重玩家名称 | 不同名称 | 纯汉字 | 混合 | 记录重复率 | 同名率 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for v in r['lengths']:
        lines.append('| '+' | '.join(str(v[k]) for k in ['length','rawRecords','current','history','deduplicatedPlayerNames','uniqueNames','pureHan','mixed'])+f" | {v['duplicateRecordRate']:.2%} | {v['sameNameRate']:.2%} |")
    lines += ['', '记录重复率 = 1 − 去重玩家名称 / 原记录；同名率 = 1 − 不同名称 / 去重玩家名称。空层均记 0。实际快照只有 1～6 字；7～8、9 字以上为零，不是读取阶段筛掉了长名称。测试夹具另外覆盖超过 9 字的名称。', '',
        '## 提取素材','', '| 类别 | 素材数 |','|---|---:|']
    for k,title in [('character','单字'),('bigram','双字素材'),('trigram','三字素材'),('phrase','四字及以上素材')]:lines.append(f"| {title} | {r['materials'][k]:,} |")
    lines += ['',f"合计 {sum(r['materials'].values()):,} 个不同素材；其中叠字标记 {r['reduplications']:,} 项，与按长度计数重叠。组合关系 {r['relations']:,} 项。AUTO {r['review']['AUTO']}，PENDING {r['review']['PENDING']:,}；本次没有把自动分类冒充人工批准。",'',
        '双字、三字及长素材数量包含待审核重复结构，不能全部称为已确认的词语。未知的原始完整名称不会批量导入；完整名称只在已知词典命中或明确重复结构时作为素材统计。', '',
        '边界采用两层：人工风格种子 + 从 jieba 0.42.1 通用词典筛出的 23,437 个离线词语边界（长度 2～8、通用频率 ≥100，排除人名词性）。通用命中还需至少 3 位玩家、2 个不同名称才进入待审核词库；不会自动获准生成。未命中的相邻字符不被当成词语。长短语新发现需完全由已知边界组成、非完整原名、至少 3 位玩家且左右上下文各至少两种，仍为待审核。', '',
        '## 六套独立风格','', '| 风格 | 素材 | AUTO / 可用 | 待审核 / 停用 | 1字 | 2字 | 3字 | 4字以上 | 关系候选 | 默认输出 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    for s,p in styles.items():
        c=C.Counter(m['review'] for m in p['entries']);n=C.Counter(m['length'] for m in p['entries'])
        lines.append(f"| {p['name']} | {len(p['entries'])} | {c['AUTO']} | {c['PENDING']} | {n[1]} | {n[2]} | {n[3]} | {sum(v for k,v in n.items() if k>=4)} | {len(p['relations'])} | {p['minLength']}～{p['maxLength']} 字 |")
    lines += ['', '独立资源、权重、标签、审核状态和启停开关；少数素材跨风格共享，但安装后互不联动。基础库包括尚未归入风格的通用词及单字。', '',
        '风格交集（同文本，不意味着共享持久化行）：','', '| 风格 | '+' | '.join(p['name'] for p in styles.values())+' |','|---|'+'---:|'*len(styles)]
    sets={s:{m['text'] for m in p['entries']} for s,p in styles.items()}
    for a,p in styles.items():lines.append('| '+p['name']+' | '+' | '.join(str(len(sets[a]&sets[b])) for b in styles)+' |')
    lines += ['', '## 位置与跨长度复用','', '每个素材保留原名称精确长度下的绝对位置计数、相对位置十分位计数、角色计数和偏好。相对位置 = 起点 / (名称长度 − 素材长度)，完整词占全名时定义为 0；末端放入第 9 桶。比率可由各计数除以该长度的 count 得到。', '',
        '2 字 FIRST/LAST，3 字 FIRST/MIDDLE/LAST；4 字以上 FIRST/SECOND/INTERNAL/PENULTIMATE/LAST。完整素材始于首位时优先 FIRST，同时通过来源 whole 表示可独立使用。单字名称归 FIRST；首尾汇总不重复计数。至少 20 次位置观测且同长度某组位置 ≥62% 才标明显偏好，少样本 LOW_CONFIDENCE；不跨长度合并比例。疑似姓氏还要求命中本地姓氏表，仅作 SURNAME_CANDIDATE。', '',
        '| 标签 | 含该标签的素材数 |','|---|---:|']
    for k,n in r['positionTags'].items():lines.append(f'| {k} | {n:,} |')
    lines += ['', '同一素材可在一个长度为 FREE、另一个长度为 FIRST，所以上表不互斥。生成仅使用与目标长度相同的来源层；缺失或少样本中性处理，偏好始终为软权重。', '',
        '| 覆盖的原名称长度种数 | 素材数 |','|---|---:|']
    for k,n in sorted(r['crossLengthReuse'].items(),key=lambda p:int(p[0])):lines.append(f'| {k} | {n:,} |')
    lines += ['', '跨长度共同出现的素材数：','', '| 来源长度 | '+' | '.join(r['crossLengthMatrix'])+' |','|---|'+'---:|'*len(r['crossLengthMatrix'])]
    for k,row in r['crossLengthMatrix'].items():lines.append('| '+k+' | '+' | '.join(str(n) for n in row.values())+' |')
    lines += ['', '## 只读与可复现','', 'SQLite 连接使用 `mode=ro`、`uri=True` 和 `PRAGMA query_only=ON`，显式关闭连接。运行前后校验 data.db 及已有 sidecar 文件；本次无 sidecar，主库 SHA-256 完全一致。原始玩家 ID 和名称仅存在于进程内统计集合，落盘只有聚合素材和词典来源。', '',
        f"数据库 SHA-256：`{r['databaseSHA256']}`。",'',f"综合边界 SHA-256：`{r['boundaryLexiconSHA256']}`。",'',
        '```powershell','python scripts/playertrack_corpus.py','python scripts/test_playertrack_corpus.py','python scripts/report_playertrack_corpus.py','```','',
        '可传 `--db` 和 `--out`；WSL 使用对应 `/mnt/c/.../data.db` 路径显式传入。默认路径为 Windows APPDATA。处理过程不联网；通用边界与许可已随项目保存，详见 [来源清单](data/playertrack/boundaries.source.json) 和 [MIT 许可](data/playertrack/jieba-LICENSE.txt)。上游为 [jieba](https://github.com/fxsjy/jieba)，本次只使用词典子集，不调用外部分词服务。', '',
        '[重复执行字节校验](docs/playertrack/repeatability.json)；[数据文件](data/playertrack/report.json)；[审计与验证](PLAYERTRACK_DICTIONARY_AUDIT.md)。']
    (ROOT/'PLAYERTRACK_CORPUS_REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

if __name__=='__main__':render()
