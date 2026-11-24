#!/usr/bin/env python3
"""Rebuild dependencies locally; final App never runs this script."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

root=Path(__file__).resolve().parents[2]
if platform.system()!='Darwin' or platform.machine()!='arm64':raise SystemExit('This embedded runtime is for Apple Silicon macOS.')
uv=shutil.which('uv')
if not uv:raise SystemExit('Developer rebuild requires uv; the delivered App already includes Python and needs no setup.')
env={**os.environ,'UV_PYTHON_INSTALL_DIR':str(root/'.runtime-python')}
def run(args,**kwargs):subprocess.run(args,cwd=root,env=env,check=True,**kwargs)
run([uv,'--system-certs','python','install','3.10.22','--no-bin'])
python=root/'.runtime-python/cpython-3.10.22-macos-aarch64-none/bin/python3.10'
venv=root/'.planr1-env'
if not venv.exists():run([uv,'venv','--python',str(python),str(venv)])
pip=[uv,'--system-certs','pip','install','--python',str(venv/'bin/python')]
run(pip+['torch==2.1.0','numpy==1.24.4','torch-geometric==2.3.1','pytorch-lightning==2.0.3','torchmetrics==0.11.4','scipy==1.10.1','scikit-learn==1.3.2','shapely==2.0.7','matplotlib==3.7.5','PyYAML==6.0.2','gdown==5.2.0','setuptools==80.9.0','wheel'])
scatter_env={**env,'CFLAGS':'-Wno-invalid-specialization','CXXFLAGS':'-Wno-invalid-specialization'}
subprocess.run(pip+['--no-build-isolation','torch-scatter==2.1.2'],cwd=root,env=scatter_env,check=True)
for script in ['fetch_resources.py','prepare_inference.py','prepare_runtime.py']:
    run([str(venv/'bin/python'),str(root/'scripts/fsd'/script)])
run(['npm','ci','--prefer-offline'])
run(['node','scripts/fsd/prepare_traffic.mjs'])
run([str(venv/'bin/python'),'scripts/fsd/verify_ops_equivalence.py'])
run(['npm','run','test:fsd'])
print('Prepared isolated development files. Use npm run pack:mac to create a new non-overwriting Mac archive.')
