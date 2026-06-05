import argparse
import json
from pathlib import Path

from database import BASE_DIR

JSON_ROOT = BASE_DIR / "JSON"


def convert_file(path: Path, overwrite: bool = False) -> str:
    output_path = path.with_suffix(".json")
    if output_path.exists() and not overwrite:
        return "skipped"

    data = json.loads(path.read_text(encoding="utf-8"))
    output_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return "converted"


def convert_tree(root: Path, overwrite: bool = False):
    converted = 0
    skipped = 0
    failed = 0
    for path in sorted(root.rglob("*.txt")):
        if path.stat().st_size == 0:
            skipped += 1
            continue
        try:
            result = convert_file(path, overwrite=overwrite)
        except Exception as exc:
            failed += 1
            print(f"FAILED {path}: {exc}")
            continue
        if result == "converted":
            converted += 1
            print(f"converted {path} -> {path.with_suffix('.json')}")
        else:
            skipped += 1

    print(f"Converted: {converted}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {failed}")
    return failed == 0


def main():
    parser = argparse.ArgumentParser(description="Convert archived .txt JSON files to pretty .json files.")
    parser.add_argument("--root", type=Path, default=JSON_ROOT, help="Root folder to scan.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing .json files.")
    args = parser.parse_args()

    ok = convert_tree(args.root, overwrite=args.overwrite)
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()

