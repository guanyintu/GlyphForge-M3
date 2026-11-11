"""Local, read-only PlayerTrack aggregation. No names or player IDs are persisted.

Run: python scripts/playertrack_corpus.py [--db PATH] [--out data/playertrack]
Only NFC + outer whitespace trimming is applied, never NFKC / OpenCC.
"""
import argparse
import collections as C
from contextlib import closing
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import unicodedata as U

ROOT = Path(__file__).resolve().parents[1]
STYLES = dict(cute='萌系日常', nature='自然意象', literary='清冷文艺', fantasy='奇幻角色', trend='趣味潮流', haidu='海都潮人')


def han(c):
    n = ord(c)
    return 0x3400 <= n <= 0x4DBF or 0x4E00 <= n <= 0x9FFF or 0xF900 <= n <= 0xFAFF or 0x20000 <= n <= 0x323AF


def normalize(s):
    # NFC can fold CJK compatibility ideographs: preserve all Han codepoints.
    return ''.join(c if han(c) else U.normalize('NFC', c) for c in str(s or '').strip())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lexicon(path=ROOT / 'data/playertrack/lexicon.json'):
    data = json.loads(path.read_text(encoding='utf-8'))
    words = {}
    boundary_file = path.parent/'boundaries.tsv'
    if boundary_file.exists():
        for line in boundary_file.read_text(encoding='utf-8').splitlines():
            word, tag = line.split('\t')
            words[word] = {'tags': {'lexical:'+tag}, 'styles': set(), 'auto': False}
    for group in data['groups']:
        for word in group['words'].split():
            d = words.setdefault(word, {'tags': set(), 'styles': set()})
            d['tags'].add(group['tag']); d['styles'].update(group['styles']); d['auto'] = True
    return words, set(data['surnames'].split())


def segment(s, words):
    """Longest known boundary; unknown characters are explicit barriers, not words."""
    out, i = [], 0
    maximum = 12
    while i < len(s):
        term = next((s[i:i+n] for n in range(min(maximum, len(s)-i), 0, -1) if s[i:i+n] in words), None)
        out.append((i, term or s[i], term is not None)); i += len(term or s[i])
    return out


def position(start, size, length):
    if start == 0: return 'FIRST'
    if start + size == length: return 'LAST'
    if length == 3: return 'MIDDLE'
    if start == 1: return 'SECOND'
    if start + size == length - 1: return 'PENULTIMATE'
    return 'INTERNAL'


def position_summary(by_length):
    out, labels = {}, set()
    for length, values in sorted(by_length.items()):
        roles, absolute, relative = values
        total = sum(roles.values())
        grouped = C.Counter()
        for k, v in roles.items(): grouped[k if k in ('FIRST', 'LAST') else 'MIDDLE'] += v
        best, count = grouped.most_common(1)[0]
        confidence = 'LOW_CONFIDENCE' if total < 20 else 'SUFFICIENT_SAMPLE'
        tag = best if total >= 20 and count / total >= .62 else 'FREE'
        labels.add(tag)
        out[str(length)] = {'count': total, 'roles': dict(roles), 'absolute': dict(absolute),
                            'relativeDeciles': dict(relative), 'preference': tag, 'confidence': confidence,
                            'share': round(count / total, 6)}
    return out, sorted(labels or {'FREE'})


