"""Build an offline lexical-boundary subset from the pinned jieba source archive.
No PlayerTrack data is read here. Runtime corpus processing needs only Python stdlib.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

ROOT=Path(__file__).resolve().parents[1]

def build(archive, output):
    with tarfile.open(archive, 'r:gz') as tar:
        dictionary=tar.extractfile('jieba-0.42.1/jieba/dict.txt').read()
    # The 0.42.1 sdist omits LICENSE; the separately vendored upstream license
    # must accompany the subset (see boundaries.source.json).
    license_text=(output/'jieba-LICENSE.txt').read_bytes()
    allowed={'n','nz','ns','v','vn','a','ad','an','i','l'}
    words=[]
    for line in dictionary.decode('utf-8').splitlines():
        word,frequency,tag=line.split()
        if 2<=len(word)<=8 and int(frequency)>=100 and tag in allowed:
            words.append((word,tag))
    output.mkdir(parents=True,exist_ok=True)
    data=''.join(word+'\t'+tag+'\n' for word,tag in sorted(words)).encode('utf-8')
    (output/'boundaries.tsv').write_bytes(data)
    (output/'jieba-LICENSE.txt').write_bytes(license_text)
    (output/'boundaries.source.json').write_text(json.dumps({'package':'jieba','version':'0.42.1','source':'https://pypi.org/project/jieba/0.42.1/','upstream':'https://github.com/fxsjy/jieba',
        'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest(),'dictionarySHA256':hashlib.sha256(dictionary).hexdigest(),'subsetSHA256':hashlib.sha256(data).hexdigest(),
        'selection':{'minFrequency':100,'length':[2,8],'pos':sorted(allowed),'personNamesExcluded':True},'words':len(words)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(len(words),'offline boundaries')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('archive',type=Path);parser.add_argument('--out',type=Path,default=ROOT/'data/playertrack');args=parser.parse_args();build(args.archive,args.out)
