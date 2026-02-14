#!/usr/bin/env python3
"""
Rank changed frontend TS/TSX files in a git diff.

Data sources:
- git diff --name-only
- git diff --numstat
- wc -l
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List


@dataclass(frozen=True)
class Candidate:
    path: str
    changed_lines: int
    total_lines: int
    score: float
    category: str


def run_command(command: List[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = result.stderr.strip() or "(no stderr)"
        raise RuntimeError(f"Command failed: {' '.join(command)}\n{stderr}")
    return result.stdout.strip()


def parse_numstat(numstat_output: str) -> Dict[str, int]:
    parsed: Dict[str, int] = {}
    if not numstat_output:
        return parsed

    for line in numstat_output.splitlines():
        parts = line.split("\t", 2)
        if len(parts) < 3:
            continue
        added_raw, deleted_raw, path = parts
        if added_raw.isdigit() and deleted_raw.isdigit():
            parsed[path] = int(added_raw) + int(deleted_raw)
        else:
            # Binary or unparseable entries.
            parsed[path] = 0
    return parsed


def is_in_path_prefix(path: str, path_prefix: str) -> bool:
    normalized_prefix = path_prefix.strip().rstrip("/")
    if normalized_prefix.startswith("./"):
        normalized_prefix = normalized_prefix[2:]
    if not normalized_prefix or normalized_prefix == ".":
        return True
    return path == normalized_prefix or path.startswith(f"{normalized_prefix}/")


def is_ts_or_tsx(path: str) -> bool:
    return path.endswith(".ts") or path.endswith(".tsx")


def detect_category(path: str) -> str:
    if path.endswith(".test.ts") or path.endswith(".test.tsx"):
        return "test"

    parts = path.split("/")
    if "components" in parts:
        return "component"
    if "controllers" in parts:
        return "controller"
    if "services" in parts:
        return "service"
    if "hooks" in parts:
        return "hook"
    if "utils" in parts:
        return "util"
    if "types" in parts:
        return "type"
    return "other"


def count_total_lines(repo_root: Path, relative_path: str) -> int:
    file_path = repo_root / relative_path
    if not file_path.exists() or not file_path.is_file():
        return 0

    result = subprocess.run(["wc", "-l", str(file_path)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return 0

    first_field = result.stdout.strip().split(maxsplit=1)
    if not first_field:
        return 0
    try:
        return int(first_field[0])
    except ValueError:
        return 0


def build_candidates(base: str, head: str, path_prefix: str) -> List[Candidate]:
    repo_root = Path(run_command(["git", "rev-parse", "--show-toplevel"]))

    changed_paths_raw = run_command(["git", "diff", "--no-renames", "--name-only", base, head])
    changed_paths = [line.strip() for line in changed_paths_raw.splitlines() if line.strip()]

    numstat_raw = run_command(["git", "diff", "--no-renames", "--numstat", base, head])
    numstat_map = parse_numstat(numstat_raw)

    candidates: List[Candidate] = []
    for path in changed_paths:
        if not is_in_path_prefix(path, path_prefix):
            continue
        if not is_ts_or_tsx(path):
            continue

        changed_lines = numstat_map.get(path, 0)
        total_lines = count_total_lines(repo_root, path)
        score = (changed_lines * 3) + (min(total_lines, 2000) / 20)
        category = detect_category(path)

        candidates.append(
            Candidate(
                path=path,
                changed_lines=changed_lines,
                total_lines=total_lines,
                score=score,
                category=category,
            )
        )

    candidates.sort(key=lambda item: (-item.score, -item.changed_lines, -item.total_lines, item.path))
    return candidates


def to_markdown(base: str, head: str, path_prefix: str, limit: int, candidates: List[Candidate]) -> str:
    lines: List[str] = [
        "# PR Hotspot Ranking",
        "",
        f"- Base: `{base}`",
        f"- Head: `{head}`",
        f"- Scope: `{path_prefix}` (`.ts/.tsx`)",
        f"- Limit: `{limit}`",
        "",
    ]

    if not candidates:
        lines.append("**Ingen kandidat:** Inga `.ts/.tsx`-filer under scope i diffen.")
        return "\n".join(lines)

    lines.extend(
        [
            "| Rank | File | Category | Changed lines | Total lines | Score |",
            "|---:|---|---|---:|---:|---:|",
        ]
    )

    for rank, item in enumerate(candidates[:limit], start=1):
        lines.append(
            f"| {rank} | `{item.path}` | `{item.category}` | {item.changed_lines} | {item.total_lines} | {item.score:.2f} |"
        )

    return "\n".join(lines)


def to_json(base: str, head: str, path_prefix: str, limit: int, candidates: List[Candidate]) -> str:
    payload = {
        "base": base,
        "head": head,
        "path_prefix": path_prefix,
        "file_filter": [".ts", ".tsx"],
        "limit": limit,
        "candidates": [
            {
                "rank": index + 1,
                "file": item.path,
                "category": item.category,
                "changed_lines": item.changed_lines,
                "total_lines": item.total_lines,
                "score": round(item.score, 2),
            }
            for index, item in enumerate(candidates[:limit])
        ],
    }
    if not candidates:
        payload["message"] = "Ingen kandidat: inga .ts/.tsx-filer under scope i diffen."
    return json.dumps(payload, ensure_ascii=False, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rank frontend refactor hotspots from a git diff.")
    parser.add_argument("--base", default="origin/main", help="Base git ref. Default: origin/main")
    parser.add_argument("--head", default="HEAD", help="Head git ref. Default: HEAD")
    parser.add_argument("--limit", type=int, default=5, help="Max rows in output. Default: 5")
    parser.add_argument(
        "--path-prefix",
        default="apps/web/src",
        help="Only consider files under this prefix. Default: apps/web/src",
    )
    parser.add_argument(
        "--format",
        choices=["markdown", "json"],
        default="markdown",
        help="Output format. Default: markdown",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit <= 0:
        print("--limit must be greater than 0", file=sys.stderr)
        return 2

    try:
        candidates = build_candidates(args.base, args.head, args.path_prefix)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.format == "json":
        print(to_json(args.base, args.head, args.path_prefix, args.limit, candidates))
    else:
        print(to_markdown(args.base, args.head, args.path_prefix, args.limit, candidates))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
