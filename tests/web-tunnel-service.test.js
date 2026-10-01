import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createWebTunnelService } from '../src/services/web-tunnel-service.js';

function makeHarness() {
    const logs = [];
    const errors = [];
    const waSessions = new Map();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-'));
    return {
        logs,
        errors,
        waSessions,
        rootDir,
        engine: createWebTunnelService({
            rootDir,
            log: (...a) => logs.push(a),
            logError: (...a) => errors.push(a),
            waSessions
        })
    };
}

// A fake cloudflared: prints one quick-tunnel URL and then idles until killed.
function installFakeCloudflared(rootDir, url) {
    fs.mkdirSync(path.join(rootDir, 'bin'), { recursive: true });
    const bin = path.join(rootDir, 'bin', 'cloudflared');
    fs.writeFileSync(bin, `#!/bin/sh\necho "${url}"\nwhile true; do sleep 1; done\n`);
    fs.chmodSync(bin, 0o755);
    return bin;
}

const env = async (vars, fn) => {
    const saved = {};
    for (const k of Object.keys(vars)) {
        saved[k] = process.env[k];
        process.env[k] = vars[k];
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
};

test('createWebTunnelService validates its dependencies', () => {
    assert.throws(() => createWebTunnelService({}), /log/);
    assert.throws(() => createWebTunnelService({ log: () => {} }), /logError/);
    assert.throws(() => createWebTunnelService({ log: () => {}, logError: () => {} }), /rootDir/);
    assert.throws(() => createWebTunnelService({ log: () => {}, logError: () => {}, rootDir: '/x' }), /waSessions/);
    assert.ok(Object.isFrozen(makeHarness().engine));
});

test('startWebTunnel is a no-op unless WEB_TUNNEL is enabled', async () => {
    const { engine, logs } = makeHarness();
    await env({ WEB_TUNNEL: '' }, () => engine.startWebTunnel(3000));
    assert.equal(logs.length, 0);
});

test('quick tunnel hunts the URL, logs it and DMs the owner session', async () => {
    const { engine, logs, errors, waSessions, rootDir } = makeHarness();
    installFakeCloudflared(rootDir, 'https://shiny-test-tunnel.trycloudflare.com');

    const dms = [];
    // Baileys shape: authState lives on the sock object
    waSessions.set('s1', {
        sock: {
            sendMessage: (jid, content) => { dms.push({ jid, content }); return Promise.resolve({}); },
            authState: { creds: { me: { id: '2348012345678:7@s.whatsapp.net' } } }
        }
    });
    waSessions.set('s2', { sock: {} }); // session without identity is skipped

    await env({ WEB_TUNNEL: 'cloudflare', CLOUDFLARE_TUNNEL_TOKEN: '' }, async () => {
        await engine.startWebTunnel(3457);
        // stdout arrives asynchronously — wait for the DM
        for (let i = 0; i < 40 && dms.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        assert.ok(logs.some((a) => a[0] === 'TUNNEL' && String(a[1]).includes('shiny-test-tunnel.trycloudflare.com')));
        assert.equal(dms.length, 1);
        assert.equal(dms[0].jid, '2348012345678@s.whatsapp.net');
        assert.ok(dms[0].content.text.includes('shiny-test-tunnel.trycloudflare.com'));
        assert.equal(errors.length, 0);
        engine.stopWebTunnel();
    });
});

test('stopWebTunnel is safe when nothing was started', () => {
    const { engine } = makeHarness();
    engine.stopWebTunnel();
    engine.stopWebTunnel();
});
