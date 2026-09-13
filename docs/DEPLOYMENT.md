# Deploying Nova

`docker compose up -d --build` gets you a running server. This is everything
after that: TLS in front of it, the settings the Node adapter needs behind a
proxy, upgrades, and what to do when form posts start failing.

Nova is a single container plus a volume. There is no separate backend, no
queue, no cache to run.

## What you need

- A host with Docker and the Compose plugin.
- A domain pointed at it. **HTTPS is not optional**: installing the PWA and
  storing the session cookie both require it on anything other than `localhost`.
- Ports 80 and 443 open, so the proxy can get a certificate.

## 1. Configure Nova

Create a `.env` next to `compose.yaml`:

```bash
ORIGIN=https://nova.example.com
PORT=3000
```

`compose.yaml` reads `ORIGIN` and publishes the container's port 3000 on the
host. Behind a proxy you generally want that bound to localhost only — edit the
`ports:` entry to `'127.0.0.1:3000:3000'` so nothing reaches the app except
through the proxy.

```bash
docker compose up -d --build
curl -s localhost:3000/health
# {"status":"ok","uptimeSeconds":12,"database":{"ok":true,"latencyMs":0.4}}
```

## 2. Put TLS in front of it

### Caddy

Caddy gets and renews certificates on its own and sets `X-Forwarded-For` and
`X-Forwarded-Proto` without being asked, which makes it the shortest path to a
correct install.

`Caddyfile`:

```caddyfile
nova.example.com {
	encode zstd gzip
	reverse_proxy nova:3000
}
```

Run it in the same Compose project so `nova` resolves, and stop publishing the
app's port to the host:

```yaml
services:
  nova:
    # ...
    ports: [] # reached through caddy, not from outside

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  nova-data:
  caddy-data:
  caddy-config:
```

### nginx

With the app published on `127.0.0.1:3000`:

```nginx
server {
	listen 80;
	server_name nova.example.com;
	return 301 https://$host$request_uri;
}

server {
	listen 443 ssl;
	http2 on;
	server_name nova.example.com;

	ssl_certificate     /etc/letsencrypt/live/nova.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/nova.example.com/privkey.pem;

	# Matches BODY_SIZE_LIMIT in compose.yaml; nginx would reject first otherwise.
	client_max_body_size 1m;

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_http_version 1.1;

		proxy_set_header Host              $host;
		proxy_set_header X-Real-IP         $remote_addr;
		proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header X-Forwarded-Host  $host;
	}
}
```

Certificates: `sudo certbot --nginx -d nova.example.com`, which also installs
the renewal timer.

## 3. Tell the Node adapter about the proxy

Behind a proxy the app sees the proxy's IP and a plain HTTP connection unless it
is told which headers to trust. Add to the `nova` service's `environment:`:

```yaml
ADDRESS_HEADER: X-Forwarded-For
PROTOCOL_HEADER: X-Forwarded-Proto
HOST_HEADER: X-Forwarded-Host
XFF_DEPTH: 1
```

- `ADDRESS_HEADER` is what `event.getClientAddress()` reads — without it, every
  request looks like it came from the proxy.
- `PROTOCOL_HEADER` is how the app knows the browser is on HTTPS even though the
  hop from the proxy is not.
- `XFF_DEPTH` is the number of **trusted** proxies in front of Nova, counted
  from the right of `X-Forwarded-For`. One proxy is `1`; add a CDN in front and
  it becomes `2`.

Only set `ADDRESS_HEADER` when a proxy you control overwrites that header on
every request. A client can send `X-Forwarded-For` itself, and an app that
trusts it blindly is trusting the client.

This is also what the sign-in rate limiter counts by. Without `ADDRESS_HEADER`
every request looks like it came from the proxy, so the per-address half of the
limit lumps the whole internet into one bucket; with it trusted wrongly, a
client can pick a fresh address per attempt and dodge that half entirely. The
per-account half works either way.

## 4. `ORIGIN` must match the URL you browse to

This is the most common deployment failure, and it does not look like a
configuration problem.

