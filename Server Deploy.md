# Server Deploy (for AI)

Deploy this repo to the homeserver. Prefer non-interactive SSH/SCP with key auth (`BatchMode=yes`). On Windows sandbox issues, request `required_permissions: ["all"]`.

## Target

| Item | Value |
|------|-------|
| Host | `192.168.31.11` |
| User | `kasusa` |
| App dir | `/home/kasusa/video-tricks` |
| Screen name | `videotrick` |
| Port | `6688` |
| Node binary | `/home/kasusa/.nvm/versions/node/v20.20.0/bin/node` |
| Auth | SSH key (no password prompt) |

**Important:** Non-interactive SSH does **not** load nvm. Always use the absolute Node path above (or `source ~/.nvm/nvm.sh` first). Plain `node` will fail with `command not found`.

## Steps

### 1. Pack locally

From the repo root:

```bash
node pack.js
```

Output: `videos-tricks.zip` (source only; excludes `node_modules`, `.git`, `uploads`, `data`, etc.).

### 2. Upload zip

```bash
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new videos-tricks.zip kasusa@192.168.31.11:/home/kasusa/video-tricks/videos-tricks.zip
```

### 3. Stop old process, unzip, restart in screen

```bash
ssh -o BatchMode=yes kasusa@192.168.31.11 '
set -e
cd /home/kasusa/video-tricks
NODE=/home/kasusa/.nvm/versions/node/v20.20.0/bin/node

# Stop existing videotrick screen (name or pid.name both OK)
screen -S videotrick -X quit 2>/dev/null || true
# Fallback: kill whatever is listening on 6688
fuser -k 6688/tcp 2>/dev/null || true
sleep 1

unzip -o videos-tricks.zip

# Start detached screen with absolute node path
screen -dmS videotrick "$NODE" /home/kasusa/video-tricks/server.js 6688
sleep 2

screen -ls | grep -i videotrick
ss -tlnp 2>/dev/null | grep 6688 || true
curl -s -o /dev/null -w "http=%{http_code}\n" --connect-timeout 3 http://127.0.0.1:6688/
'
```

### 4. Success criteria

- `screen -ls` shows a detached session named `videotrick`
- Something is `LISTEN` on `0.0.0.0:6688` (`node`)
- `curl` to `http://127.0.0.1:6688/` returns `http=200`

## Notes

- Do **not** run `npm install` unless dependencies changed; `node_modules` is already on the server and not in the zip.
- Tray/`systray` warnings on Linux are expected and can be ignored.
- If Node version changes under `~/.nvm/versions/node/`, update the absolute path in this doc.
- Prefer starting screen as: `screen -dmS videotrick "$NODE" .../server.js 6688` (direct exec). Wrapping with `bash -c` via SSH can leave the process outside screen.
- Old historical session id was like `5855.videotrick`; always target by name `videotrick`.

## One-shot (after pack)

```bash
scp -o BatchMode=yes videos-tricks.zip kasusa@192.168.31.11:/home/kasusa/video-tricks/videos-tricks.zip && \
ssh -o BatchMode=yes kasusa@192.168.31.11 'cd /home/kasusa/video-tricks && NODE=/home/kasusa/.nvm/versions/node/v20.20.0/bin/node && screen -S videotrick -X quit 2>/dev/null; fuser -k 6688/tcp 2>/dev/null; sleep 1; unzip -o videos-tricks.zip && screen -dmS videotrick "$NODE" /home/kasusa/video-tricks/server.js 6688 && sleep 2 && screen -ls | grep videotrick && curl -s -o /dev/null -w "http=%{http_code}\n" --connect-timeout 3 http://127.0.0.1:6688/'
```
