#!/usr/bin/env python3
"""Copy the source parquet into the site's ``data/`` directory and print a
short quality report.

The website ships the parquet file directly (it is only ~11 MB and every
visitor loads it in full), so this script's job is simply to (a) refresh the
committed copy from the source of truth and (b) sanity-check the contents.

Usage:
    python scripts/prepare_data.py [--source PATH] [--no-copy]
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import polars as pl

DEFAULT_SOURCE = Path.home() / ".bizval" / "dk" / "fundamental_data.pq"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEST = REPO_ROOT / "data" / "fundamental_data.pq"


def report(df: pl.DataFrame) -> None:
    print("\n=== Schema ===")
    print(df.schema)

    n_rows = df.height
    n_cvr = df.select(pl.col("cvr").n_unique()).item()
    print("\n=== Overview ===")
    print(f"rows:          {n_rows:,}")
    print(f"unique CVRs:   {n_cvr:,}")

    dmin, dmax = df.select(
        pl.col("filing_date").min(), pl.col("filing_date").max()
    ).row(0)
    print(f"filing_date:   {dmin} … {dmax}")

    # How many CVRs are mappable (newest filing has coordinates)?
    latest = (
        df.sort("filing_date")
        .group_by("cvr")
        .last()
        .filter(pl.col("longitude").is_not_null() & pl.col("latitude").is_not_null())
    )
    print(f"mappable CVRs: {latest.height:,} (newest filing has lon/lat)")

    print("\n=== Null counts ===")
    nulls = df.null_count().to_dicts()[0]
    for col, cnt in nulls.items():
        if cnt:
            print(f"  {col:15s} {cnt:,}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"source parquet path (default: {DEFAULT_SOURCE})",
    )
    parser.add_argument(
        "--no-copy",
        action="store_true",
        help="only inspect; do not copy the file into data/",
    )
    args = parser.parse_args()

    src = args.source if not args.no_copy else DEST
    if not src.exists():
        raise SystemExit(f"Source parquet not found: {src}")

    df = pl.read_parquet(src)
    report(df)

    if not args.no_copy:
        DEST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.source, DEST)
        size_mb = DEST.stat().st_size / 1e6
        print(f"\nCopied {args.source} -> {DEST} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
