#!/usr/bin/env python3
"""Plot recorded, real-wall-clock packaged-App samples without filtering outliers."""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
reports = ROOT / 'reports'
records = []
for line in (reports / 'native-endurance.jsonl').read_text().splitlines():
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        continue
    if record.get('sample', {}).get('soak'):
        records.append(record)
assert records, 'No native samples'
t = [r['sample']['soak']['elapsedSeconds'] / 60 for r in records]
perf = [r['sample']['performance'] for r in records]
events = [json.loads(s) for s in (reports / 'native-ui-events.jsonl').read_text().splitlines() if s.strip()]
origin = records[0]['receivedAt'] - t[0] * 60000
fig, axes = plt.subplots(3, 1, figsize=(12, 8), sharex=True, layout='constrained')
fig.suptitle('Roadster Flight Lab 0.6.0 | Packaged Mac arm64 | Apple M4 / 16 GB', fontsize=14, weight='bold')
axes[0].plot(t, [p['fps'] for p in perf], color='#078187', lw=1.1)
axes[0].axhline(60, color='#888', ls=':', lw=.8)
axes[0].set_ylabel('Render FPS')
axes[1].plot(t, [p['physicsHz'] for p in perf], color='#406acb', lw=1.1)
axes[1].axhline(120, color='#888', ls=':', lw=.8)
axes[1].set_ylabel('Physics Hz')
axes[2].plot(t, [p['jsHeapBytes'] / 1e6 for p in perf], color='#a35c21', lw=1.1)
axes[2].set_ylabel('JS heap (MB)')
axes[2].set_xlabel('Actual elapsed wall time (minutes)')
for ax in axes:
    ax.grid(alpha=.18)
    ax.set_xlim(0, max(30, t[-1]))
    for event in events:
        x = (event['at'] - origin) / 60000
        ax.axvline(x, color='#999', ls='--', lw=.7, alpha=.65)
for event in events:
    x = (event['at'] - origin) / 60000
    axes[0].annotate(event['event'].replace('quality-', ''), (x, 1),
                     xycoords=('data', 'axes fraction'), xytext=(4, -12),
                     textcoords='offset points', fontsize=8)
fig.text(.012, -.018,
         '5-second snapshots; all outliers retained. Menus and concurrent browser QA affect samples.\n'
         'JS heap is not GPU VRAM. This is one Mac run, not a Windows or other-device FPS claim.',
         fontsize=8, color='#555')
output = reports / 'native-endurance-performance.png'
fig.savefig(output, dpi=160, bbox_inches='tight', facecolor='white')
print(json.dumps({'path': str(output), 'samples': len(t), 'wallMinutes': t[-1]}))
