#!/usr/bin/env python3
"""P0: strict official checkpoint loading and full 8s planning inference.

Synthetic, labelled world-state fixture exercises the real trained model. It
does not prove closed-loop driving, benchmark dataset quality or road safety.
No weights, learned layers, official forward methods or future horizon change.
"""
import argparse
import hashlib
import json
import math
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / 'external/Plan-R1'
sys.path.insert(0, str(UPSTREAM))
import torch
from torch_geometric.data import HeteroData, Batch
from model import PlanR1
from transforms import TokenBuilder


def fixture(agent_count=3, speed=6.0, red=False):
    data = HeteroData()
    t = torch.linspace(-2, 0, 21)
    position = torch.zeros(agent_count, 21, 2)
    velocity = torch.zeros_like(position)
    for i in range(agent_count):
        v = speed if i == 0 else 4.0 + (i % 3)
        lane = 0 if i < 2 else (-1 if i % 2 else 1)
        position[i, :, 0] = t * v + (0 if i == 0 else 20 + (i // 3) * 12)
        position[i, :, 1] = lane * 3.6
        velocity[i, :, 0] = v
    data['agent'].num_nodes = agent_count
    data['agent'].position = position
    data['agent'].heading = torch.zeros(agent_count, 21)
    data['agent'].velocity = velocity
    data['agent'].visible_mask = torch.ones(agent_count, 21, dtype=torch.bool)
    data['agent'].type = torch.zeros(agent_count, dtype=torch.uint8)
    data['agent'].identity = torch.ones(agent_count, dtype=torch.uint8)
    data['agent'].identity[0] = 0
    data['agent'].box = torch.tensor([[2.35, 2.35, .925, .925]]).repeat(agent_count, 1)
    # nuPlan ego is at the rear axle; box encodes front/back extents from it.
    data['agent'].box[0] = torch.tensor([3.7875, .9125, .925, .925])
    data['agent'].id = ['ego'] + [f'traffic-{i}' for i in range(1, agent_count)]
    polygons = []
    line_positions, line_lengths, line_headings, line_types, line_to_polygon = [], [], [], [], []
    for lane in range(3):
        for segment in range(5):
            index = len(polygons)
            x, y = -40.0 + segment * 20, (lane - 1) * 3.6
            polygons.append((x, y, lane, segment))
            # Same centreline/boundary polyline semantics as upstream features.
            for offset, kind in [(0, 0), (-1.8, 1), (1.8, 1)]:
                for k in range(4):
                    line_positions.append([x + k * 5, y + offset])
                    line_lengths.append(5.0)
                    line_headings.append(0.0)
                    line_types.append(kind)
                    line_to_polygon.append(index)
    count = len(polygons)
    data['polygon'].num_nodes = count
    data['polygon'].position = torch.tensor([[x, y] for x, y, _, _ in polygons])
    data['polygon'].heading = torch.zeros(count)
    data['polygon'].heading_valid_mask = torch.ones(count, dtype=torch.bool)
    data['polygon'].type = torch.zeros(count, dtype=torch.uint8)
    data['polygon'].speed_limit = torch.full((count,), 13.89)
    data['polygon'].speed_limit_valid_mask = torch.ones(count, dtype=torch.bool)
    data['polygon'].on_route_mask = torch.tensor([lane == 1 for _, _, lane, _ in polygons])
    data['polygon'].traffic_light = torch.full((count,), 4, dtype=torch.uint8)
    if red:
        data['polygon'].traffic_light[8] = 2
    data['polyline'].num_nodes = len(line_positions)
    data['polyline'].position = torch.tensor(line_positions)
    data['polyline'].length = torch.tensor(line_lengths)
    data['polyline'].heading = torch.tensor(line_headings)
    data['polyline'].type = torch.tensor(line_types, dtype=torch.uint8)
    data['polyline', 'polygon'].polyline_to_polygon_edge_index = torch.stack([
        torch.arange(len(line_positions)), torch.tensor(line_to_polygon)])
    relations = {'left': [], 'right': [], 'incoming': [], 'outgoing': []}
    for i, (_, _, lane, segment) in enumerate(polygons):
        if lane < 2:
            relations['left'].append([i, i + 5])
        if lane > 0:
            relations['right'].append([i, i - 5])
        if segment > 0:
            relations['incoming'].append([i - 1, i])
        if segment < 4:
            relations['outgoing'].append([i + 1, i])
    for relation, edges in relations.items():
        data['polygon', 'polygon'][relation + '_edge_index'] = torch.tensor(edges).T.contiguous()
    return data


def run(device, agent_count, repeats, model, token_builder):
    model.to(device)
    before = time.perf_counter()
    prepared = Batch.from_data_list([token_builder(fixture(agent_count))])
    adapter_ms = (time.perf_counter() - before) * 1000
    prepared = prepared.to(device)
    timings = []
    output = None
    with torch.inference_mode():
        for i in range(repeats + 1):
            if device == 'mps':
                torch.mps.synchronize()
            start = time.perf_counter()
            _, pos, yaw, valid = model.plan_inference(prepared.clone())
            if device == 'mps':
                torch.mps.synchronize()
            elapsed = (time.perf_counter() - start) * 1000
            assert pos.shape == (agent_count, 16, 2)
            assert yaw.shape == (agent_count, 16)
            assert valid.all() and torch.isfinite(pos).all() and torch.isfinite(yaw).all()
            if i:
                timings.append(elapsed)
            output = dict(positions=pos[0].cpu().tolist(), headings=yaw[0].cpu().tolist())
    return dict(device=device, agents=agent_count, passed=True, horizonSeconds=8,
                stepSeconds=.5, outputPoints=16, historySeconds=2,
                fixtureAdapterMs=adapter_ms, rawInferenceMs=timings,
                meanInferenceMs=statistics.mean(timings),
                p95InferenceMs=sorted(timings)[max(0, math.ceil(.95*len(timings))-1)],
                inferenceHz=1000/statistics.mean(timings), trajectory=output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', choices=['cpu', 'mps', 'both'], default='cpu')
    parser.add_argument('--agents', type=int, nargs='+', default=[3, 11, 21])
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--optimized', action='store_true')
    parser.add_argument('--dense-attention', action='store_true')
    parser.add_argument('--output', default='reports/fsd/plan-r1-inference.json')
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    torch.manual_seed(20261122)
    checkpoint_path = UPSTREAM/'ckpts/fine-tuning.ckpt'
    checkpoint = torch.load(checkpoint_path, map_location='cpu', weights_only=True)
    kwargs = dict(checkpoint['hyper_parameters'])
    kwargs['token_dict_path'] = str(UPSTREAM/'tokens/tokens_1024.pt')
    model = PlanR1(**kwargs).eval()
    loading = model.load_state_dict(checkpoint['state_dict'], strict=True)
    assert not loading.missing_keys and not loading.unexpected_keys
    if args.optimized:
        from plan_r1_ops import install
        install(model, dense_attention=args.dense_attention)
    builder = TokenBuilder(kwargs['token_dict_path'], interval=5, num_historical_steps=20, mode='plan')
    result = dict(clientDate='2026-11-22', officialSourceCommit='23bc54433599002f275c18b88cf261ab5e87d775',
                  checkpointSha256=hashlib.sha256(checkpoint_path.read_bytes()).hexdigest(),
                  parameters=sum(p.numel() for p in model.parameters()), strictWeightLoad=True,
                  sourceForwardUnmodified=not args.optimized, torchVersion=torch.__version__,
                  optimizedActiveQueries=args.optimized, denseAttention=args.dense_attention,
                  cpuThreads=args.threads,
                  mpsAvailable=torch.backends.mps.is_available(), records=[],
                  boundary='Synthetic world-state fixtures; not a nuPlan benchmark or closed-loop integration test.')
    for device in ['cpu', 'mps'] if args.device == 'both' else [args.device]:
        for count in args.agents:
            try:
                record = run(device, count, args.repeats, model, builder)
            except Exception as error:
                import traceback
                record = dict(device=device, agents=count, passed=False, error=traceback.format_exc())
            result['records'].append(record)
            (ROOT/args.output).write_text(json.dumps(result, indent=2))
            print(json.dumps({k:v for k,v in record.items() if k!='trajectory'}), flush=True)
    result['passed'] = all(r['passed'] for r in result['records'])
    (ROOT/args.output).write_text(json.dumps(result, indent=2))
