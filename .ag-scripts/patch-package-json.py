#!/usr/bin/env python3
"""Insert `deploy` and `deploy:build` npm scripts after `lint`."""
import json
import pathlib

p = pathlib.Path("package.json")
pkg = json.loads(p.read_text())

scripts = pkg["scripts"]
new_entry = {
    "deploy": "node scripts/deploy-to-obsidian.mjs",
    "deploy:build": "npm run build && npm run deploy",
}

# Re-order: rewrite the dict so deploy is appended last, preserving everything else.
rewritten = {}
for k, v in scripts.items():
    rewritten[k] = v
rewritten.update(new_entry)

pkg["scripts"] = rewritten
p.write_text(json.dumps(pkg, indent="\t") + "\n")

# Quick visual confirmation
for k, v in pkg["scripts"].items():
    print(f"{k}: {v}")
