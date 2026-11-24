#!/usr/bin/env python3
"""Summarize real native records. Missing/incomplete runs never pass."""
import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'


def read_records(path):
    records = []
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                # The reader can be used while a final line is being appended.
                pass
    return records


def describe(values):
    values = [v for v in values if isinstance(v, (float, int)) and math.isfinite(v)]
    if not values:
        return None
    values.sort()
    return dict(count=len(values), mean=statistics.mean(values), minimum=values[0],
                p95=values[max(0, math.ceil(len(values) * .95) - 1)], maximum=values[-1])


def manifest(path):
    return dict(file=path.name, bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest()) if path.exists() else None


def profiles(name):
    path = REPORTS / name
    records = read_records(path)
    samples = [r for r in records if isinstance(r.get('sample'), dict)]
    completed = [r for r in samples if r['sample'].get('event') == 'profile-complete']
    current = completed[-1]['sample'] if completed else (samples[-1]['sample'] if samples else {})
    data = current.get('profiles', [])
    exported = REPORTS / name.replace('.jsonl', '-raw.json')
    raw_verified = False
    if exported.exists():
        raw = json.loads(exported.read_text()).get('profiles', [])
        raw_verified = len(raw) == 38 and len(data) == 38 and all(
            x['label'] == y['label'] and x['frames'] == len(x['rawFrameMs']) == y['frames']
            and abs(x['averageFps'] - len(x['rawFrameMs']) * 1000 / sum(x['rawFrameMs'])) < 1e-9
            for x, y in zip(raw, data))
        if raw_verified:
            data = raw
    complete = bool(completed) or (raw_verified and current.get('profileSuite', {}).get('running') is False)
    errors = [e for r in samples for e in r['sample'].get('errors', [])]
    console_errors = [r for r in records if r.get('event') == 'renderer-console'
                      and r.get('level') in ('error', 3)]
    # Exclude the arbitrary wait/export time after the last job from the CPU
    # comparison; the two operators need not take equally long to save a file.
    active_samples = [r for r in samples if r['sample'].get('profileSuite', {}).get('running')]
    cpu = [sum(p['cpu']['percentCPUUsage'] for p in r.get('processes', [])) for r in active_samples]
    working = [sum(p['memory']['workingSetSize'] for p in r.get('processes', [])) * 1024 for r in active_samples]
    return dict(source=manifest(path), complete=complete, profileCount=len(data),
                rawNativeUiExport=manifest(exported), rawExportVerified=raw_verified,
                completionEventReceived=bool(completed),
                passed=complete and len(data) == 38 and not errors and not console_errors,
                profiles=data, errors=errors, consoleErrors=console_errors,
                electronProcessCpuPercent=describe(cpu), aggregateProcessWorkingSetBytes=describe(working),
                processMetricNote='Only records while the 38-job suite is running; excludes post-completion idle/export time. Electron app.getAppMetrics raw percentCPUUsage summed over this app only. Working sets are KiB converted to bytes; shared pages may be counted more than once.',
                networkExternalRequests=[r for r in records if r.get('externalBlocked')])


