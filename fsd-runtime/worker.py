"""Bounded local JSON-lines IPC. No sockets, downloads or training dependencies."""
import json
import math
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'planr1'))
import torch
from torch_geometric.data import HeteroData, Batch
from inference import PlanR1
from transforms import TokenBuilder


def graph(state):
    """Three +Z forward/+X left → nuPlan x forward/y left, rear axle anchor."""
    data = HeteroData()
    agents = [state['ego']] + state.get('agents', [])
    origin = state['ego']['history'][-1]
    ox, oz = origin['x'], origin['z']
    positions, headings, velocities, boxes = [], [], [], []
    for i, agent in enumerate(agents):
        history = agent['history']
        if len(history) != 21:
            raise ValueError('Expected 21 actual/interpolated 10 Hz history states')
        positions.append([[h['z']-oz, h['x']-ox] for h in history])
        headings.append([h['yaw'] for h in history])
        velocities.append([[h['vz'], h['vx']] for h in history])
        half = agent['length']/2
        rear = agent.get('rearAxle', 0) if i == 0 else 0
        boxes.append([half+rear, half-rear, agent['width']/2, agent['width']/2])
    data['agent'].num_nodes = len(agents)
    data['agent'].position = torch.tensor(positions, dtype=torch.float32)
    data['agent'].heading = torch.tensor(headings, dtype=torch.float32)
    data['agent'].velocity = torch.tensor(velocities, dtype=torch.float32)
    data['agent'].visible_mask = torch.ones(len(agents), 21, dtype=torch.bool)
    data['agent'].type = torch.zeros(len(agents), dtype=torch.uint8)
    data['agent'].identity = torch.ones(len(agents), dtype=torch.uint8)
    data['agent'].identity[0] = 0
    data['agent'].box = torch.tensor(boxes, dtype=torch.float32)
    data['agent'].id = [a['id'] for a in agents]
    lanes = state['lanes'] + state.get('features', [])
    lookup = {lane['id']: i for i, lane in enumerate(lanes)}
    if not lanes or len(lanes) > 400 or len(agents) > 21:
        raise ValueError('World-state limits exceeded')
    positions, yaw, lengths, owners, types = [], [], [], [], []
    lane_positions, lane_yaws = [], []
    relations = {r: [] for r in ['left', 'right', 'incoming', 'outgoing']}
    for i, lane in enumerate(lanes):
        points = lane['points']
        # Upstream nuplan_utils.py uses the middle centreline segment as the
        # polygon anchor, and centreline-only polylines for a LANE polygon.
        middle = (len(points)-1)//2
        a, b = points[middle], points[middle+1]
        if lane.get('type',0) in [1,3]:
            lane_positions.append([sum(p[1] for p in points[:-1])/max(1,len(points)-1)-oz,sum(p[0] for p in points[:-1])/max(1,len(points)-1)-ox])
        else:
            lane_positions.append([a[1]-oz, a[0]-ox])
        lane_yaws.append(math.atan2(b[0]-a[0], b[1]-a[1])-(math.pi/2 if lane.get('type')==2 else 0))
        width = lane.get('width', 3.6)
        for a, b in zip(points, points[1:]):
            dx, dz = b[0]-a[0], b[1]-a[1]
            length = math.hypot(dx, dz)
            if length < .001:
                continue
            heading = math.atan2(dx, dz)
            positions.append([a[1]-oz, a[0]-ox])
            lengths.append(length); yaw.append(heading); owners.append(i); types.append(0 if lane.get('type',0)==0 else 1)
        for relation in relations:
            for other in lane.get(relation, []):
                if other in lookup:
                    relations[relation].append([lookup[other], i])
    data['polygon'].num_nodes = len(lanes)
    data['polygon'].position = torch.tensor(lane_positions, dtype=torch.float32)
    data['polygon'].heading = torch.tensor(lane_yaws, dtype=torch.float32)
    data['polygon'].heading_valid_mask = torch.tensor([l.get('headingValid',True) for l in lanes], dtype=torch.bool)
    data['polygon'].type = torch.tensor([l.get('type',0) for l in lanes], dtype=torch.uint8)
    data['polygon'].speed_limit = torch.tensor([l['speedLimit'] for l in lanes], dtype=torch.float32)
    data['polygon'].speed_limit_valid_mask = torch.tensor([l.get('type',0)==0 for l in lanes], dtype=torch.bool)
    data['polygon'].traffic_light = torch.tensor([l.get('trafficLight', 4) for l in lanes], dtype=torch.uint8)
    data['polygon'].on_route_mask = torch.tensor([l.get('route', False) for l in lanes], dtype=torch.bool)
    data['polyline'].num_nodes = len(positions)
    data['polyline'].position = torch.tensor(positions, dtype=torch.float32)
    data['polyline'].length = torch.tensor(lengths, dtype=torch.float32)
    data['polyline'].heading = torch.tensor(yaw, dtype=torch.float32)
    data['polyline'].type = torch.tensor(types, dtype=torch.uint8)
    data['polyline', 'polygon'].polyline_to_polygon_edge_index = torch.tensor([list(range(len(owners))), owners], dtype=torch.long)
    for relation, edges in relations.items():
        data['polygon', 'polygon'][relation+'_edge_index'] = torch.tensor(edges, dtype=torch.long).reshape(-1, 2).T.contiguous()
    return data, (ox, oz)


