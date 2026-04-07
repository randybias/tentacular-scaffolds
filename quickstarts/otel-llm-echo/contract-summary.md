
## Derived Artifacts

### Egress Rules (NetworkPolicy)

| Host | Port | Protocol |
|------|------|----------|
| kube-dns.kube-system.svc.cluster.local | 53 | UDP |
| kube-dns.kube-system.svc.cluster.local | 53 | TCP |
| api.anthropic.com | 443 | TCP |
| otel-collector.tentacular-observability.svc.cluster.local | 4318 | TCP |

### Ingress Rules (NetworkPolicy)

| Port | Protocol | Trigger |
|------|----------|---------|
| 8080 | TCP | manual |

### Secrets Required

| Secret | Description |
|--------|-------------|
| anthropic.api_key | Anthropic API key for LLM calls |
