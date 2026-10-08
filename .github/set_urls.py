import json, sys
tag, repo = sys.argv[1], sys.argv[2]
d = json.load(open("module.json", encoding="utf-8"))
d["version"] = tag.lstrip("v")
d["url"] = f"https://github.com/{repo}"
d["manifest"] = f"https://github.com/{repo}/releases/latest/download/module.json"
d["download"] = f"https://github.com/{repo}/releases/download/{tag}/module.zip"
json.dump(d, open("module.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
