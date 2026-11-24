"""Inference execution optimizations; official learned parameters stay intact.

Backbone caches historical layer states. After its first query only the newest
destination states are retained; historical destination FFNs can be skipped.
Affine projections commute with gathering. Verify retained outputs against the
unmodified official model before enabling this backend in the application.
"""
from collections import OrderedDict
from types import MethodType
import torch
from layers.graph_attention import GraphAttention, softmax
import modules.map_encoder as map_module

_original_reach = map_module.generate_reachable_matrix
_reach_cache = OrderedDict()


def reach_with_mps_cpu_graph(edge_index, hops, nodes):
    if edge_index.device.type != 'mps':
        return _original_reach(edge_index, hops, nodes)
    cpu = edge_index.cpu()
    key = (hops, nodes, tuple(cpu.reshape(-1).tolist()))
    if key not in _reach_cache:
        _reach_cache[key] = _original_reach(cpu, hops, nodes)
        if len(_reach_cache) > 8:
            _reach_cache.popitem(last=False)
    return [x.to(edge_index.device) for x in _reach_cache[key]]


def optimized_attention(self, x, edge_index, edge_attr=None):
    active = getattr(self, '_active_queries', None)
    dense = getattr(self, '_dense_attention', False)
    if active is None and not dense:
        return self._original_forward(x, edge_index, edge_attr)
    source, destination = (x, x) if self.if_self_attention else x
    if active is None:
        active = torch.arange(destination.shape[0], device=destination.device)
    # Upstream adds attention to its prenormalized destination (not raw x).
    residual = (self.mha_prenorm_src if self.if_self_attention else self.mha_prenorm_dst)(destination[active])
    if edge_index.shape[1] == 0:
        update = residual + self._ffn_layer(self.ffn_prenorm(residual))
    else:
        unique_source, source_inverse = torch.unique(edge_index[0], sorted=True, return_inverse=True)
        norm_source = self.mha_prenorm_src(source[unique_source])
        norm_destination = residual
        reverse = torch.full((destination.shape[0],), -1, device=destination.device, dtype=torch.long)
        reverse[active] = torch.arange(active.numel(), device=destination.device)
        target = reverse[edge_index[1]]
        if target.device.type == 'cpu' and (target < 0).any():
            raise RuntimeError('Attention pruning removed an actual query')
        query = self.q(norm_destination).view(-1, self.num_heads, self.head_dim)[target]
        key = self.k(norm_source).view(-1, self.num_heads, self.head_dim)[source_inverse]
        value = self.v(norm_source).view(-1, self.num_heads, self.head_dim)[source_inverse]
        if self.has_edge_attr:
            norm_edge = self.mha_prenorm_edge(edge_attr)
            key = key + self.edge_k(norm_edge).view(-1, self.num_heads, self.head_dim)
            value = value + self.edge_v(norm_edge).view(-1, self.num_heads, self.head_dim)
        scores = (query * key).sum(-1) * self.head_dim ** -.5
        if dense:
            mask = torch.arange(active.numel(), device=target.device)[:, None] == target[None, :]
            # Every original edge remains an independent softmax item,
            # including parallel edges. Empty groups produce a zero sum.
            logits = torch.where(mask[None], scores.T[:, None, :], -torch.inf)
            weights = logits.softmax(-1)
            weights = torch.where(mask.any(-1)[None, :, None], weights, 0)
            message = torch.bmm(weights, value.permute(1, 0, 2)).permute(1, 0, 2).reshape(-1, self.num_heads*self.head_dim)
        else:
            weights = softmax(scores, target, num_nodes=active.numel())
            messages = value * weights.unsqueeze(-1)
            message = torch.zeros((active.numel(), self.num_heads, self.head_dim), device=value.device, dtype=value.dtype)
            message.index_add_(0, target, messages)
            message = message.reshape(-1, self.num_heads*self.head_dim)
        update = residual + message
        update = update + self._ffn_layer(self.ffn_prenorm(update))
    full = destination.clone()
    full[active] = update
    return full


def install(model, *, active_queries=True, dense_attention=False):
    if model.training:
        raise RuntimeError('Optimizations are inference-only')
    map_module.generate_reachable_matrix = reach_with_mps_cpu_graph
    for module in model.modules():
        if isinstance(module, GraphAttention):
            module._original_forward = module.forward
            module._dense_attention = dense_attention
            module.forward = MethodType(optimized_attention, module)
    if active_queries:
        for backbone in [model.pred_backbone, model.plan_backbone]:
            original = backbone.inference
            def inference(owner, data, g_embs, a_embs, k_embs_dict, _original=original):
                actors, intervals, _ = data['agent']['infer_position'].shape
                active = intervals > owner.num_historical_intervals
                device = data['agent']['infer_position'].device
                agent_major = torch.arange(actors, device=device)*intervals + intervals - 1 if active else None
                time_major = (intervals - 1)*actors + torch.arange(actors, device=device) if active else None
                for layer in list(owner.k2k_t_attn_layers) + list(owner.g2k_attn_layers):
                    layer._active_queries = agent_major
                for layer in owner.k2k_a_attn_layers:
                    layer._active_queries = time_major
                return _original(data=data, g_embs=g_embs, a_embs=a_embs, k_embs_dict=k_embs_dict)
            backbone.inference = MethodType(inference, backbone)
    return model
