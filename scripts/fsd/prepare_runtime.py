#!/usr/bin/env python3
"""Build a self-contained Apple Silicon Python runtime, without training tools."""
import hashlib
import json
import shutil
from pathlib import Path

root=Path(__file__).resolve().parents[2]
source=root/'.runtime-python/cpython-3.10.22-macos-aarch64-none'
target=root/'fsd-runtime/python'
if not target.exists():
    shutil.copytree(source,target,symlinks=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','test','tests','idlelib','ensurepip'))
packages=root/'.planr1-env/lib/python3.10/site-packages'
destination=root/'fsd-runtime/site-packages';destination.mkdir(exist_ok=True)
# PyG imports these at module import, even when only its data/attention API is
# used. Lightning, metrics, plotting, notebook and download tools are excluded.
prefixes=['torch','torchgen','functorch','numpy','scipy','scikit_learn','sklearn','shapely','yaml','PyYAML','_yaml',
          'typing_extensions','filelock','networkx','jinja2','markupsafe','sympy','mpmath','fsspec',
          'packaging','psutil','pyparsing','tqdm','requests','urllib3','certifi','charset_normalizer',
          'idna','joblib','threadpoolctl','six','cloudpickle']
excluded=['torchmetrics']
copied=[]
for path in packages.iterdir():
    if any(path.name.startswith(x) for x in excluded):continue
    if not any(path.name==p or path.name.startswith(p+'-') or path.name==p+'.py' or path.name.startswith(p+'_') for p in prefixes):continue
    dest=destination/path.name
    if not dest.exists():
        if path.is_dir():shutil.copytree(path,dest,symlinks=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','tests','test'))
        else:shutil.copy2(path,dest)
    copied.append(path.name)
manifest={'python':'CPython 3.10.22 standalone arm64 (python-build-standalone via uv)',
          'pythonSource':'https://github.com/astral-sh/python-build-standalone',
          'packages':sorted(copied),'excludedTrainingTools':['pytorch_lightning','lightning_fabric','torchmetrics','matplotlib','gdown'],
          'checkpointSha256':hashlib.sha256((root/'fsd-runtime/weights/fine-tuning.ckpt').read_bytes()).hexdigest()}
(root/'fsd-runtime/runtime-manifest.json').write_text(json.dumps(manifest,indent=2))
print('Prepared embedded runtime:',len(copied),'package entries; relocation test required.')