def performance():
    before = profiles('performance-final-control-1080p.jsonl')
    after = profiles('performance-final-after-1080p.jsonl')
    output = dict(version='0.7.0', before=before, after=after,
                  passed=before['passed'] and after['passed'],
                  scope='Matched final packaged build, static batching disabled/enabled. Other fixes and medium refraction scaling are present in both.',
                  vramBytes=None, vramUnavailableReason='WebGL exposes no reliable VRAM allocation counter',
                  cpuFrameBoundary='RAF entry through render submission; excludes later HUD/QA serialization, not full OS CPU time',
                  onePercentLowDefinition='1000 divided by mean of slowest ceil(1 percent) actual RAF intervals',
                  percentiles='nearest rank', rows=[])
    a = {p['label']: p for p in before['profiles']}
    for b in after['profiles']:
        old = a.get(b['label'])
        if old is None:
            continue
        row = dict(label=b['label'], vehicleId=b['vehicleId'], quality=b['quality'], scenario=b['scenario'])
        for key in ['averageFps', 'onePercentLowFps', 'frameMs', 'cpuFrameMs', 'physicsStepMs',
                    'gpuRenderMs', 'drawCalls', 'triangles', 'heapBytes', 'speedKmh', 'renderSize']:
            row[key] = {'before': old.get(key), 'after': b.get(key)}
        output['rows'].append(row)
    (REPORTS / 'performance-final-comparison.json').write_text(json.dumps(output, indent=2) + '\n')
    if not output['passed']:
        print('Performance incomplete:', before['profileCount'], after['profileCount'])
        return
    lines = ['# v0.7 原生性能前后对照', '',
             '同一最终 Mac arm64 打包 App、1920×1080 实际渲染缓冲、同一物理和几何。对照仅关闭/开启静态合批；标准画质折射预渲染缩放与所有修复在两侧相同。各 38 个场景，每项预热 3 秒（高速/转弯 8 秒），实际 RAF 采样 8 秒。没有以模拟时间代替墙钟采样。', '',
             '完整原始帧、物理步和 CPU 提交时间由原生界面“下载逐帧性能记录”保存到两个 -raw.json，逐项核对 38 个场景、帧数并重算 FPS。自动完成事件可能被审计通道 500ms 节流丢弃，因此不以该事件作为唯一完成证据。GPU 时间来自 EXT_disjoint_timer_query_webgl2，末尾未返回的查询不填假数。FPS 受 60 Hz 垂直同步限制；不能将接近 60 FPS 的小波动称为明显提升。', '',
             '| 车型 / 画质 / 场景 | FPS 前→后 | 1% Low 前→后 | P95 / P99 ms 后 | GPU ms 前→后 | Calls 前→后 |',
             '| --- | ---: | ---: | ---: | ---: | ---: |']
    for row in output['rows']:
        val = lambda k, side: row[k][side]
        gpu = lambda side: (val('gpuRenderMs', side) or {}).get('mean')
        g = lambda n: '不可测' if n is None else f'{n:.2f}'
        lines.append(f"| {row['label']} | {val('averageFps','before'):.2f}→{val('averageFps','after'):.2f} | {val('onePercentLowFps','before'):.2f}→{val('onePercentLowFps','after'):.2f} | {val('frameMs','after')['p95']:.2f} / {val('frameMs','after')['p99']:.2f} | {g(gpu('before'))}→{g(gpu('after'))} | {val('drawCalls','before')['mean']:.1f}→{val('drawCalls','after')['mean']:.1f} |")
    lines += ['', '完整 CPU、物理步、三角面、JS Heap、速度范围、进程 CPU 和工作集见 performance-final-comparison.json。进程 CPU 为 Electron API 原值，只汇总本 App；工作集包含共享页，不能等同物理独占内存或 VRAM。CPU Frame 指 RAF 开始至渲染提交，不包含之后 HUD 序列化。1% Low 为最慢 ceil(1%) 帧间隔的平均值取倒数；P95/P99 为最近秩。', '',
              '几何层面：Model 3 190→154 Mesh，Model Y 70→65 Mesh，原始 684,315 / 346,278 三角面均保留。表中的 GPU 三角面/Calls 还包含场景、阴影和折射通道，不能等同 GLB 面数。', '',
              '历史优化前数据：performance-before-native.jsonl 为 v0.6 的两车原生基线（非 1080p），performance-batching-before-1080p.jsonl 为早期 v0.7 三车接入后基线（1080p）。当时有其他开发活动且部分物理/轮拱尚未修复，不能将其与最终版直接相减声称因果收益；最终同版本对照用于隔离合批影响。', '',
              '这是当前 Mac 单次成对采样，不是 Windows 实机或多机统计结论。输入延迟没有独立端到端硬件测量。']
    (REPORTS / 'performance-before-after.md').write_text('\n'.join(lines) + '\n')
    print('Performance complete: 38 + 38')


