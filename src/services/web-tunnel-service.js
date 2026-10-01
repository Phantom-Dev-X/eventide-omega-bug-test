// 🌐 Web tunnel service — the opt-in Cloudflare quick tunnel for the
// dashboard, extracted from index.js unchanged. `startWebTunnel(port)` is a
// no-op unless WEB_TUNNEL names a mode (cloudflare/true/1/yes); it downloads
// the cloudflared binary once into <rootDir>/bin, then either runs a NAMED
// tunnel (CLOUDFLARE_TUNNEL_TOKEN, permanent URL) or a free QUICK tunnel and
// hunts stdout/stderr for the rotated https://…trycloudflare.com URL — every
// new URL is logged and DM'd to the owner's own WhatsApp via the active
// sessions. A crashed cloudflared restarts itself after 15s until
// `stopWebTunnel()` is called by the shutdown handler (which also SIGKILLs
// the child).
import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';

export function createWebTunnelService(deps) {
    for (const name of ['log', 'logError']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createWebTunnelService: missing required dependency: ${name}`);
        }
    }
    if (typeof deps?.rootDir !== 'string') {
        throw new Error('createWebTunnelService: missing required dependency: rootDir');
    }
    if (!(deps?.waSessions instanceof Map)) {
        throw new Error('createWebTunnelService: missing required dependency: waSessions (Map)');
    }
    const { rootDir, log, logError, waSessions } = deps;

    // 🌐 WEB TUNNEL (opt-in: WEB_TUNNEL=cloudflare on the panel) — free Cloudflare
    // quick tunnel: gives the dashboard a clean public https://…trycloudflare.com
    // address — no :port, IP hidden, HTTPS included, no account needed. The URL
    // rotates on every start, so each new URL is logged AND DM'd to the owner on
    // WhatsApp (same path as the deploy DMs).
    let tunnelChild = null;
    let tunnelUrl = null;
    let tunnelStopped = false;
    function dmOwnersWa(text) {
        for (const sess of waSessions.values()) {
            try {
                const myJid = sess?.sock?.authState?.creds?.me?.id;
                if (!myJid) continue;
                const selfJid = `${myJid.split(':')[0]}@s.whatsapp.net`;
                sess.sock.sendMessage(selfJid, { text }).catch(() => {});
            } catch (_) {}
        }
    }
    async function startWebTunnel(port) {
        const mode = String(process.env.WEB_TUNNEL || '').trim().toLowerCase();
        if (!['cloudflare', 'true', '1', 'yes'].includes(mode)) return;
        const binPath = path.join(rootDir, 'bin', 'cloudflared');
        try {
            if (!fs.existsSync(binPath)) {
                const archFile = process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
                log('TUNNEL', `downloading ${archFile} (one-time)…`);
                const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${archFile}`);
                if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
                const buf = Buffer.from(await res.arrayBuffer());
                fs.mkdirSync(path.dirname(binPath), { recursive: true });
                fs.writeFileSync(binPath, buf);
                fs.chmodSync(binPath, 0o755);
                log('TUNNEL', `cloudflared saved (${Math.round(buf.length / 1048576)}MB)`);
            }
            const tunnelToken = String(process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();
            if (tunnelToken) {
                // NAMED tunnel — permanent address (your domain mapped in the
                // Cloudflare dashboard). No URL rotation, no DM needed.
                log('TUNNEL', 'named tunnel starting (permanent URL from your Cloudflare dashboard)');
                tunnelChild = spawn(binPath, ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken], { stdio: ['ignore', 'pipe', 'pipe'] });
                tunnelChild.stderr.on('data', d => {
                    if (/Registered tunnel connection/i.test(String(d))) log('TUNNEL', '✅ named tunnel connected — permanent URL is live');
                });
            } else {
                tunnelChild = spawn(binPath, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
            }
            const huntUrl = chunk => {
                const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
                if (m && tunnelUrl !== m[0]) {
                    tunnelUrl = m[0];
                    log('TUNNEL', `🌐 dashboard live at ${tunnelUrl}`);
                    dmOwnersWa(`🌐 *WEB TUNNEL UP*\n\n${tunnelUrl}\n\nPair/dashboard address — no port, HTTPS, IP hidden.\nRotates on restart; every new URL gets DM'd here.`);
                }
            };
            tunnelChild.stdout.on('data', huntUrl);
            tunnelChild.stderr.on('data', huntUrl);
            tunnelChild.on('exit', code => {
                tunnelChild = null; tunnelUrl = null;
                if (tunnelStopped) return;
                log('TUNNEL', `cloudflared exited (code ${code}) — restarting in 15s`);
                setTimeout(() => startWebTunnel(port).catch(() => {}), 15000);
            });
        } catch (err) {
            logError('TUNNEL', 'web tunnel could not start (binary download/exec failed?)', err);
        }
    }

    function stopWebTunnel() {
        tunnelStopped = true;
        if (tunnelChild) tunnelChild.kill('SIGKILL');
    }

    return Object.freeze({ startWebTunnel, stopWebTunnel });
}
