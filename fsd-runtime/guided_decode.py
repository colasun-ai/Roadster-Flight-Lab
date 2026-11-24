"""Navigation-conditioned ranking of learned Plan-R1 ego motion tokens."""
import torch
from utils import transform_point_to_global_coordinate, wrap_angle

def choose(logits, data, dictionary, ego_index, goal):
    # The actual candidate poses are the official motion vocabulary transformed
    # by the same pose transition as PlanR1.transition, in model coordinates.
    values, ids = logits[ego_index][0].topk(96)
    tokens = dictionary['Vehicle'][ids]
    heading = data['agent']['infer_heading'][ego_index, -1].expand(len(ids))
    start = data['agent']['infer_position'][ego_index, -1].expand(len(ids), 2)
    poses = transform_point_to_global_coordinate(tokens[:, :2], start, heading)
    forward, left, yaw, speed = goal
    delta = poses - poses.new_tensor([forward, left])
    lateral = -yaw.sin()*delta[:, 0] + yaw.cos()*delta[:, 1]
    longitudinal = yaw.cos()*delta[:, 0] + yaw.sin()*delta[:, 1]
    bearing = wrap_angle(heading + tokens[:, 2] - yaw)
    cost = 2.8*lateral.square() + .62*longitudinal.square() + 26*bearing.square()
    cost += .24*(2*tokens[:, :2].norm(dim=1)-speed).square()
    return ids[(.23*(values-values.max())-cost).argmax()].reshape(1)
