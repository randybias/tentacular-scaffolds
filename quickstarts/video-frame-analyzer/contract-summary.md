
## Derived Artifacts

### Secrets

- `anthropic.api_key` → service=anthropic, key=api_key

### Egress Rules (NetworkPolicy)

| Host | Port | Protocol |
|------|------|----------|
| kube-dns.kube-system.svc.cluster.local | 53 | UDP |
| kube-dns.kube-system.svc.cluster.local | 53 | TCP |
| example.com | 443 | TCP |
| api.anthropic.com | 443 | TCP |

### Sidecar Containers

| Name | Image | Port | Note |
|------|-------|------|------|
| ffmpeg | ghcr.io/randybias/tentacular-ffmpeg-sidecar:v1.0.0 | 9000 | ffmpeg HTTP wrapper — no external egress needed |

### Shared Volume

- `/shared/input/` — Video files staged by engine
- `/shared/output/` — Frames extracted by ffmpeg sidecar

### Ingress Rules (NetworkPolicy)

None — manual trigger only, no webhook.
