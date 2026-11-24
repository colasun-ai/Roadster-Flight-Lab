#!/usr/bin/env python3
"""Fetch pinned public resources into this checkout, preserving existing files."""
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
CHECKPOINT_SHA='c5f590b3ae2b1bda0a684f3a826289c8b4336a9ce7424fea18be3f1bce0b9259'
def run(args,**kwargs):subprocess.run(args,cwd=ROOT,check=True,**kwargs)
def archive(repo,commit,dest):
    dest=ROOT/dest
    if dest.exists():
        if (dest/'.git').exists():
            head=subprocess.check_output(['git','-C',str(dest),'rev-parse','HEAD'],text=True).strip()
            if head!=commit:raise RuntimeError('Existing source has another revision; preserved: '+str(dest))
            subprocess.run(['git','-C',str(dest),'diff','--exit-code',commit,'--'],check=True,stdout=subprocess.DEVNULL)
        elif not (dest/'.roadster-pinned-source').exists() or (dest/'.roadster-pinned-source').read_text()!=repo+'\n'+commit+'\n':
            raise RuntimeError('Existing source cannot be verified; preserved: '+str(dest))
        print('Verified existing pinned source:',dest)
        return
    url=f'https://api.github.com/repos/{repo}/tarball/{commit}'
    # curl uses the system trust store; TLS verification stays enabled.
    packed=subprocess.check_output(['curl','--fail','--location','--retry','2',url])
    staging=dest.with_name(dest.name+'.download')
    if staging.exists():raise RuntimeError('Preserve existing staging directory: '+str(staging))
    staging.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(packed),mode='r:gz') as tar:
        members=tar.getmembers();prefix=members[0].name.split('/')[0]
        for member in members:
            relative=Path(member.name).relative_to(prefix)
            if relative.is_absolute() or '..' in relative.parts or member.issym() or member.islnk():
                raise ValueError('Unexpected archive link/path')
            target=staging/relative
            if member.isdir():target.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(member) as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
    staging.rename(dest)
    (dest/'.roadster-pinned-source').write_text(repo+'\n'+commit+'\n')
archive('XiaolongTang23/Plan-R1','23bc54433599002f275c18b88cf261ab5e87d775','external/Plan-R1')
archive('prajeeshmp86/DriveScene-Studio','ba307215f5ce67289a9cacea8ae6fb54870d5307','external/DriveScene-Studio-public-fork')
checkpoint=ROOT/'external/Plan-R1/ckpts/fine-tuning.ckpt';checkpoint.parent.mkdir(exist_ok=True)
if not checkpoint.exists():
    bundled=ROOT/'fsd-runtime/weights/fine-tuning.ckpt'
    if bundled.exists():shutil.copy2(bundled,checkpoint)
    else:
        temporary=checkpoint.with_suffix('.download')
        if temporary.exists():raise RuntimeError('Preserve incomplete prior download')
        run([str(ROOT/'.planr1-env/bin/python'),'-m','gdown','https://drive.google.com/uc?id=1Imnrju-5vwz1kzUMENv5s38iHMIMOH4W','--output',str(temporary)])
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=CHECKPOINT_SHA:raise ValueError('Official checkpoint hash mismatch')
        temporary.rename(checkpoint)
if hashlib.sha256(checkpoint.read_bytes()).hexdigest()!=CHECKPOINT_SHA:raise ValueError('Existing checkpoint differs; it was not overwritten')
print('Official checkpoint hash verified. Restricted modern DriveScene assets were not fetched.')
