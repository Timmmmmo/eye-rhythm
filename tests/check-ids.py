import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")
app = (root / "js/app.js").read_text(encoding="utf-8")

ids = set(re.findall(r'getElementById\([\'"](\w+)[\'"]\)', app))
ids |= set(re.findall(r'\$\([\'"](\w+)[\'"]\)', app))
html_ids = set(re.findall(r'id="(\w+)"', html))
missing = sorted(ids - html_ids)
print("JS 引用的 ID 数:", len(ids))
print("HTML 中缺失:", missing if missing else "无")
extra = sorted(html_ids - ids)
print("HTML 独有:", extra)
