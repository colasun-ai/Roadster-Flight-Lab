#!/usr/bin/env python3
"""Summarize opt-in telemetry from an actual packaged Mac App run.

This reads recorded wall-clock samples. It never accelerates or drives the app.
"""
import datetime
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'


def quantile(values, fraction):
    values = sorted(values)
    if not values:
        return None
    n = (len(values) - 1) * fraction
    a, b = int(n), min(int(n) + 1, len(values) - 1)
    return values[a] + (values[b] - values[a]) * (n - a)


def stats(values):
    values = [v for v in values if isinstance(v, (float, int))]
    return dict(min=min(values), median=statistics.median(values),
                p05=quantile(values, .05), p95=quantile(values, .95), max=max(values)) if values else None


def read_json_lines(path):
    records = []
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # A writer can still be appending its last line.
    return records


def summarize():
    records = [r for r in read_json_lines(REPORTS / 'native-endurance.jsonl')
               if r.get('sample', {}).get('soak')]
    if not records:
        raise RuntimeError('No actual native endurance samples')
    events = sorted(read_json_lines(REPORTS / 'native-ui-events.jsonl'), key=lambda r: r['at'])
    phases = {}
    for record in records:
        phase = 'medium'
        for event in events:
            if event['at'] <= record['receivedAt'] and event['event'].startswith('quality-'):
                phase = event['event'].removeprefix('quality-')
        phases.setdefault(phase, []).append(record)
    last = records[-1]
    sample = last['sample']
    soak = sample['soak']
    errors = [dict(at=r['receivedAt'], errors=r['sample']['errors'])
              for r in records if r['sample'].get('errors')]
    console_path = REPORTS / 'native-console.log'
    console = console_path.read_text(errors='replace') if console_path.exists() else ''
    console_errors = [line for line in console.splitlines() if any(
        marker in line for marker in ('GL_INVALID_', 'CONTEXT_LOST', 'FATAL:', 'Uncaught', 'Render process gone'))]
    def metrics(rows):
        return {
            'sampleCount': len(rows),
            'fps': stats([r['sample']['performance']['fps'] for r in rows]),
            'physicsHz': stats([r['sample']['performance']['physicsHz'] for r in rows]),
            'frameTimeMs': stats([r['sample']['performance']['frameTimeMs'] for r in rows]),
            'physicsStepMs': stats([r['sample']['performance']['physicsStepMs'] for r in rows]),
            'jsHeapBytes': stats([r['sample']['performance']['jsHeapBytes'] for r in rows]),
            'drawCalls': stats([r['sample']['performance']['drawCalls'] for r in rows]),
            'trianglesIncludingShadowPasses': stats([r['sample']['performance']['triangles'] for r in rows]),
            'renderSizes': sorted({tuple(r['sample']['performance']['renderSize']) for r in rows}),
            'resourceCounts': sorted({tuple(r['sample']['resources'].get(k, 0) for k in ('geometries', 'textures', 'programs')) for r in rows}),
        }
    duration = soak['elapsedSeconds']
    passed = bool(duration >= 1800 and soak['complete'] and not errors and not console_errors and
                  soak['invalidStates'] == 0 and
                  all(r['sample']['worldBodies'] == 1 and r['sample']['worldColliders'] == 401 for r in records))
    result = {
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'platform': 'darwin arm64 / Apple M4 / 16GB / macOS 27.0 (26A5406e)',
        'version': '0.6.0', 'actualPackagedNativeApp': True,
        'appUrl': 'roadster://app/?native-audit=1',
        'auditDriver': 'Same visible 20-switch + 30-minute controls, real RAF and 120 Hz integration; no time compression',
        'wallSeconds': duration, 'simulationSeconds': soak['simulatedSeconds'],
        'renderedFramesDuringSoak': soak['frames'],
        'completedThirtyMinutes': bool(duration >= 1800 and soak['complete']),
        'passed': passed,
        'errorSamples': errors, 'invalidStates': soak['invalidStates'],
        'criticalConsoleErrors': console_errors,
        'worldBodyCounts': sorted({r['sample']['worldBodies'] for r in records}),
        'worldColliderCounts': sorted({r['sample']['worldColliders'] for r in records}),
        'vehicleIds': sorted({r['sample']['vehicleId'] for r in records}),
        'statistics': metrics(records),
        'qualityPhases': {p: metrics(rows) for p, rows in phases.items()},
        'firstFiveMinutes': metrics([r for r in records if r['sample']['soak']['elapsedSeconds'] <= 300]),
        'lastFiveMinutes': metrics([r for r in records if r['sample']['soak']['elapsedSeconds'] >= max(0, duration - 300)]),
        'osWorkingSetKiBByProcessType': {kind: stats([
            process['memory']['workingSetSize'] for r in records for process in r['processes'] if process['type'] == kind])
            for kind in sorted({process['type'] for r in records for process in r['processes']})},
        'events': events,
        'startupMs': sample['performance']['startupMs'],
        'model3LoadMs': sample['performance']['modelLoadMs'],
        'startupCaveat': 'Local final build with filesystem/renderer caches; not an uncached cross-device benchmark',
        'lastResources': sample['resources'],
        'lastProcessMemory': last['processes'],
        'memoryCaveat': 'JS heap and OS per-process working set are measured; GPU VRAM allocation is not directly measured. Geometry/texture/program counts are resource counts, not VRAM bytes.',
        'fpsCaveat': '5-second snapshots of rolling frame metrics; UI/menu operations and concurrent browser QA can affect low outliers. No claim for Windows FPS.',
        'rawEvidence': 'native-endurance.jsonl',
        'nativeSwitchAudit': sample['switchAudit'],
    }
    (REPORTS / 'native-endurance-summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('wallSeconds', 'simulationSeconds', 'completedThirtyMinutes', 'passed', 'invalidStates')}))
    return result


if __name__ == '__main__':
    summarize()
