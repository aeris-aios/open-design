#!/usr/bin/env python3
"""Thin exact-pack orchestrator; owner packages retain all build semantics."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

CHANNELS = {"betahyx", "previewhyx"}
TARGETS = {"darwin-arm64", "win32-x64"}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")


def run_owner(package: str, command: str, request: Path, receipt: Path) -> None:
    subprocess.run(
        ["pnpm", "--filter", package, command, "--", "--request", str(request), "--receipt", str(receipt)],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()
    request = read_json(args.request.resolve())
    if request.get("schemaVersion") != 1 or request.get("operation") != "exact.pack":
        raise SystemExit("unsupported exact pack request")
    channel = request.get("channel")
    if channel not in CHANNELS:
        raise SystemExit("channel must be betahyx or previewhyx")
    release_version = request.get("releaseVersion", "")
    if re.fullmatch(rf"\d+\.\d+\.\d+-{channel}\.\d+", release_version) is None:
        raise SystemExit("releaseVersion does not belong to the requested channel")
    source_commit = request.get("sourceCommit", "")
    if re.fullmatch(r"[a-f0-9]{40}", source_commit) is None:
        raise SystemExit("sourceCommit must be a full 40-character SHA")
    targets = request.get("targets")
    if not isinstance(targets, list) or {item.get("target") for item in targets} != TARGETS:
        raise SystemExit("targets must contain exactly darwin-arm64 and win32-x64")
    private_key = os.environ.get("OD_EXACT_ED25519_PRIVATE_KEY")
    private_key_file = os.environ.get("OD_EXACT_ED25519_PRIVATE_KEY_FILE")
    if not private_key and private_key_file:
        private_key = Path(private_key_file).read_text(encoding="utf-8")
    if not private_key:
        raise SystemExit("OD_EXACT_ED25519_PRIVATE_KEY or OD_EXACT_ED25519_PRIVATE_KEY_FILE is required")

    output = Path(request["outputDirectory"]).resolve()
    contract = output / ".contracts"
    contract.mkdir(parents=True, exist_ok=True)
    artifact_base = request["artifactBaseUrl"].rstrip("/")

    closure_request = contract / "closure-pack-request.json"
    closure_receipt = contract / "closure-pack-receipt.json"
    write_json(closure_request, {
        "schemaVersion": 1,
        "operation": "closure.pack",
        "target": "universal",
        "artifactBaseUrl": artifact_base,
        "outputDirectory": str(output),
    })
    run_owner("@open-design/closure", "exact:pack", closure_request, closure_receipt)

    terminal_receipts: list[dict] = []
    for target in targets:
        target_name = target["target"]
        node_file = Path(target["nodeArchiveFile"]).resolve()
        if not node_file.is_file():
            raise SystemExit(f"official Node archive missing: {node_file}")
        terminal_request = contract / f"terminal-pack-{target_name}-request.json"
        terminal_receipt_path = contract / f"terminal-pack-{target_name}-receipt.json"
        write_json(terminal_request, {
            "schemaVersion": 1,
            "operation": "terminal.pack",
            "target": target_name,
            "nodeArchiveFile": str(node_file),
            "nodeArchiveSha256": target["nodeArchiveSha256"],
            "artifactBaseUrl": artifact_base,
            "outputDirectory": str(output),
        })
        run_owner("@open-design/terminal", "exact:pack", terminal_request, terminal_receipt_path)
        terminal_receipts.append(read_json(terminal_receipt_path))

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as key_file:
        key_file.write(private_key)
        private_key_path = Path(key_file.name)
    try:
        metadata_file = output / "metadata.json"
        compose_request = contract / "standalone-compose-request.json"
        compose_receipt = contract / "standalone-compose-receipt.json"
        write_json(compose_request, {
            "schemaVersion": 1,
            "operation": "standalone.compose",
            "channel": channel,
            "releaseVersion": release_version,
            "standaloneVersion": request["standaloneVersion"],
            "sourceCommit": source_commit,
            "publishedAt": request["publishedAt"],
            "keyId": request["keyId"],
            "privateKeyFile": str(private_key_path),
            "contributionReceipts": [str(closure_receipt)],
            "shellReceipts": [str(contract / f"terminal-pack-{item['target']}-receipt.json") for item in targets],
            "outputFile": str(metadata_file),
        })
        run_owner("@open-design/standalone", "exact:compose", compose_request, compose_receipt)
    finally:
        private_key_path.unlink(missing_ok=True)

    closure = read_json(closure_receipt)
    standalone = read_json(compose_receipt)
    artifacts = [{
        "kind": "closure",
        "file": closure["artifactFile"],
        "sha256": closure["contribution"]["artifact"]["sha256"],
        "size": closure["contribution"]["artifact"]["size"],
    }]
    for terminal in terminal_receipts:
        artifacts.extend(terminal["artifacts"])
    receipt = {
        "schemaVersion": 1,
        "operation": "exact.pack",
        "channel": channel,
        "releaseVersion": release_version,
        "sourceCommit": source_commit,
        "metadataFile": standalone["metadataFile"],
        "metadataSha256": standalone["metadataSha256"],
        "artifacts": artifacts,
    }
    write_json(args.receipt.resolve(), receipt)


if __name__ == "__main__":
    main()
