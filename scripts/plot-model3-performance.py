#!/usr/bin/env python3
"""Plot the measured production-physics trace, not a synthetic target curve."""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
report = json.loads((ROOT / 'reports/model3-performance-test-results.json').read_text())
assert report['failed'] == 0 and report['sourceUnchangedDuringRun']
result = report['tests'][0]['measurements']
rows = result['halfSecondSamples']
t = [x['seconds'] for x in rows]
fig, axes = plt.subplots(3, 1, figsize=(11, 8), sharex=True, layout='constrained')
fig.suptitle('Model 3 Performance 2018 | Simulator measured trace', fontsize=15, weight='bold')
axes[0].plot(t, [x['actualHorizontalKmh'] for x in rows], color='#078187', label='Actual Rapier body speed')
metrics = result['measurement']['strictFromRestSeconds']
for key, speed in [('100kmh', 100), ('160kmh', 160)]:
    seconds = metrics[key]
    axes[0].plot(seconds, speed, 'o', color='#078187', ms=4)
    axes[0].annotate(f'{speed} km/h: {seconds:.3f} s', (seconds, speed), xytext=(5, -18), textcoords='offset points', fontsize=9)
axes[0].set_ylabel('Speed (km/h)')
axes[1].plot(t, [x['powertrain']['frontMotorPowerW'] / 1000 for x in rows], label='Front motor', color='#406acb')
axes[1].plot(t, [x['powertrain']['rearMotorPowerW'] / 1000 for x in rows], label='Rear motor', color='#a35c21')
axes[1].plot(t, [x['powertrain']['combinedMotorPowerW'] / 1000 for x in rows], label='Combined', color='#078187')
axes[1].axhline(335.565, color='#777', ls=':', lw=.8, label='Combined limit 335.565 kW')
axes[1].set_ylabel('Motor power (kW)')
axes[2].plot(t, [x['powertrain']['motorTorqueNm'] for x in rows], color='#a35c21', label='Combined motor torque')
axes[2].axhline(638.6, color='#777', ls=':', lw=.8, label='Combined limit 638.6 Nm')
axes[2].set_ylabel('Motor torque (Nm)')
axes[2].set_xlabel('Simulation time from stationary launch (seconds)')
for ax in axes:
    ax.set_xlim(0, 25)
    ax.set_ylim(bottom=0)
    ax.grid(alpha=.18)
    ax.legend(fontsize=8, loc='lower right')
fig.text(.013, -.018,
         'Production physics, 120 Hz; samples at approximately 0.5 s; Performance / SOC 90% / 1929 kg / dry friction 1.10.\n'
         'Strict stationary timing, no rollout. Engineering approximation; not Tesla official vehicle measurements.',
         fontsize=8, color='#555')
output = ROOT / 'reports/model3-performance-curves.png'
fig.savefig(output, dpi=160, bbox_inches='tight', facecolor='white')
print(output)
