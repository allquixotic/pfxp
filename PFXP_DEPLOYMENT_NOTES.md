# PFXP Deployment Notes

This assumes you use the same hosting architecture as I do. If not, ignore all of this.

## IPv6 Binding Issue with Caddy and Cloudflare Tunnel

### Date: 2025-09-23

### Problem
After setting up the stack (Cloudflare Tunnel → Caddy → pfxp), the site at https://xp.<redacted> was returning empty HTTP responses (0 bytes) despite showing HTTP 200 status codes.

### Root Cause
Caddy v2, when configured with `http://localhost:8080`, was defaulting to bind only on IPv6 (:::8080) and not IPv4. Meanwhile, Cloudflare Tunnel was attempting to connect to the service, but the connection wasn't working properly due to the IPv4/IPv6 mismatch.

### Diagnosis Steps
1. Direct curl to pfxp (localhost:3000) worked fine - returned full HTML
2. Curl to Caddy on localhost:8080 returned empty responses
3. Caddy access logs showed "NOP" (no operation) entries with status:0 and size:0
4. `netstat -tlnp | grep 8080` revealed Caddy was only listening on `:::8080` (IPv6 all interfaces)
5. Testing with `curl http://127.0.0.1:8080/` returned no response
6. Testing with `curl http://[::1]:8080/` initially returned 500 errors

### Resolution
Used Caddy's `bind` directive to explicitly bind to IPv4 localhost only:

```caddyfile
:8080 {
    bind 127.0.0.1
    # Rest of config...
}
```

Also updated Cloudflare tunnel config to explicitly use IPv4:
- `/root/.cloudflared/config.yml`: Changed `service: http://localhost:8080` to `service: http://127.0.0.1:8080`

### Key Learnings
1. Caddy v2 defaults to IPv6 when using `localhost` in the address
2. The `bind` directive must be used to explicitly control which interface Caddy listens on
3. For security on multi-homed hosts, always explicitly bind to loopback addresses rather than wildcards
4. When troubleshooting proxy chains, test each hop individually to isolate the problem

### Current Working Configuration
- **pfxp**: Running on 127.0.0.1:3000 (Bun/TypeScript application)
- **Caddy**: Bound to 127.0.0.1:8080, reverse proxying to pfxp
- **Cloudflare Tunnel**: Connecting to Caddy on 127.0.0.1:8080
- **Public Access**: https://xp.<redacted> → Cloudflare Tunnel → Caddy → pfxp

### Service Files
- `/etc/systemd/system/pfxp.service` - pfxp application service
- `/etc/systemd/system/caddy.service` - Caddy reverse proxy service
- `/etc/systemd/system/cloudflared.service` - Cloudflare tunnel service (created by `cloudflared service install`)

### Configuration Files
- `/etc/caddy/Caddyfile` - Caddy configuration
- `/root/.cloudflared/config.yml` - Cloudflare tunnel configuration
- `/home/pfxp/pfxp/` - pfxp application directory