def load():
    torch.set_num_threads(1)
    torch.manual_seed(20261122)
    checkpoint = torch.load(HERE/'weights/fine-tuning.ckpt', map_location='cpu', weights_only=True)
    kwargs = dict(checkpoint['hyper_parameters'])
    kwargs['token_dict_path'] = str(HERE/'planr1/tokens/tokens_1024.pt')
    model = PlanR1(**kwargs).eval()
    model.load_state_dict(checkpoint['state_dict'], strict=True)
    builder = TokenBuilder(kwargs['token_dict_path'], interval=5, num_historical_steps=20, mode='plan')
    return model, builder


def predict(model, builder, state):
    start = time.perf_counter()
    data, (ox, oz) = graph(state)
    data = Batch.from_data_list([builder(data)])
    prepared = time.perf_counter()
    with torch.inference_mode():
        guide = state.get('guidance')
        goals = None
        if guide:
            if len(guide) != 16:
                raise ValueError('Expected sixteen local navigation targets')
            goals = torch.tensor([[p['z']-oz, p['x']-ox, p['yaw'], p['speed']] for p in guide])
        output, position, heading, valid = model.plan_inference(data, goals=goals)
    if not valid[0].all() or not torch.isfinite(position).all():
        raise ValueError('Invalid official model output')
    points = [{'x': float(p[1])+ox, 'z': float(p[0])+oz, 'yaw': float(h), 't': (i+1)*.5}
              for i, (p, h) in enumerate(zip(position[0], heading[0]))]
    return dict(requestId=state.get('requestId'), sourceTime=state['time'],
                model='official-plan-r1-fine-tuning', horizon=8, step=.5,
                decoding='route-ranked-top96' if goals is not None else 'official-top1', device='cpu', parameterTensors=964,
                adapterMs=(prepared-start)*1000, inferenceMs=(time.perf_counter()-prepared)*1000,
                points=points, tokens=output['agent']['infer_token'][0, -16:].tolist())


if __name__ == '__main__':
    try:
        model, builder = load()
        print(json.dumps({'event': 'ready', 'model': 'official-plan-r1-fine-tuning', 'strictWeights': True}), flush=True)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 2000000:
                raise ValueError('Request too large')
            request = json.loads(line)
            print(json.dumps(predict(model, builder, request)), flush=True)
        except Exception as error:
            print(json.dumps({'requestId': (request or {}).get('requestId'), 'error': str(error)}), flush=True)
            traceback.print_exc(file=sys.stderr)
