#!/usr/bin/env python3
import copy
import json
import time
from pathlib import Path
import torch
from verify_plan_r1 import ROOT, UPSTREAM, PlanR1, TokenBuilder, Batch, fixture
from plan_r1_ops import install

torch.set_num_threads(1)
torch.manual_seed(20261122)
checkpoint = torch.load(UPSTREAM/'ckpts/fine-tuning.ckpt', map_location='cpu', weights_only=True)
kwargs = dict(checkpoint['hyper_parameters'])
kwargs['token_dict_path'] = str(UPSTREAM/'tokens/tokens_1024.pt')
original = PlanR1(**kwargs).eval()
original.load_state_dict(checkpoint['state_dict'], strict=True)
optimized = PlanR1(**kwargs).eval()
optimized.load_state_dict(checkpoint['state_dict'], strict=True)
install(optimized)
builder = TokenBuilder(kwargs['token_dict_path'], interval=5, num_historical_steps=20, mode='plan')
result = {'clientDate':'2026-11-22', 'learnedParameterTensorsUnchanged':all(torch.equal(a,b) for a,b in zip(original.parameters(),optimized.parameters())),
          'method':'Identical state, full 16 autoregressive steps, all actors; strict token equality and position/heading tolerance 1e-6.', 'tests':[]}
for count, speed, red in [(1,0,False),(3,3,False),(3,6,True),(11,8,False),(21,6,True),(21,13,False)]:
    data = Batch.from_data_list([builder(fixture(count,speed,red))])
    with torch.inference_mode():
        start = time.perf_counter();a = original.plan_inference(data.clone());base_ms = (time.perf_counter()-start)*1000
        start = time.perf_counter();b = optimized.plan_inference(data.clone());fast_ms = (time.perf_counter()-start)*1000
    token_equal = torch.equal(a[0]['agent']['infer_token'],b[0]['agent']['infer_token'])
    pos_error = (a[1]-b[1]).abs().max().item();yaw_error = (a[2]-b[2]).abs().max().item()
    passed = token_equal and pos_error<=1e-6 and yaw_error<=1e-6 and torch.equal(a[3],b[3])
    record = dict(actors=count,speedMps=speed,red=red,allActorTokensEqual=token_equal,
                  maxPositionErrorM=pos_error,maxHeadingErrorRad=yaw_error,passed=passed,
                  originalMs=base_ms,optimizedMs=fast_ms)
    result['tests'].append(record)
    (ROOT/'reports/fsd/plan-r1-operator-equivalence.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(record),flush=True)
result['passed'] = result['learnedParameterTensorsUnchanged'] and all(t['passed'] for t in result['tests'])
(ROOT/'reports/fsd/plan-r1-operator-equivalence.json').write_text(json.dumps(result,indent=2))
assert result['passed'], 'Optimized model changed actual planning tokens'
