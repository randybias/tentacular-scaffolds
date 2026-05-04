## Derived Artifacts

### Secrets

- `anthropic.api_key` -- service=anthropic, key=api_key
- `slack.webhook_url` -- service=slack-webhook, key=webhook_url

### Egress Rules (NetworkPolicy)

| Host | Port | Protocol |
|------|------|----------|
| kube-dns.kube-system.svc.cluster.local | 53 | UDP |
| kube-dns.kube-system.svc.cluster.local | 53 | TCP |
| (dynamic -- any video source) | 443, 80 | TCP |
| api.anthropic.com | 443 | TCP |
| hooks.slack.com | 443 | TCP |

### Exoskeleton Services

| Name | Protocol | Auto-provisioned |
|------|----------|-----------------|
| tentacular-rustfs | HTTP (S3-compatible) | Yes |
| tentacular-postgres | PostgreSQL | Yes |

### Sidecar Containers

| Name | Image | Port | Note |
|------|-------|------|------|
| ffmpeg | linuxserver/ffmpeg:latest | 9000 | Perl Tier 2 HTTP hook, no external egress needed |

### Shared Volume

- `/shared/input/` -- Video files staged by engine
- `/shared/output/` -- Frames extracted by ffmpeg sidecar

### Ingress Rules (NetworkPolicy)

None -- manual trigger only, no webhook.