def analyze(rows, words, surnames):
    raw_lengths, current, history = C.Counter(), C.Counter(), C.Counter()
    names_by_length, pairs, source_pairs = C.defaultdict(set), {}, C.defaultdict(set)
    raw = C.Counter()
    for pid, original, source in rows:
        s = normalize(original)
        if not s: raw['empty'] += 1; continue
        raw[source] += 1; raw_lengths[len(s)] += 1
        (current if source == 'current' else history)[len(s)] += 1
        pairs.setdefault((pid, s), set()).add(source)
        source_pairs[source].add((pid, s))
    tokens, mixed_tokens, symbols = {}, C.Counter(), C.Counter()
    pure_names, all_names, pure_lengths, mixed_lengths = set(), set(), C.Counter(), C.Counter()
    relation_stats, phrase_players = {}, C.defaultdict(set)
    phrase_context = C.defaultdict(lambda: [set(), set()])

    def record(term, pid, s, start, sources, kind, semantics=None, styles=None):
        d = tokens.setdefault(term, {'frequency': 0, 'players': set(), 'names': set(), 'sources': C.Counter(),
            'lengthSources': C.Counter(), 'positions': C.defaultdict(lambda: [C.Counter(), C.Counter(), C.Counter()]),
            'kinds': set(), 'semantic': set(), 'styles': set(), 'currentCount': 0, 'historyCount': 0})
        d['frequency'] += 1; d['players'].add(pid); d['names'].add(s); d['kinds'].add(kind)
        d['semantic'].update(semantics or []); d['styles'].update(styles or [])
        d['lengthSources'][str(len(s))] += 1
        d['sources']['whole' if len(term) == len(s) else 'fragment'] += 1
        d['sources']['from2' if len(s) == 2 else 'from3' if len(s) == 3 else 'from4plus' if len(s) >= 4 else 'from1'] += 1
        d['currentCount'] += 'current' in sources; d['historyCount'] += 'history' in sources
        role = position(start, len(term), len(s))
        roles, absolute, relative = d['positions'][len(s)]
        roles[role] += 1; absolute[str(start+1)] += 1
        relative[str(min(9, math.floor(start / max(1, len(s)-len(term)) * 10)))] += 1

    for (pid, s), sources in pairs.items():
        all_names.add(s); names_by_length[len(s)].add(s)
        if not all(map(han, s)):
            mixed_lengths[len(s)] += 1
            for c in s:
                if han(c): mixed_tokens[c] += 1
                elif not c.isalnum() and not c.isspace(): symbols[c] += 1
            continue
        pure_lengths[len(s)] += 1; pure_names.add(s)
        for i, ch in enumerate(s):
            info = words.get(ch, {})
            record(ch, pid, s, i, sources, 'character', info.get('tags'), info.get('styles'))
        segments = segment(s, words)
        found = set()
        # Known dictionary terms at ANY boundary, but never dump all raw n-grams.
        for i in range(len(s)):
            for n in range(2, min(12, len(s)-i)+1):
                term = s[i:i+n]
                if term in words:
                    info = words[term]
                    record(term, pid, s, i, sources, 'word', info['tags'], info['styles']); found.add((i, term))
        for i, ch in enumerate(s[:-1]):
            if ch != s[i+1]: continue
            n = 2
            while i+n < len(s) and s[i+n] == ch: n += 1
            term = ch * n
            info = words.get(ch, {})
            if (i, term) not in found:
                record(term, pid, s, i, sources, 'reduplication', info.get('tags'), info.get('styles'))
            tokens[term]['kinds'].add('reduplication')
            tokens[term]['semantic'].add('AA' if n == 2 else 'AAA' if n == 3 else 'REPEAT')
            if len(s) == 3 and n == 2: tokens[term]['semantic'].add('AAX' if i == 0 else 'XAA')
        for j in range(len(segments)-1):
            start, a, ka = segments[j]; _, b, kb = segments[j+1]
            if not ka or not kb: continue
            key = (a, b)
            rel = relation_stats.setdefault(key, {'players': set(), 'frequency': 0})
            rel['players'].add(pid); rel['frequency'] += 1
            # Repeated, bounded, fully recognized constituents; independent contexts
            # required below. Whole unknown player names never become phrase exports.
            for k in range(j+2, min(j+5, len(segments))+1):
                group = segments[j:k]
                if not all(t[2] for t in group): break
                phrase = ''.join(t[1] for t in group)
                if 4 <= len(phrase) <= 12 and len(phrase) < len(s) and phrase not in words:
                    phrase_players[phrase].add(pid)
                    phrase_context[phrase][0].add(s[:start][-1:])
                    phrase_context[phrase][1].add(s[start+len(phrase):][:1])
    discovered = {s for s, players in phrase_players.items() if len(players) >= 3 and all(len(x) >= 2 for x in phrase_context[s])}
    # Second pass records proper position/source stats for candidate phrases.
    for (pid, s), sources in pairs.items():
        if not all(map(han, s)): continue
        for start in range(len(s)):
            for size in range(4, min(12, len(s)-start)+1):
                phrase = s[start:start+size]
                if phrase in discovered:
                    parts = [w for _, w, known in segment(phrase, words) if known]
                    tags = set().union(*(words[w]['tags'] for w in parts))
                    styles = set().union(*(words[w]['styles'] for w in parts))
                    record(phrase, pid, s, start, sources, 'phraseCandidate', tags, styles)
    materials = []
    for text, d in sorted(tokens.items()):
        auto = words.get(text, {}).get('auto', False)
        if text in words and not auto and 'reduplication' not in d['kinds'] and (len(d['players']) < 3 or len(d['names']) < 2): continue
        positions, tags = position_summary(d['positions'])
        coverage = len(d['players']); confidence = min(1, math.log1p(coverage)/math.log(101))
        known = text in words
        semantic = sorted(d['semantic'])
        if text in surnames and any(p['roles'].get('FIRST', 0) for p in positions.values()): semantic.append('SURNAME_CANDIDATE')
        status = 'AUTO' if auto else 'PENDING'
        level = 'SPECIAL' if not known else 'CORE' if coverage >= 100 else 'EXTENDED' if coverage >= 20 else 'RARE'
        materials.append({'text': text, 'length': len(text), 'frequency': d['frequency'], 'playerCoverage': coverage,
            'uniqueNameCount': len(d['names']), 'firstCount': sum(p['roles'].get('FIRST', 0) for p in positions.values()),
            'middleCount': sum(sum(v for k, v in p['roles'].items() if k not in ('FIRST','LAST')) for p in positions.values()),
            'lastCount': sum(p['roles'].get('LAST', 0) for p in positions.values()), 'positionsByLength': positions,
            'positionTags': tags, 'semanticTags': semantic, 'styleTags': sorted(d['styles']), 'level': level,
            'confidence': round(confidence, 6), 'enabled': auto, 'review': status,
            'sources': dict(d['sources']), 'sourceLengths': dict(d['lengthSources']),
            'currentCount': d['currentCount'], 'historyCount': d['historyCount'], 'kinds': sorted(d['kinds']),
            'integrity': 1 if known else .5, 'semanticQuality': .85 if auto else .35,
            'statisticalWeight': round(math.log1p(d['frequency']) * math.log1p(coverage) * (.5+.5*confidence), 6),
            'manualWeight': 1, 'styleWeight': 1, 'provenance': 'PlayerTrack · aggregated local snapshot · boundary lexicon v1'})
    relations = []
    by_text = {m['text']: m for m in materials}
    for (a, b), d in sorted(relation_stats.items()):
        if len(d['players']) < 3 or a not in by_text or b not in by_text: continue
        ta, tb = words[a]['tags'], words[b]['tags']
        typ = 'reduplication' if a == b else 'modifier' if 'modifier' in ta else 'verb-object' if 'action' in ta else 'imagery' if 'nature' in ta & tb else 'pending'
        relations.append({'left': a, 'right': b, 'type': typ, 'frequency': d['frequency'], 'playerCoverage': len(d['players']),
                          'review': 'PENDING', 'enabled': False, 'confidence': .5, 'evidence': 'adjacent recognized boundaries; syntax requires human review'})
    lengths = []
    for n in range(1, max(9, max(raw_lengths, default=0))+1):
        dedup = pure_lengths[n]+mixed_lengths[n]
        lengths.append({'length': n, 'rawRecords': raw_lengths[n], 'current': current[n], 'history': history[n],
            'deduplicatedPlayerNames': dedup, 'uniqueNames': len(names_by_length[n]),
            'pureHan': pure_lengths[n], 'mixed': mixed_lengths[n],
            'duplicateRecordRate': round(1-dedup/raw_lengths[n],6) if raw_lengths[n] else 0,
            'sameNameRate': round(1-len(names_by_length[n])/dedup,6) if dedup else 0})
    report = {'normalization': 'trim; preserve Han codepoints, traditional/variants; no NFKC or script conversion',
        'raw': dict(raw), 'deduplicatedPlayerNames': len(pairs), 'uniqueNames': len(all_names), 'pureHanPlayerNames': sum(pure_lengths.values()),
        'pureHanUniqueNames': len(pure_names), 'mixedPlayerNames': sum(mixed_lengths.values()),
        'currentDistinctPlayerNames': len(source_pairs['current']), 'historyDistinctPlayerNames': len(source_pairs['history']),
        'currentHistoryOverlap': len(source_pairs['current'] & source_pairs['history']), 'lengths': lengths,
        'materials': dict(C.Counter('character' if m['length']==1 else 'bigram' if m['length']==2 else 'trigram' if m['length']==3 else 'phrase' for m in materials)),
        'reduplications': sum('reduplication' in m['kinds'] for m in materials), 'relations': len(relations),
        'positionTags': dict(C.Counter(t for m in materials for t in m['positionTags'])),
        'crossLengthReuse': dict(C.Counter(str(len(m['sourceLengths'])) for m in materials)),
        'crossLengthMatrix': {str(a): {str(b): sum(str(a) in m['sourceLengths'] and str(b) in m['sourceLengths'] for m in materials) for b in sorted(raw_lengths)} for a in sorted(raw_lengths)},
        'mixedHanCharacters': dict(mixed_tokens), 'symbols': dict(symbols),
        'review': dict(C.Counter(m['review'] for m in materials)), 'styles': {k: sum(k in m['styleTags'] for m in materials) for k in STYLES}}
    return report, materials, relations


