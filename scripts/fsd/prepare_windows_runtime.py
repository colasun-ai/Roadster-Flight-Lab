"""Assemble the offline Windows x64 Plan-R1 runtime from hash-pinned archives."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'fsd-runtime'
TARGET = ROOT / 'fsd-runtime-win'
CACHE = ROOT / 'desktop-build' / 'windows-inputs'
LOCK = json.loads(Path(__file__).with_name('windows-runtime-lock.json').read_text())
CHECKPOINT = 'c5f590b3ae2b1bda0a684f3a826289c8b4336a9ce7424fea18be3f1bce0b9259'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(2**20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(item):
    path = CACHE / item['file']
    if path.is_file() and digest(path) == item['sha256']:
        return path
    with tempfile.NamedTemporaryFile(dir=CACHE, delete=False) as tmp:
        part = Path(tmp.name)
    try:
        subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '4',
                        '--output', str(part), item['url']], check=True)
        if digest(part) != item['sha256']:
            raise ValueError('Hash mismatch for ' + path.name)
        part.replace(path)
    finally:
        part.unlink(missing_ok=True)
    return path


def extract(archive, out):
    site = out / 'site-packages'
    if archive.suffix == '.gz':
        with tarfile.open(archive) as src:
            for info in src:
                parts = Path(info.name).parts[1:]
                if info.isfile() and parts and '..' not in parts and parts[0] in ('torch_geometric', 'LICENSE', 'PKG-INFO'):
                    dst = site.joinpath(*parts) if len(parts) > 1 else site / 'torch_geometric-2.3.1.dist-info' / ('METADATA' if parts[0]=='PKG-INFO' else 'LICENSE')
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    with src.extractfile(info) as r, dst.open('wb') as w:
                        shutil.copyfileobj(r, w)
        return
    with zipfile.ZipFile(archive) as src:
        for member in src.infolist():
            parts = Path(member.filename).parts
            if member.is_dir() or not parts or '..' in parts or Path(member.filename).is_absolute():
                continue
            dest = out / 'python' if archive.suffix == '.zip' else site
            if archive.name.startswith('msvc_runtime') and member.filename.lower().endswith('.dll'):
                dest, parts = out / 'python', (parts[-1],)
            elif parts[0].endswith('.data') and len(parts)>2 and parts[1] in ('platlib','purelib'):
                parts = parts[2:]
            if parts[:2] == ('torch', 'include'):
                continue
            dst = dest.joinpath(*parts)
            dst.parent.mkdir(parents=True, exist_ok=True)
            with src.open(member) as r, dst.open('wb') as w:
                shutil.copyfileobj(r, w)


def main():
    if digest(SOURCE/'weights/fine-tuning.ckpt') != CHECKPOINT:
        raise ValueError('Plan-R1 checkpoint hash mismatch')
    CACHE.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        archives = list(pool.map(fetch, LOCK))
    with tempfile.TemporaryDirectory(dir=ROOT, prefix='.win-runtime-') as temp:
        out = Path(temp)/'runtime'
        for archive in archives:
            extract(archive, out)
        for name in ['worker.py','guided_decode.py','planr1','weights','licenses']:
            original = SOURCE/name
            if original.is_dir():
                shutil.copytree(original, out/name, ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
            else:
                shutil.copy2(original, out/name)
        (out/'python/python310._pth').write_text('python310.zip\n.\n..\n../site-packages\nimport site\n', encoding='ascii')
        (out/'runtime-manifest.json').write_text(json.dumps(dict(platform='win32-x64', checkpointSha256=CHECKPOINT, archives=LOCK), indent=2))
        if TARGET.exists():
            if not (TARGET/'runtime-manifest.json').is_file():
                raise RuntimeError('Unrecognized existing runtime directory')
            backup=Path(temp)/'previous'
            TARGET.rename(backup)
            try:
                out.rename(TARGET)
            except BaseException:
                backup.rename(TARGET)
                raise
        else:
            out.rename(TARGET)
    print('Prepared', TARGET.name, 'from',len(archives),'verified archives')


if __name__ == '__main__':
    main()
