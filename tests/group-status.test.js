import test from 'node:test';
import assert from 'node:assert/strict';

import { createGroupStatusCommands } from '../src/commands/group/status.js';

function createFixture({ fromMe = true, dev = false } = {}) {
    const replies = [];
    const sends = [];
    const participants = [
        { id: '2348000000001:5@s.whatsapp.net' },
        { id: '2348555555555@s.whatsapp.net' }
    ];
    const sock = {
        async groupMetadata(jid) { return { participants }; },
        async sendMessage(jid, content, options) { sends.push({ jid, content, options }); }
    };
    const [command] = createGroupStatusCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        isDevNumber: () => dev
    });
    const baseContext = overrides => ({
        sock,
        remoteJid: 'group@g.us',
        message: { key: { remoteJid: 'group@g.us' } },
        args: ['hello', 'world'],
        senderJid: '2348000000001@s.whatsapp.net',
        isSenderOwner: fromMe,
        ...overrides
    });
    return { command, replies, sends, participants, baseContext };
}

test('gcstatus outside a group explains and does not fire', async () => {
    const f = createFixture();
    await f.command.execute(f.baseContext({ remoteJid: 'chat@s.whatsapp.net' }));
    assert.match(f.replies[0].text, /Only works inside a group/);
    assert.equal(f.sends.length, 0);
});

test('gcstatus is owner/dev only', async () => {
    const f = createFixture({ fromMe: false, dev: false });
    await f.command.execute(f.baseContext({}));
    assert.match(f.replies[0].text, /Owner\/dev only/);
    assert.equal(f.sends.length, 0);
});

test('gcstatus bare explains usage only', async () => {
    const f = createFixture();
    await f.command.execute(f.baseContext({ args: [] }));
    assert.match(f.replies[0].text, /Usage: \.gcstatus/);
    assert.equal(f.sends.length, 0);
});

test('gcstatus posts the text with the Squichy group-status dressing', async () => {
    const f = createFixture();
    await f.command.execute(f.baseContext({}));
    assert.equal(f.sends.length, 1);
    const send = f.sends[0];
    assert.equal(send.jid, 'group@g.us');
    assert.equal(send.content.text, 'hello world');
    assert.equal(send.content.contextInfo.isGroupStatus, true);
    assert.deepEqual(send.content.contextInfo.mentionedJid, f.participants.map(p => p.id));
    assert.deepEqual(send.options.statusJidList, f.participants.map(p => p.id));
    assert.match(f.replies.at(-1).text, /uploaded to group status \(2 members\)/);
});