def run(database, out):
    paths = [p for p in database.parent.glob(database.name+'*') if p.is_file()]
    before = {p.name: sha(p) for p in paths}
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro', uri=True)) as conn:
        conn.execute('PRAGMA query_only=ON')
        def rows():
            yield from ((pid, name, 'current') for pid, name in conn.execute('SELECT id,name FROM players'))
            yield from ((pid, name, 'history') for pid, name in conn.execute('SELECT player_id,player_name FROM player_name_world_histories'))
        report, materials, relations = analyze(rows(), *lexicon())
    after = {p.name: sha(p) for p in database.parent.glob(database.name+'*') if p.is_file()}
    if before != after: raise RuntimeError('Database/sidecar changed during read; no outputs written. Retry when PlayerTrack is idle.')
    report['databaseUnchanged'] = True; report['databaseSHA256'] = before[database.name]
    report['manualStyleLexiconSHA256'] = sha(ROOT/'data/playertrack/lexicon.json')
    report['generalBoundarySHA256'] = sha(ROOT/'data/playertrack/boundaries.tsv') if (ROOT/'data/playertrack/boundaries.tsv').exists() else None
    report['boundaryLexiconSHA256'] = hashlib.sha256((report['manualStyleLexiconSHA256']+(report['generalBoundarySHA256'] or '')).encode('ascii')).hexdigest()
    out.mkdir(parents=True, exist_ok=True)
    def write(file, value):
        (out/file).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    write('report.json', report)
    for key, predicate in [('characters',lambda m:m['length']==1),('bigrams',lambda m:m['length']==2),('trigrams',lambda m:m['length']==3),('phrases',lambda m:m['length']>=4),('reduplications',lambda m:'reduplication' in m['kinds'])]:
        write(key+'.json', [m for m in materials if predicate(m)])
    write('positions.json', {m['text']:m['positionsByLength'] for m in materials})
    write('relations.json', relations)
    write('symbols.json', [{'text':s,'frequency':f,'review':'PENDING','enabled':False} for s,f in sorted(report['symbols'].items())])
    for style, title in STYLES.items():
        selected = [dict(m, styleTags=[style]) for m in materials if style in m['styleTags']]
        texts = {m['text'] for m in selected}
        write(style+'.json', {'format':'glyphforge-playertrack','version':1,'style':style,'name':title,
            'enabled':True,'minLength':2,'maxLength':3 if style=='haidu' else 6,
            'entries':selected,'relations':[r for r in relations if r['left'] in texts and r['right'] in texts],
            'source':{'databaseSHA256':report['databaseSHA256'],'boundaryLexiconSHA256':report['boundaryLexiconSHA256'],
                      'deduplicatedPlayerNames':report['deduplicatedPlayerNames']}})
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=Path(os.environ.get('APPDATA', ''))/'XIVLauncherCN/pluginConfigs/PlayerTrack/data.db')
    parser.add_argument('--out', type=Path, default=ROOT/'data/playertrack')
    args = parser.parse_args()
    print(json.dumps(run(args.db, args.out), ensure_ascii=True))
