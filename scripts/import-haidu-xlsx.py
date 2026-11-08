"""Read the reference workbook without evaluating formulas or changing it."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

parser = argparse.ArgumentParser()
parser.add_argument("workbook", type=Path)
parser.add_argument("--output", type=Path, default=Path("examples/haidu-chao-ren.original.catalog.json"))
args = parser.parse_args()
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with ZipFile(args.workbook) as archive:
    strings = ["".join(si.itertext()) for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", ns)]
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for sheet in workbook.find("s:sheets", ns):
        target = rels[sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        cells = {}
        for cell in ET.fromstring(archive.read(path)).findall(".//s:sheetData/s:row/s:c", ns):
            value = cell.findtext("s:v", None, ns)
            if cell.get("t") == "s" and value is not None:
                value = strings[int(value)]
            if cell.get("t") == "inlineStr":
                value = "".join(cell.find("s:is", ns).itertext())
            cells[cell.get("r")] = {"text": value, "formula": cell.findtext("s:f", None, ns)}
        sheets[sheet.get("name")] = cells
    pools = {}
    for key, name, column, last, length in [("oneHead", "1字", "A", 3002, 1), ("oneTail", "1字", "B", 3002, 1), ("twoHead", "2字", "A", 3202, 2), ("twoTail", "2字", "B", 3202, 2)]:
        cells = sheets[name]
        rows = [r for r in range(2, last + 1) if cells.get(f"{column}{r}", {}).get("text") is not None]
        if rows != list(range(2, len(rows) + 2)):
            raise ValueError("Source has gaps; inspect COUNTA/INDEX semantics before importing")
        entries = []
        for row in rows:
            cell = cells[f"{column}{row}"]
            if cell["formula"] or len(cell["text"]) != length:
                raise ValueError("Unexpected source formula or word length")
            entries.append({"text": cell["text"], "cell": f"{column}{row}"})
        pools[key] = {"sheet": name, "range": f"{column}2:{column}{rows[-1]}", "rows": entries}
    tail_count = sum(value["text"] is not None for ref, value in sheets["2字"].items() if re.fullmatch(r"B\d+", ref)) - 1
    if tail_count != len(pools["twoTail"]["rows"]):
        raise ValueError("Direct-output COUNTA exceeds the inspected B-column range")
    main = sheets["潮人生成器简易版"]
    expected = {"B8": {("1字", "A"), ("1字", "B")}, "C8": {("1字", "A"), ("2字", "B")}, "D8": {("2字", "A"), ("1字", "B")}, "E8": {("2字", "B")}, "F8": {("2字", "B")}}
    for cell, references in expected.items():
        formula = main[cell]["formula"] or ""
        if set(re.findall(r"'([^']+)'!([A-Z]+)", formula)) != references or "RAND" not in formula:
            raise ValueError("Reference formula changed; inspect before rebuilding: " + cell)
    if not main["E8"]["formula"].startswith('"小"&INDEX'):
        raise ValueError("Fixed small-prefix formula changed")
    catalog = {"version": 1, "source": {"file": args.workbook.name, "sha256": hashlib.sha256(args.workbook.read_bytes()).hexdigest(), "author": main["H3"]["text"], "version": main["H1"]["text"], "reference": "https://docs.qq.com/sheet/DSGdpdFhlRXdMQWlv"}, "formulas": {f"{c}8": main[f"{c}8"]["formula"] for c in "BCDEF"}, "pools": pools}
args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: {"rows": len(pool["rows"]), "unique": len(set(r["text"] for r in pool["rows"]))} for key, pool in pools.items()}))
