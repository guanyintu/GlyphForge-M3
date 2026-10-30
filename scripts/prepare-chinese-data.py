"""Rebuild vendored datasets; Python stdlib only. Runtime needs no network."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/data/chinese'
LICENSES = ROOT / 'public/licenses'
OUT.mkdir(parents=True, exist_ok=True)
LICENSES.mkdir(parents=True, exist_ok=True)
COMMIT = 'c29b391fd6267e7a3541387e03a3dd60b1cd34d1'
BASE = f'https://raw.githubusercontent.com/amake/cjk-decomp/{COMMIT}/'
sources = {}

def get(url):
    data = urllib.request.urlopen(url, timeout=120).read()
    sources[url] = hashlib.sha256(data).hexdigest()
    return data

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

decompositions = {}
for line in get(BASE + 'cjk-decomp.txt').decode('utf-8-sig').splitlines():
    key, value = line.split(':', 1)
    code, components = value[:-1].split('(', 1)
    decompositions.setdefault(key, []).append([code, components.split(',') if components else []])
write('decomposition.json', decompositions)
(LICENSES / 'cjk-decomp-Apache-2.0.txt').write_bytes(get(BASE + 'LICENSE'))
(LICENSES / 'cjk-decomp-README.md').write_bytes(get(BASE + 'README.md'))

archive = zipfile.ZipFile(io.BytesIO(get('https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip')))
strokes, readings = {}, {}
for filename in ['Unihan_IRGSources.txt', 'Unihan_Readings.txt']:
    for line in archive.read(filename).decode('utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        cp, field, value = line.split('\t', 2)
        char = chr(int(cp[2:], 16))
        if field == 'kTotalStrokes':
            strokes[char] = sorted(set(int(n) for n in value.split()))
        elif field == 'kMandarin':
            readings[char] = value.split()
write('strokes.json', strokes)
write('readings.json', readings)
(LICENSES / 'Unicode-License-V3.txt').write_bytes(get('https://www.unicode.org/license.txt'))
write('sources.json', {'cjkCommit': COMMIT, 'unicode': '17.0.0', 'sha256': sources,
                       'counts': {'decompositionRecords': len(decompositions), 'strokes': len(strokes), 'readings': len(readings)}})
print(json.dumps({'records': len(decompositions), 'strokes': len(strokes), 'readings': len(readings)}))
