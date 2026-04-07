
## Derived Artifacts

### Egress Rules (NetworkPolicy)

| Host | Port | Protocol |
|------|------|----------|
| kube-dns.kube-system.svc.cluster.local | 53 | UDP |
| kube-dns.kube-system.svc.cluster.local | 53 | TCP |
| httpbin.org | 443 | TCP |
| otel-collector.tentacular-observability.svc.cluster.local | 4318 | TCP |

### Ingress Rules (NetworkPolicy)

| Port | Protocol | Trigger |
|------|----------|---------|
| 8080 | TCP | manual |

### Expected Span Hierarchy

```
invoke_workflow "otel-multi-node"
  execute_node "fetch-data"
    fetch https://httpbin.org/json        (auto: Deno OTel)
  execute_node "transform"
  execute_node "notify"
```

Validate in SigNoz:
- One `invoke_workflow` parent span
- Three `execute_node` child spans: fetch-data, transform, notify
- fetch-data node has a child fetch span for the HTTP GET to httpbin.org
- Correct parent-child relationships for all spans
- Per-node timing visible in trace waterfall