def soak():
    path = REPORTS / 'native-v07-endurance.jsonl'
    records = read_records(path)
    samples = [r for r in records if isinstance(r.get('sample'), dict)]
    with_soak = [r for r in samples if r['sample'].get('soak')]
    if not with_soak:
        print('Soak not started')
        return
    first, last = with_soak[0], with_soak[-1]
    current = last['sample']
    state = current['soak']
    sample_gaps = [(b['receivedAt'] - a['receivedAt']) / 1000 for a, b in zip(with_soak, with_soak[1:])]
    audits = [r['sample'].get('switchAudit') for r in samples if r['sample'].get('switchAudit')]
    audit = audits[-1] if audits else {}
    all_errors = [e for r in samples for e in r['sample'].get('errors', [])]
    console_errors = [r for r in records if r.get('event') == 'renderer-console' and r.get('level') in ('error', 3)]
    resources = [dict(seconds=r['sample']['soak']['elapsedSeconds'], vehicleId=r['sample']['vehicleId'],
                      resources=r['sample']['resources'], performance=r['sample']['performance'],
                      processes=r.get('processes'), inputLifecycle=r['sample'].get('inputLifecycle'),
                      renderLoop=r['sample'].get('renderLoop'),
                      worldBodies=r['sample']['worldBodies'], worldColliders=r['sample']['worldColliders']) for r in with_soak]
    checks = dict(realWallClock30Minutes=state.get('elapsedSeconds', 0) >= 1800,
                  clockMarkedComplete=state.get('complete') is True,
                  noSleepOrMissingInterval=max(sample_gaps, default=math.inf) < 15,
                  physicsKeptUp=state.get('simulatedSeconds', 0) >= .95 * state.get('elapsedSeconds', math.inf),
                  noInvalidPhysics=state.get('invalidStates', 1) == 0,
                  oneBodyAnd401Colliders=all(r['worldBodies'] == 1 and r['worldColliders'] == 401 for r in resources),
                  oneContinuousRenderLoop=all(r['renderLoop']['pending'] == 1 and r['renderLoop']['peak'] == 1 for r in resources),
                  oneInputControllerSixOwnedListeners=all(r['inputLifecycle']['controllers'] == 1 and r['inputLifecycle']['listeners'] == 6 for r in resources),
                  native54Switches=audit.get('passed') is True and len(audit.get('records', [])) >= 54,
                  noJavascriptOrConsoleErrors=not all_errors and not console_errors,
                  allThreeCarsObserved=len({r['vehicleId'] for r in resources}) == 3,
                  externalRequestsAbsent=not any(r.get('externalBlocked') for r in records))
    output = dict(version='0.7.0', passed=all(checks.values()), checks=checks,
                  source=manifest(path), firstReceivedAt=first['receivedAt'], lastReceivedAt=last['receivedAt'],
                  elapsedWallSeconds=state.get('elapsedSeconds'), simulationSeconds=state.get('simulatedSeconds'),
                  largestRecordGapSeconds=max(sample_gaps, default=None),
                  frames=state.get('frames'), finalSoak=state, nativeSwitchAudit=audit,
                  errors=all_errors, consoleErrors=console_errors, samples=resources,
                  vramBytes=None,
                  limit='One real Mac session; bounded three-model cache is intentional. Resource stability is evaluated after each vehicle and quality has warmed, not zero retained resources. No Windows runtime tested.')
    stop = REPORTS / 'native-v07-endurance-stop.json'
    if stop.exists():
        output['userStop'] = json.loads(stop.read_text())
        output['status'] = 'stopped-at-user-request'
        output['thirtyMinutesPassed'] = checks['realWallClock30Minutes'] and checks['clockMarkedComplete']
        output['interimIntegrityChecksPassed'] = all(value for key, value in checks.items()
                if key not in ['realWallClock30Minutes', 'clockMarkedComplete', 'allThreeCarsObserved'])
    (REPORTS / 'native-v07-endurance-summary.json').write_text(json.dumps(output, indent=2) + '\n')
    (REPORTS / 'vehicle-switch-results.json').write_text(json.dumps(dict(version='0.7.0', nativeAudit=audit, source=manifest(path)), indent=2) + '\n')
    print('Soak seconds:', round(state.get('elapsedSeconds', 0), 1), 'checks:', checks)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--section', choices=['performance', 'soak', 'all'], default='all')
    args = parser.parse_args()
    if args.section in ['performance', 'all']:
        performance()
    if args.section in ['soak', 'all']:
        soak()
