
## Derived Artifacts

### Secrets

- `anthropic.api_key` → service=anthropic, key=api_key

### Egress Rules (NetworkPolicy)

| Host | Port | Protocol |
|------|------|----------|
| kube-dns.kube-system.svc.cluster.local | 53 | UDP |
| kube-dns.kube-system.svc.cluster.local | 53 | TCP |
| raw.githubusercontent.com | 443 | TCP |
| api.anthropic.com | 443 | TCP |

### Sidecar Containers

| Name | Image | Port | Note |
|------|-------|------|------|
| pandoc | pandoc/core:latest | 3030 | pandoc-server HTTP API — no external egress needed |

### Ingress Rules (NetworkPolicy)

None — manual trigger only, no webhook.
