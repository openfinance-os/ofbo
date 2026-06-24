#!/usr/bin/env python3
"""Ingest the data-risk & control register workbook into deterministic JSON.

One-time, idempotent conversion. The xlsx is the *source instance* of the register;
the harness (discovery gate D6, the data-governance-reviewer) consumes the JSON only,
so CI stays pure-Node and dependency-free.

Run from the repo root:  python3 scripts/ingest-data-risk-register.py
Re-running reproduces the committed JSON byte-for-byte (determinism is a gate, see
the plan's verification step). Requires: openpyxl (dev-only, not a runtime dep).

The register content is the OFBO instance (UAE/CBUAE: CPS, MMS, PDPL, BCBS239, CPS-AI).
Another solution swaps in its own workbook behind the same JSON shape.
"""
import json
import re
from pathlib import Path

import openpyxl

REGISTER_DIR = Path(__file__).resolve().parent.parent / "docs/governance/data-risk-register"
SOURCE_XLSX = REGISTER_DIR / "source/DATA_REGULATION_V2_5_0.xlsx"

# Sheet -> output filename.
SHEETS = {
    "REGULATIONS": "regulations.json",
    "RISK_TAXONOMY": "risk-taxonomy.json",
    "RISK_STATEMENTS": "risk-statements.json",
    "CONTROLS": "controls.json",
    "RESIDUAL_RISK": "residual-risk.json",
}

# Derived "embedding text" columns are pre-concatenations of the other fields, used by an
# external vector store. They add no information the harness needs and bloat the JSON, so
# we drop them on ingest.
DROP_COLUMNS = {
    "chunk_text_for_embedding",
}
LIST_COLUMNS = {
    "risk_category_ids",
    "risk_ids",
    "control_ids",
    "regulatory_drivers",
    "tags",
    "ownership_layers",
}


def to_key(header: str) -> str:
    """Normalise a column header to a snake_case JSON key."""
    key = header.strip().lower()
    key = key.replace("&", "and")
    key = re.sub(r"[^a-z0-9]+", "_", key)
    return key.strip("_")


def split_list(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"[;,]", value) if part.strip()]


def cell_value(key: str, value):
    if value is None:
        return [] if key in LIST_COLUMNS else None
    if isinstance(value, str):
        value = value.strip()
        if key in LIST_COLUMNS:
            return split_list(value)
        return value
    return value


def sheet_to_records(ws) -> list[dict]:
    rows = list(ws.iter_rows(values_only=True))
    headers = [to_key(h) for h in rows[0]]
    records = []
    for row in rows[1:]:
        if all(v is None for v in row):
            continue
        record = {}
        for key, value in zip(headers, row):
            if key in DROP_COLUMNS:
                continue
            record[key] = cell_value(key, value)
        records.append(record)
    return records


def main() -> None:
    wb = openpyxl.load_workbook(SOURCE_XLSX, data_only=True)
    for sheet, filename in SHEETS.items():
        records = sheet_to_records(wb[sheet])
        out = REGISTER_DIR / filename
        text = json.dumps(records, indent=2, ensure_ascii=False, sort_keys=False)
        out.write_text(text + "\n", encoding="utf-8")
        print(f"  {sheet:16} -> {filename:24} ({len(records)} records)")
    print("Done. The harness consumes these JSON files; the xlsx is archived under source/.")


if __name__ == "__main__":
    main()