SvelteKit compares the `Origin` header of every form post against `ORIGIN`. If
they differ, the request never reaches the app:

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Cross-site POST form submissions are forbidden
```

**The symptom:** pages load perfectly, and then nothing you submit works. Sign
in, registering, logging an entry — every form comes back as a plain-text 403
saying `Cross-site POST form submissions are forbidden`. Nothing appears in the
application log either: the check runs before Nova's hooks, so there is no
request line and no error id to look up. Reading `docker compose logs` and
finding nothing is part of the symptom.

`ORIGIN` has to match scheme, host **and** port, with no trailing slash and no
path:

| Browsed URL                     | Correct `ORIGIN`                |
| ------------------------------- | ------------------------------- |
| `https://nova.example.com`      | `https://nova.example.com`      |
| `https://nova.example.com:8443` | `https://nova.example.com:8443` |
| `http://192.168.1.10:3000`      | `http://192.168.1.10:3000`      |

Things that catch people out:

- Terminating TLS at the proxy and leaving `ORIGIN=http://…`. The browser sends
  `https://` and the strings differ.
- Reaching the same instance two ways — `https://nova.example.com` and
  `http://192.168.1.10:3000`. Only the one in `ORIGIN` can post.
- A trailing slash: `https://nova.example.com/` is not the same string.
- Changing `.env` without recreating the container. `docker compose up -d`
  applies it; `docker compose restart` does not re-read the environment.

Check what the container actually has:

```bash
docker compose exec nova printenv ORIGIN
```

## 5. Logs and health

The server writes one JSON object per line to stdout:

```bash
docker compose logs -f nova
```

```json
{
	"time": "2026-09-13T03:30:18Z",
	"level": "info",
	"message": "request",
	"requestId": "d1f2…",
	"method": "POST",
	"path": "/goals/6f1c…",
	"status": 303,
	"durationMs": 5,
	"userId": "0f57…"
}
```

- `LOG_LEVEL=debug` adds the healthcheck requests, which are otherwise kept out
  of the stream. `LOG_FORMAT=pretty` is easier on the eyes while developing.
- Passwords, tokens and cookies are redacted before a line is written, and query
  strings are never logged.
- When a user hits an error they are shown a reference like `(reference
a1b2c3d4)`. Find it with `docker compose logs nova | grep a1b2c3d4` — that
  line has the stack, the path and the user id.

`/health` reports whether the database answers, and is what the container's
`HEALTHCHECK` polls, so `docker compose ps` shows `healthy` only when the
database is actually reachable. Point an uptime monitor at the same URL.

Optional: set `ERROR_REPORT_URL` to POST unhandled errors as JSON to a sink you
host. It is off unless set — nothing leaves the machine by default.

## 6. Where the data lives, and what to back up

Everything is on the `nova-data` volume, mounted at `/data`:

| Path                                     | What it is                               |
| ---------------------------------------- | ---------------------------------------- |
| `/data/nova.db`                          | The database. Losing it loses everything |
| `/data/nova.db-wal`, `/data/nova.db-shm` | WAL sidecars of the live database        |
| `/data/backups/`                         | Rotating snapshots the server takes      |

Nova snapshots itself daily with `VACUUM INTO`, which is consistent on a live
WAL database, and keeps the newest snapshot of each of the last 7 days and 4
weeks (`BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`).

That protects you from a bad upgrade or a wrong delete. It does not protect you
from losing the host, because the snapshots sit on the same volume. Pull them
off on a schedule:

```bash
# On the host, daily from cron:
docker compose cp nova:/data/backups /srv/nova-backups
rsync -a --delete /srv/nova-backups/ backup-host:/srv/nova-backups/
```

Verify one before you need it. A snapshot is a self-contained SQLite file, so
this is enough:

```bash
docker compose cp nova:/data/backups/nova-20260913T030000Z.db /tmp/check.db
sqlite3 /tmp/check.db 'PRAGMA integrity_check; SELECT count(*) FROM goals;'
```

