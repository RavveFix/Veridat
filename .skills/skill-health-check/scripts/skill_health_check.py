#!/usr/bin/env python3

import argparse
import datetime
import os
import re
import subprocess
from typing import Dict, List, Optional, Tuple


def resolve_code_home() -> str:
    return os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex"))


def parse_roots(values: Optional[List[str]]) -> List[str]:
    code_home = resolve_code_home()
    default_roots = [".skills", os.path.join(code_home, "skills")]
    if not values:
        return default_roots

    roots: List[str] = []
    for value in values:
        if not value:
            continue
        for item in value.split(","):
            item = item.strip()
            if item:
                roots.append(item)
    return roots or default_roots


def find_skill_dirs(root: str) -> List[str]:
    results: List[str] = []
    if not os.path.isdir(root):
        return results

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".") and d not in {"node_modules", "dist", "__pycache__"}
        ]
        if "SKILL.md" in filenames:
            results.append(dirpath)
            dirnames[:] = []
    return sorted(set(results))


def load_frontmatter(skill_md_path: str) -> Dict[str, str]:
    data: Dict[str, str] = {}
    try:
        with open(skill_md_path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except OSError:
        return data

    if not content.startswith("---"):
        return data

    lines = content.splitlines()
    if len(lines) < 3:
        return data

    end_index = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end_index = idx
            break
    if end_index is None:
        return data

    for line in lines[1:end_index]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key:
            data[key] = value
    return data


def count_todos(text: str) -> int:
    pattern = re.compile(r"\bTODO\b|\bTBD\b|\[TODO", re.IGNORECASE)
    return len(pattern.findall(text))


def run_quick_validate(skill_dir: str, quick_validate_path: str) -> Tuple[Optional[bool], str]:
    if not os.path.isfile(quick_validate_path):
        return None, "quick_validate.py hittades inte"

    try:
        result = subprocess.run(
            ["python3", quick_validate_path, skill_dir],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        return None, f"Kunde inte köra quick_validate.py: {exc}"

    output = (result.stdout + result.stderr).strip()
    if len(output.splitlines()) > 8:
        output = "\n".join(output.splitlines()[:8]) + "\n..."

    return result.returncode == 0, output or "(ingen output)"


def analyze_skill(skill_dir: str, max_lines: int, quick_validate_path: str) -> Dict[str, object]:
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    data: Dict[str, object] = {
        "path": skill_dir,
        "name": os.path.basename(skill_dir),
        "warnings": [],
        "errors": [],
    }

    try:
        with open(skill_md_path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except OSError as exc:
        data["errors"].append(f"Kunde inte läsa SKILL.md: {exc}")
        return data

    lines = content.splitlines()
    if len(lines) > max_lines:
        data["warnings"].append(f"SKILL.md har {len(lines)} rader (>{max_lines})")

    todo_count = count_todos(content)
    if todo_count:
        data["warnings"].append(f"Hittade {todo_count} TODO/TBD-markörer i SKILL.md")

    frontmatter = load_frontmatter(skill_md_path)
    fm_name = frontmatter.get("name")
    fm_description = frontmatter.get("description")
    if not fm_name:
        data["errors"].append("Frontmatter saknar 'name'")
    elif fm_name != data["name"]:
        data["warnings"].append(f"Frontmatter name '{fm_name}' matchar inte mappnamn '{data['name']}'")

    if not fm_description:
        data["errors"].append("Frontmatter saknar 'description'")

    agents_path = os.path.join(skill_dir, "agents", "openai.yaml")
    if not os.path.isfile(agents_path):
        data["warnings"].append("agents/openai.yaml saknas")

    quick_ok, quick_output = run_quick_validate(skill_dir, quick_validate_path)
    data["quick_validate"] = {
        "status": quick_ok,
        "output": quick_output,
    }
    if quick_ok is False:
        data["errors"].append("quick_validate.py rapporterade fel")

    return data


def format_report(results: List[Dict[str, object]], roots: List[str]) -> str:
    today = datetime.date.today().isoformat()
    total = len(results)
    errors = sum(1 for r in results if r.get("errors"))
    warnings = sum(1 for r in results if r.get("warnings"))
    clean = [r["name"] for r in results if not r.get("errors") and not r.get("warnings")]

    lines: List[str] = []
    lines.append(f"# Skill Health Check ({today})")
    lines.append("")
    lines.append("**Rötter:** " + ", ".join(roots))
    lines.append(f"**Sammanfattning:** {total} skills, {errors} med fel, {warnings} med varningar")
    if clean:
        lines.append("**Utan anmärkning:** " + ", ".join(clean))
    lines.append("")

    if not results:
        lines.append("Inga skills hittades i angivna rötter.")
        return "\n".join(lines)

    lines.append("## Findings")
    for result in results:
        name = result["name"]
        path = result["path"]
        warnings_list = result.get("warnings", [])
        errors_list = result.get("errors", [])
        quick = result.get("quick_validate", {})

        if not warnings_list and not errors_list:
            continue

        lines.append("")
        lines.append(f"### {name}")
        lines.append(f"Path: `{path}`")
        if errors_list:
            lines.append("- Fel:")
            for item in errors_list:
                lines.append(f"- {item}")
        if warnings_list:
            lines.append("- Varningar:")
            for item in warnings_list:
                lines.append(f"- {item}")
        if isinstance(quick, dict):
            status = quick.get("status")
            status_label = "OK" if status else "FAIL" if status is False else "N/A"
            lines.append(f"- quick_validate: {status_label}")
            output = quick.get("output")
            if output:
                lines.append("- quick_validate output:")
                lines.append("```text")
                lines.append(output)
                lines.append("```")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Weekly skill health check")
    parser.add_argument(
        "--roots",
        action="append",
        help="Comma-separated list of roots to scan (repeatable)",
    )
    parser.add_argument(
        "--out",
        help="Optional path to write the Markdown report",
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=500,
        help="Warn if SKILL.md exceeds this many lines",
    )
    args = parser.parse_args()

    roots = parse_roots(args.roots)
    skill_dirs: List[str] = []
    for root in roots:
        skill_dirs.extend(find_skill_dirs(root))

    quick_validate_path = os.path.join(
        resolve_code_home(),
        "skills",
        ".system",
        "skill-creator",
        "scripts",
        "quick_validate.py",
    )

    results = [analyze_skill(skill_dir, args.max_lines, quick_validate_path) for skill_dir in skill_dirs]
    report = format_report(results, roots)

    if args.out:
        out_dir = os.path.dirname(args.out)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(report + "\n")
    else:
        print(report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
