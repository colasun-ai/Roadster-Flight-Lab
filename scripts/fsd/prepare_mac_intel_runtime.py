"""Assemble a relocatable Intel Mac planner using the shipping model and worker."""
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile

from prepare_windows_runtime import CHECKPOINT, digest, extract

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "fsd-runtime"
TARGET = ROOT / "desktop-build" / "runtime-mac-x64"
PYTHON_URL = ("https://github.com/astral-sh/python-build-standalone/releases/download/20261009/"
              "cpython-3.10.22%2B20261009-x86_64-apple-darwin-install_only_stripped.tar.gz")
PYTHON_SHA = "7c579c3d9913a36b86a63772704cc08960de9b819b8915455218a536dbd4f3f2"


def download(url, sha256, target):
    subprocess.run(["curl", "-fsSL", "--retry", "4", url, "-o", str(target)], check=True)
    if digest(target) != sha256:
        raise ValueError(f"Download checksum mismatch: {target.name}")


def main():
    if platform.system() != "Darwin" or platform.machine() != "x86_64":
        raise SystemExit("Prepare the Intel runtime with an x86_64 macOS interpreter.")
    if TARGET.exists():
        raise SystemExit(f"Output already exists: {TARGET}")
    if digest(SOURCE / "weights/fine-tuning.ckpt") != CHECKPOINT:
        raise ValueError("Plan-R1 checkpoint checksum mismatch")
    TARGET.parent.mkdir(exist_ok=True)
    requirements = Path(__file__).with_name("mac-intel-requirements.txt")
    archives = json.loads(Path(__file__).with_name("windows-runtime-lock.json").read_text())
    pyg = next(item for item in archives if item["file"] == "torch_geometric-2.3.1.tar.gz")
    with tempfile.TemporaryDirectory(dir=TARGET.parent) as temporary:
        scratch = Path(temporary)
        runtime = scratch / "runtime"
        shutil.copytree(SOURCE, runtime, ignore=shutil.ignore_patterns(
            "python", "site-packages", "__pycache__", "*.pyc", "runtime-manifest.json"))
        archive = scratch / "python.tar.gz"
        download(PYTHON_URL, PYTHON_SHA, archive)
        # This pinned install_only archive has a single relocatable python/ tree.
        with tarfile.open(archive) as src:
            src.extractall(runtime, filter="data")
        python = runtime / "python/bin/python3.10"
        subprocess.run([str(python), "-I", "-c",
                        "import platform; assert platform.machine() == 'x86_64'"], check=True)
        env = {**os.environ, "PIP_DISABLE_PIP_VERSION_CHECK": "1"}
        subprocess.run([str(python), "-I", "-m", "pip", "install", "--no-deps",
                        "--no-compile", "--only-binary=:all:", "--require-hashes",
                        "--target", str(runtime / "site-packages"), "-r", str(requirements)],
                       env=env, check=True)
        pure_source = scratch / pyg["file"]
        download(pyg["url"], pyg["sha256"], pure_source)
        extract(pure_source, runtime)
        manifest = dict(platform="darwin-x64", python="CPython 3.10.22", pythonSha256=PYTHON_SHA,
                        checkpointSha256=CHECKPOINT, wheels=requirements.read_text().splitlines()[1:],
                        torchGeometricSha256=pyg["sha256"])
        (runtime / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        runtime.rename(TARGET)
    print(f"Prepared Intel Mac planner at {TARGET}")


if __name__ == "__main__":
    main()