The restore procedure is in the [README](../README.md#restoring).

## 7. Upgrading

```bash
git pull
docker compose up -d --build
```

That rebuilds the image and recreates the container. **Migrations run
automatically on start** — the container's command applies pending Drizzle
migrations before the server listens, and skips the ones already applied. There
is no separate migration step to run, and no window where the app is up against
an old schema.

Before a big upgrade, take a snapshot you can name:

```bash
docker compose exec nova ls /data/backups | tail -1   # or just wait for today's
```

If an upgrade goes wrong, restore that snapshot (README, _Restoring_) and
`docker compose up -d --build` the previous commit. Migrations are immutable and
only ever move forward, so rolling the **image** back is only safe alongside a
snapshot from before the migration ran.

Watch it come back:

```bash
docker compose ps          # healthy, not just running
docker compose logs -f nova
```

## 8. Email, if you want password resets

Nova sends exactly one kind of message — a password reset link — and only if you
configure a mail server. Leave `SMTP_HOST` unset and nothing changes: no mail,
no outbound connection, and the "forgotten password" page says so plainly rather
than pretending to have sent something. The way back in is then the shell:

```bash
docker compose exec nova node scripts/reset-password.mjs pilot@example.com
# Reset link for Test Pilot <pilot@example.com> — works once, expires in 30 minutes:
# https://nova.example.com/reset?token=...
```

For a one-person instance that is arguably the better answer: nothing to
configure, nothing to deliver, no credentials on disk.

To send mail instead, point Nova at any SMTP server:

```yaml
SMTP_HOST: smtp.example.com
SMTP_PORT: 587
SMTP_USER: nova@example.com
SMTP_PASS: an-app-password
MAIL_FROM: Nova <nova@example.com>
```

Port 465 is treated as implicit TLS; every other port must support STARTTLS,
which Nova requires rather than merely attempts — a relay that cannot upgrade
would otherwise carry the reset link in clear text across the network.

**Deliverability is the hard part, not the configuration.** Two things decide
whether your reset mail arrives:

- **Most hosts block outbound port 25**, so a mail server on the same box
  usually cannot deliver directly. Relaying through a mailbox provider you
  already have (its SMTP host, your address, an app password) is the path of
  least resistance.
- **Mail from a domain with no SPF, DKIM or DMARC records is treated as
  suspicious**, and silently binned by the larger receivers. If you send as
  `you@yourdomain`, publish at least SPF and DKIM for whatever relays it.

Test it before you need it — ask for a reset on your own account and watch the
logs. A failed send is logged at `error` with `mail send failed`; the reset link
never appears in the logs, whether the send worked or not.

`ORIGIN` matters more than usual here: the link in the email is built from it.
Nova will not fall back to the request's `Host` header, because that header is
written by whoever sent the request and a reset link built from it would point
wherever they liked. If `ORIGIN` is unset in production the send is refused and
logged.

## Troubleshooting

| Symptom                                                                                               | Cause                                                             | Fix                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pages load, every form returns `Cross-site POST form submissions are forbidden` and nothing is logged | `ORIGIN` ≠ the URL in the address bar                             | Set `ORIGIN` to the exact browsed origin, then `docker compose up -d`                      |
| Signed out immediately after signing in                                                               | Cookie is `secure` in production and the connection is plain HTTP | Serve over HTTPS and set `PROTOCOL_HEADER`                                                 |
| Browser will not offer "Install"                                                                      | PWA requires HTTPS and a reachable manifest                       | Finish the TLS step; check `/manifest.webmanifest` loads                                   |
| Every log line shows the proxy's IP                                                                   | `ADDRESS_HEADER` unset                                            | Set `ADDRESS_HEADER`/`XFF_DEPTH` as above                                                  |
| 502 from the proxy                                                                                    | Container down, or the proxy points at the wrong port             | `docker compose ps`, `curl localhost:3000/health`                                          |
| `docker compose ps` shows `unhealthy`                                                                 | The database is not reachable                                     | `curl localhost:3000/health`, check the `nova-data` volume is mounted                      |
| Uploads or long forms rejected with 413                                                               | `BODY_SIZE_LIMIT` or the proxy's body limit                       | Raise both; they have to agree                                                             |
| Reset mail never arrives                                                                              | No `SMTP_HOST`, or the relay rejected it                          | `docker compose logs nova \| grep 'mail send failed'`; or use `scripts/reset-password.mjs` |
| Reset links point at `localhost`                                                                      | `ORIGIN` unset or wrong                                           | Set `ORIGIN` to the browsed origin, as in step 4                                           |
