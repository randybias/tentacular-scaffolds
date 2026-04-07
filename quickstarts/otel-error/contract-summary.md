
## Derived Artifacts

### Egress Rules (NetworkPolicy)

| Host | Port | Protocol |
|------|------|----------|
| kube-dns.kube-system.svc.cluster.local | 53 | UDP |
| kube-dns.kube-system.svc.cluster.local | 53 | TCP |
| otel-collector.tentacular-observability.svc.cluster.local | 4318 | TCP |

### Ingress Rules (NetworkPolicy)

| Port | Protocol | Trigger |
|------|----------|---------|
| 8080 | TCP | manual |

### Expected Behavior

This scaffold is intentionally designed to fail. The workflow will:
1. Log a message before throwing
2. Throw a deliberate error with message "deliberate error: validating OTel error span production"
3. Report RED health status via wf_health

Validate in SigNoz:
- `execute_node` span for the "fail" node has status ERROR
- Exception event is recorded on the span
- `wf_health` returns RED for this workflow
