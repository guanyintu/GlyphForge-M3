import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from playertrack_corpus import analyze, han, lexicon, normalize, position_summary, run, segment, sha
from collections import Counter
from contextlib import closing


class CorpusTests(unittest.TestCase):
    def test_normalization_preserves_variants(self):
        self.assertEqual(normalize('  風神龙龍  '), '風神龙龍')
        self.assertTrue(han('𠀀'))

    def test_player_name_dedup_and_sources(self):
        report, materials, _ = analyze([(1,'月光','current'),(1,' 月光 ','history'),(1,'月光','history'),(2,'月光','current')], *lexicon())
        moon = next(m for m in materials if m['text']=='月')
        self.assertEqual(moon['frequency'],2); self.assertEqual(moon['playerCoverage'],2)
        self.assertEqual(report['currentHistoryOverlap'],1)
        self.assertEqual(moon['currentCount'],2); self.assertEqual(moon['historyCount'],1)
        self.assertEqual(report['lengths'][1]['uniqueNames'],1)

    def test_long_names_and_mixed_separate(self):
        s='月光下的草莓小蛋糕与猫猫'
        report, ms, _=analyze([(1,s,'current'),(2,'A月光123','history'),(3,'風龍','current')],*lexicon())
        self.assertEqual(report['pureHanPlayerNames'],2)
        self.assertEqual(next(m for m in ms if m['text']=='月光')['frequency'],1)
        self.assertEqual(next(m for m in ms if m['text']=='小蛋糕')['length'],3)
        self.assertEqual(next(r for r in report['lengths'] if r['length']==len(s))['rawRecords'],1)
        self.assertFalse(any(m['text']=='光下' for m in ms))

    def test_positions_by_exact_length(self):
        rows=[(i,'月光','current') for i in range(20)]+[(100+i,'听月光','current') for i in range(20)]
        _,ms,_=analyze(rows,*lexicon());m=next(m for m in ms if m['text']=='月')
        self.assertEqual(m['positionsByLength']['2']['preference'],'FIRST')
        self.assertEqual(m['positionsByLength']['3']['preference'],'MIDDLE')
        self.assertEqual(m['positionsByLength']['3']['absolute'],{'2':20})
        self.assertEqual(m['positionsByLength']['3']['relativeDeciles'],{'5':20})

    def test_low_confidence_and_threshold(self):
        def stats(first,last):return {2:[Counter(FIRST=first,LAST=last),Counter(),Counter()]}
        p,_=position_summary(stats(19,0));self.assertEqual(p['2']['preference'],'FREE')
        p,_=position_summary(stats(62,38));self.assertEqual(p['2']['preference'],'FIRST')
        p,_=position_summary(stats(61,39));self.assertEqual(p['2']['preference'],'FREE')

    def test_repeats_relations_pending_and_boundary(self):
        _,ms,rs=analyze([(i,'小猫猫','current') for i in range(5)],*lexicon())
        self.assertIn('XAA',next(m for m in ms if m['text']=='猫猫')['semanticTags'])
        self.assertTrue(all(r['review']=='PENDING' and not r['enabled'] for r in rs))
        self.assertEqual(segment('月光罕见串',lexicon()[0])[0][1],'月光')

    def test_read_only_repeatable_and_no_records(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'test.db';out=Path(directory)/'out'
            with closing(sqlite3.connect(p)) as c:
                c.execute('CREATE TABLE players (id INTEGER,name TEXT)');c.execute('CREATE TABLE player_name_world_histories (player_id INTEGER,player_name TEXT)')
                c.execute('INSERT INTO players VALUES (987654321,"月光")')
                c.execute('INSERT INTO player_name_world_histories VALUES (987654321,"听月光")')
                c.commit()
            before=sha(p);run(p,out);first={f.name:sha(f) for f in out.glob('*.json')};run(p,out)
            self.assertEqual(before,sha(p));self.assertEqual(first,{f.name:sha(f) for f in out.glob('*.json')})
            joined=''.join(f.read_text(encoding='utf-8') for f in out.glob('*.json'))
            self.assertNotIn('987654321',joined);self.assertNotIn('"player_id"',joined)
            with closing(sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)) as c:
                with self.assertRaises(sqlite3.OperationalError):c.execute('DELETE FROM players')


if __name__=='__main__': unittest.main()
