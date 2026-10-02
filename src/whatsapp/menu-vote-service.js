// 🗳️ Menu-vote service — the shared poll-vote dispatcher, extracted from
// index.js unchanged. `handleMenuVote(sock, remoteJid, phoneNumber,
// votedOptionId, pollId, voterJid)` receives every decrypted menu-poll vote
// (owner domain poll, help personas, tic-tac-toe lobbies, welcome/goodbye,
// warn ward configuration, autoreact and antidelete endpoint setup) and
// routes it through a switch on the option id: it deletes the previous menu
// reply via `menuReplyMessages` on every vote change, consults the ttt
// engine / warn service / antidelete service / eclipse & ruin interfaces and
// the session Maps from src/core/state.js, and replies with
// `safeWaReply`/`sendMenuPoll`/`sendMenuBanner`. Failing branches are logged
// (POLL-MENU) and never throw to the caller.
//
// Conventions: log/logError and the shared session Maps are injected; menu
// asset paths and texts are injected as strings; everything else (config
// store, ttt engine surface, warn/antidelete services, menu senders, persona
// menus) is injected from index.js where those services are wired.
export function createMenuVoteService(deps) {
    for (const name of ['applyWardEndpoint', 'buildBugMenuText', 'buildOmegaTerminal', 'buildRuinCommandIndexBox', 'buildRuinConfigMenu', 'buildRuinFunMenu', 'buildRuinGroupMenu', 'buildRuinSystemMenu', 'delay', 'deleteMenuMessages', 'ensureWarnGroup', 'getAntideleteState', 'getTttGame', 'getWarnState', 'handleGameVote', 'listAntideleteEndpoints', 'loadBotConfig', 'loadBotMode', 'loadWarnLog', 'log', 'logError', 'offerGroupPickPoll', 'recordMenuMessage', 'safeWaReply', 'saveBotConfig', 'saveWarnLog', 'saveWarnState', 'sendEclipseMenu', 'sendMenuBanner', 'sendMenuPoll', 'sendRuinMenu', 'tttArmDeadGame', 'tttArmTimer', 'tttClearTimer', 'tttCollectIds', 'tttDeletePoll', 'tttDeleteVotedPoll', 'tttKey', 'tttOpenLobby', 'tttPaint', 'tttResolveLabel', 'tttSamePlayer', 'tttStart', 'tttTryMove']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createMenuVoteService: missing required dependency: ${name}`);
        }
    }
    for (const name of ['antiConfigSessions', 'autoreactSessions', 'helpPersonaPollKeys', 'personaPollKeys', 'tttGames', 'tttSetupSessions', 'warnConfigSessions', 'welcomeGoodbyeSessions']) {
        if (!(deps?.[name] instanceof Map)) {
            throw new Error(`createMenuVoteService: missing required dependency: ${name} (Map)`);
        }
    }
    for (const name of ['CONFIG_MENU_PATH', 'CONFIG_MENU_TEXT', 'DOMAIN_POLL_QUESTION', 'FUN_MENU_PATH', 'FUN_PLACEHOLDER_TEXT', 'GROUP_MENU_PATH', 'GROUP_MENU_TEXT', 'OWNERS_MENU_PATH', 'OWNERS_WELCOME_TEXT', 'SYSTEM_MENU_PATH', 'SYSTEM_MENU_TEXT']) {
        if (typeof deps?.[name] !== 'string') {
            throw new Error(`createMenuVoteService: missing required dependency: ${name} (string)`);
        }
    }
    for (const name of ['DOMAIN_POLL_IDS', 'DOMAIN_POLL_OPTIONS']) {
        if (!Array.isArray(deps?.[name])) {
            throw new Error(`createMenuVoteService: missing required dependency: ${name} (array)`);
        }
    }
    const {
        applyWardEndpoint,
        buildBugMenuText,
        buildOmegaTerminal,
        buildRuinCommandIndexBox,
        buildRuinConfigMenu,
        buildRuinFunMenu,
        buildRuinGroupMenu,
        buildRuinSystemMenu,
        delay,
        deleteMenuMessages,
        ensureWarnGroup,
        getAntideleteState,
        getTttGame,
        getWarnState,
        handleGameVote,
        listAntideleteEndpoints,
        loadBotConfig,
        loadBotMode,
        loadWarnLog,
        log,
        logError,
        offerGroupPickPoll,
        recordMenuMessage,
        safeWaReply,
        saveBotConfig,
        saveWarnLog,
        saveWarnState,
        sendEclipseMenu,
        sendMenuBanner,
        sendMenuPoll,
        sendRuinMenu,
        tttArmDeadGame,
        tttArmTimer,
        tttClearTimer,
        tttCollectIds,
        tttDeletePoll,
        tttDeleteVotedPoll,
        tttKey,
        tttOpenLobby,
        tttPaint,
        tttResolveLabel,
        tttSamePlayer,
        tttStart,
        tttTryMove,
        antiConfigSessions,
        autoreactSessions,
        helpPersonaPollKeys,
        personaPollKeys,
        tttGames,
        tttSetupSessions,
        warnConfigSessions,
        welcomeGoodbyeSessions,
        CONFIG_MENU_PATH,
        CONFIG_MENU_TEXT,
        DOMAIN_POLL_IDS,
        DOMAIN_POLL_OPTIONS,
        DOMAIN_POLL_QUESTION,
        FUN_MENU_PATH,
        FUN_PLACEHOLDER_TEXT,
        GROUP_MENU_PATH,
        GROUP_MENU_TEXT,
        OWNERS_MENU_PATH,
        OWNERS_WELCOME_TEXT,
        SYSTEM_MENU_PATH,
        SYSTEM_MENU_TEXT
    } = deps;

    async function handleMenuVote(sock, remoteJid, phoneNumber, votedOptionId, pollId = '', voterJid = 'me') {
        log('POLL-MENU', `${phoneNumber}: handling vote -> ${votedOptionId} for ${remoteJid}`);
        const replyKey = `${pollId}:${voterJid}`;
        try {
            // Delete the previous menu reply (image + caption, and for owners the
            // domain poll too) when the user changes their vote.
            await deleteMenuMessages(sock, replyKey);
            if (pollId && /^(ar_|ad_|wn_|wg_|greet_)/.test(String(votedOptionId || ''))) {
                await tttDeleteVotedPoll(sock, remoteJid, pollId);
            }

            switch (votedOptionId) {
                case 'persona_eclipse':
                case 'persona_ruin': {
                    // 🎭 First-pair persona pick: delete the poll, save the choice,
                    // then show the chosen persona's menu.
                    try {
                        const pkey = personaPollKeys.get(phoneNumber);
                        if (pkey?.id) {
                            try {
                                await sock.sendMessage(remoteJid, { delete: { remoteJid: pkey.remoteJid || remoteJid, id: pkey.id, fromMe: true } });
                            } catch (_) {}
                        }
                        if (pollId) await tttDeleteVotedPoll(sock, remoteJid, pollId);
                        personaPollKeys.delete(phoneNumber);
                    } catch (_) {}

                    const persona = votedOptionId === 'persona_eclipse' ? 'eclipse' : 'ruin';
                    const bc = loadBotConfig(phoneNumber);
                    bc.persona = persona;
                    saveBotConfig(phoneNumber, bc);
                    log('PERSONA', `${phoneNumber}: persona bound -> ${persona.toUpperCase()} (persisted in bot_config.json)`);

                    await sock.sendMessage(remoteJid, {
                        text: `𖣘 *PERSONA BOUND* :: ${persona.toUpperCase()}\n\n` +
                            (persona === 'ruin'
                                ? `   clean minimal interface armed.\n   type .menu to see it.`
                                : `   cinematic terminal armed.\n   type .menu to see it.`)
                    }).catch(() => {});

                    if (persona === 'ruin') {
                        try { await sendRuinMenu(sock, remoteJid, phoneNumber); }
                        catch (err) { logError('PERSONA', `${phoneNumber}: ruin menu failed`, err); }
                    } else {
                        try { await sendEclipseMenu(sock, remoteJid, phoneNumber); }
                        catch (err) { logError('PERSONA', `${phoneNumber}: eclipse menu failed`, err); }
                    }
                    break;
                }
                case 'rm_all': {
                    const k = await sock.sendMessage(remoteJid, { text: buildRuinCommandIndexBox(phoneNumber) });
                    if (k?.key) recordMenuMessage(replyKey, k.key);
                    break;
                }
                case 'rm_system': {
                    const k = await sock.sendMessage(remoteJid, { text: buildRuinSystemMenu(phoneNumber) });
                    if (k?.key) recordMenuMessage(replyKey, k.key);
                    break;
                }
                case 'rm_config': {
                    const k = await sock.sendMessage(remoteJid, { text: buildRuinConfigMenu(phoneNumber) });
                    if (k?.key) recordMenuMessage(replyKey, k.key);
                    break;
                }
                case 'rm_group': {
                    const k = await sock.sendMessage(remoteJid, { text: buildRuinGroupMenu(phoneNumber) });
                    if (k?.key) recordMenuMessage(replyKey, k.key);
                    break;
                }
                case 'rm_fun': {
                    const k = await sock.sendMessage(remoteJid, { text: buildRuinFunMenu(phoneNumber) });
                    if (k?.key) recordMenuMessage(replyKey, k.key);
                    break;
                }
                case 'helpp_eclipse':
                case 'helpp_ruin': {
                    // 🛎 First-.help persona pick: delete the poll, save the voice,
                    // confirm. Saved forever — the poll never shows again.
                    try {
                        const hpKey = helpPersonaPollKeys.get(phoneNumber);
                        if (hpKey?.id) {
                            try {
                                await sock.sendMessage(remoteJid, { delete: { remoteJid: hpKey.remoteJid || remoteJid, id: hpKey.id, fromMe: true } });
                            } catch (_) {}
                        }
                        if (pollId) await tttDeleteVotedPoll(sock, remoteJid, pollId);
                        helpPersonaPollKeys.delete(phoneNumber);
                    } catch (_) {}

                    const hp = votedOptionId === 'helpp_eclipse' ? 'eclipse' : 'ruin';
                    const bc = loadBotConfig(phoneNumber);
                    bc.helpPersona = hp;
                    saveBotConfig(phoneNumber, bc);
                    log('HELPP', `${phoneNumber}: help persona bound -> ${hp.toUpperCase()} (persisted in bot_config.json)`);

                    await sock.sendMessage(remoteJid, {
                        text: hp === 'ruin'
                            ? `🛎 *HELP PERSONA BOUND* :: RUIN\n\n` +
                              `friendly support armed.\n` +
                              `type .help <question> — and talk\n` +
                              `to me like a human. 🙂`
                            : `🌑 *HELP PERSONA BOUND* :: ECLIPSE\n\n` +
                              `cinematic oracle armed.\n` +
                              `type .help <question>.`
                    }).catch(() => {});
                    break;
                }
                case 'ttt_vs_bot': {
                    await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    const sess = tttSetupSessions.get(phoneNumber) || { chat: remoteJid, host: sock.user?.id };
                    if (voterJid && voterJid !== 'me' && sess.host && !tttSamePlayer(voterJid, sess.host) && !tttSamePlayer(voterJid, sock.user?.id)) {
                        break;
                    }
                    tttSetupSessions.set(phoneNumber, { ...sess, step: 'diff', chat: remoteJid });
                    const diffPoll = await sendMenuPoll(sock, remoteJid, phoneNumber, 'VOID LEVEL', ['Easy', 'Medium', 'Hard'], ['ttt_easy', 'ttt_med', 'ttt_hard']);
                    sess.diffPollKey = diffPoll?.key || null;
                    tttSetupSessions.set(phoneNumber, { ...sess, step: 'diff', chat: remoteJid, diffPollKey: diffPoll?.key || null });
                    break;
                }
                case 'ttt_vs_p': {
                    await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    const sess = tttSetupSessions.get(phoneNumber) || { chat: remoteJid, host: sock.user?.id };
                    const host = sess.host || sock.user?.id;
                    if (voterJid && voterJid !== 'me' && sess.host && !tttSamePlayer(voterJid, sess.host) && !tttSamePlayer(voterJid, sock.user?.id)) {
                        break;
                    }
                    tttSetupSessions.delete(phoneNumber);
                    await tttOpenLobby(sock, phoneNumber, remoteJid, host);
                    break;
                }
                case 'ttt_easy':
                case 'ttt_med':
                case 'ttt_hard': {
                    await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    const sess = tttSetupSessions.get(phoneNumber) || {};
                    const host = sess.host || sock.user?.id;
                    if (voterJid && voterJid !== 'me' && sess.host && !tttSamePlayer(voterJid, sess.host) && !tttSamePlayer(voterJid, sock.user?.id)) {
                        break;
                    }
                    const diff = votedOptionId === 'ttt_easy' ? 'easy' : votedOptionId === 'ttt_hard' ? 'hard' : 'medium';
                    tttSetupSessions.delete(phoneNumber);
                    await tttStart(sock, phoneNumber, remoteJid, {
                        x: host,
                        o: 'BOT',
                        vsBot: true,
                        difficulty: diff,
                        xLabel: sess.hostLabel || await tttResolveLabel(sock, phoneNumber, host, null),
                        oLabel: 'VOID',
                        xIds: sess.hostIds || tttCollectIds(sock, phoneNumber, host, null)
                    });
                    break;
                }
                case 'ttt_yes': {
                    await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    const game = getTttGame(phoneNumber, remoteJid);
                    if (!game || game.status !== 'pending') { await sock.sendMessage(remoteJid, { text: '❌ No open seat.' }); break; }
                    const voter = voterJid === 'me' ? sock.user?.id : voterJid;
                    if (game.openSeat) {
                        if (tttSamePlayer(voter, game.x)) {
                            await sock.sendMessage(remoteJid, { text: '❌ You already host this grid. Wait for a rival.' });
                            break;
                        }
                        game.o = voter;
                        game.oLabel = await tttResolveLabel(sock, phoneNumber, voter, null);
                        game.oIds = tttCollectIds(sock, phoneNumber, voter, null);
                        game.openSeat = false;
                    } else if (!tttSamePlayer(voter, game.o)) {
                        await sock.sendMessage(remoteJid, { text: '❌ This invite is sealed. Only the tagged rival may sit.' });
                        break;
                    }
                    game.status = 'active';
                    tttClearTimer(game);
                    game.boardKey = null;
                    await tttDeletePoll(sock, game);
                    await tttPaint(sock, phoneNumber, game);
                    tttArmTimer(sock, phoneNumber, game);
                    tttArmDeadGame(sock, phoneNumber, game);
                    break;
                }
                case 'ttt_no': {
                    await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    const game = getTttGame(phoneNumber, remoteJid);
                    if (!game || game.status !== 'pending') break;
                    const voter = voterJid === 'me' ? sock.user?.id : voterJid;
                    const canCancel = tttSamePlayer(voter, game.x) || tttSamePlayer(voter, game.o) || tttSamePlayer(voter, sock.user?.id);
                    if (!canCancel) break;
                    tttClearTimer(game);
                    await tttDeletePoll(sock, game);
                    tttGames.delete(tttKey(phoneNumber, remoteJid));
                    await sock.sendMessage(remoteJid, { text: '🕊 Seat cancelled. The grid sleeps.' });
                    break;
                }
                case 'ttt_again': {
                    const game = getTttGame(phoneNumber, remoteJid);
                    if (!game) { await sock.sendMessage(remoteJid, { text: '❌ No arena to rematch. *.ttt*' }); break; }
                    await tttStart(sock, phoneNumber, remoteJid, {
                        x: game.x, o: game.o, vsBot: game.vsBot, difficulty: game.difficulty || 'medium',
                        xLabel: game.xLabel, oLabel: game.oLabel, xIds: game.xIds || [], oIds: game.oIds || []
                    });
                    break;
                }
                case 'ttt_close': {
                    const game = getTttGame(phoneNumber, remoteJid);
                    if (game) { tttClearTimer(game); await tttDeletePoll(sock, game); }
                    tttGames.delete(tttKey(phoneNumber, remoteJid));
                    await sock.sendMessage(remoteJid, { text: buildOmegaTerminal(`   ✦ *ARENA_CLOSED*\n\n   " The grid forgets. "`) });
                    break;
                }
                case 'owners': {
                    const k1 = await sendMenuBanner(sock, remoteJid, OWNERS_MENU_PATH, OWNERS_WELCOME_TEXT);
                    if (k1) recordMenuMessage(replyKey, k1);
                    await delay(400);
                    const pollMsg = await sendMenuPoll(sock, remoteJid, phoneNumber, DOMAIN_POLL_QUESTION, DOMAIN_POLL_OPTIONS, DOMAIN_POLL_IDS);
                    if (pollMsg?.key) recordMenuMessage(replyKey, pollMsg.key);
                    break;
                }
                case 'group': {
                    const k = await sendMenuBanner(sock, remoteJid, GROUP_MENU_PATH, GROUP_MENU_TEXT);
                    if (k) recordMenuMessage(replyKey, k);
                    break;
                }
                case 'fun': {
                    const k = await sendMenuBanner(sock, remoteJid, FUN_MENU_PATH, FUN_PLACEHOLDER_TEXT);
                    if (k) recordMenuMessage(replyKey, k);
                    break;
                }
                case 'bug': {
                    // Same reply as the .bugmenu command — the shared builder
                    // keeps command list and poll vote perfectly in sync.
                    const bugPrefix = String(loadBotConfig(phoneNumber)?.prefix || '.');
                    const sent = await sock.sendMessage(remoteJid, { text: buildBugMenuText(bugPrefix, loadBotMode(phoneNumber)) });
                    if (sent?.key) recordMenuMessage(replyKey, sent.key);
                    break;
                }
                case 'system': {
                    const k = await sendMenuBanner(sock, remoteJid, SYSTEM_MENU_PATH, SYSTEM_MENU_TEXT);
                    if (k) recordMenuMessage(replyKey, k);
                    break;
                }
                case 'config': {
                    const k = await sendMenuBanner(sock, remoteJid, CONFIG_MENU_PATH, CONFIG_MENU_TEXT);
                    if (k) recordMenuMessage(replyKey, k);
                    break;
                }
                case 'ar_add': {
                    // Autoreact: choose endpoint category
                    autoreactSessions.set(phoneNumber, { step: 'category' });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *ENDPOINT_CATEGORY* █▓▒░\n\n` +
                        `   Which type of endpoint do\n` +
                        `   you want to auto-react to?`
                    ));
                    await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ ENDPOINT TYPE ✦', ['👥 Group', '📢 Channel', '👤 Contact'], ['ar_cat_group', 'ar_cat_channel', 'ar_cat_contact']);
                    break;
                }
                case 'ar_delete': {
                    // Autoreact: list endpoints with indices for deletion via .del
                    const cfg = loadBotConfig(phoneNumber).autoreact || { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
                    const g = cfg.endpoints?.groups || [], c = cfg.endpoints?.channels || [], ct = cfg.endpoints?.contacts || [];
                    let n = 1, list = '';
                    if (g.length) { list += `  ─ *GROUPS* ─\n`; for (const e of g) list += `   [${n++}] ${e}\n`; }
                    if (c.length) { list += `  ─ *CHANNELS* ─\n`; for (const e of c) list += `   [${n++}] ${e}\n`; }
                    if (ct.length) { list += `  ─ *CONTACTS* ─\n`; for (const e of ct) list += `   [${n++}] ${e}\n`; }
                    if (!n) list = '   _no endpoints yet_';
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *ENDPOINTS* █▓▒░\n\n` +
                        `${list}\n\n` +
                        `   Delete by index: *_.del 2 5 6 9_*`
                    ));
                    autoreactSessions.set(phoneNumber, { step: 'delete' });
                    break;
                }
                case 'ar_cat_group':
                case 'ar_cat_channel':
                case 'ar_cat_contact': {
                    const type = votedOptionId.replace('ar_cat_','');
                    const cfg = loadBotConfig(phoneNumber).autoreact || { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
                    if (type === 'contact') {
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *CONTACT_ENDPOINT* █▓▒░\n\n` +
                            `   Send the phone number you want\n` +
                            `   auto-reacted. All messages from it\n` +
                            `   will be reacted to.\n\n` +
                            `   (or type *.cancel* to exit)`
                        ));
                        autoreactSessions.set(phoneNumber, { step: 'awaiting_contact' });
                    } else if (type === 'group') {
                        await offerGroupPickPoll(sock, remoteJid, phoneNumber, 'ar', 'Choose a group to auto-react.');
                    } else if (type === 'channel') {
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   📢 *CHANNEL_ENDPOINT*\n\n` +
                            `   Reply to this (or the poll) with\n` +
                            `   a channel link or ID.\n` +
                            `   I will follow it if I am not in.\n\n` +
                            `   or type *.cancel*`
                        ));
                        autoreactSessions.set(phoneNumber, { step: 'awaiting_ref', ward: 'ar', endpoint: 'channel', chat: remoteJid });
                    }
                    break;
                }
                case 'greet_welcome':
                case 'greet_goodbye': {
                    const gsess = welcomeGoodbyeSessions.get(phoneNumber);
                    const gtype = votedOptionId === 'greet_welcome' ? 'welcome' : 'goodbye';
                    welcomeGoodbyeSessions.set(phoneNumber, { step: 'action', type: gtype, group: gsess?.group || remoteJid });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *THRESHOLD_MATRIX* █▓▒░\n\n` +
                        `   Configure the ${gtype}\n` +
                        `   message for this group.`
                    ));
                    await sendMenuPoll(sock, remoteJid, phoneNumber, gtype === 'welcome' ? '✦ WELCOME MATRIX ✦' : '✦ GOODBYE MATRIX ✦', ['📝 Custom Message', '🎯 Default Message', '🚫 Disable'], gtype === 'welcome' ? ['wg_wel_custom','wg_wel_default','wg_wel_off'] : ['wg_gb_custom','wg_gb_default','wg_gb_off']);
                    break;
                }
                case 'wg_wel_custom':
                case 'wg_gb_custom':
                case 'wg_wel_default':
                case 'wg_gb_default':
                case 'wg_wel_off':
                case 'wg_gb_off': {
                    const sess = welcomeGoodbyeSessions.get(phoneNumber);
                    const type = sess?.type || (votedOptionId.includes('wel') ? 'welcome' : 'goodbye');
                    const group = sess?.group || remoteJid;
                    const isWel = type === 'welcome';
                    const cfg = loadBotConfig(phoneNumber);
                    cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'] = cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'] || {};
                    if (votedOptionId.endsWith('_off')) {
                        cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'][group] = 'off';
                        saveBotConfig(phoneNumber, cfg);
                        welcomeGoodbyeSessions.delete(phoneNumber);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ✦ *${isWel ? 'WELCOME' : 'GOODBYE'}* :: DISABLED\n\n   " The threshold falls\n     silent. "`
                        ));
                    } else if (votedOptionId.endsWith('_default')) {
                        cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'][group] = 'default';
                        saveBotConfig(phoneNumber, cfg);
                        welcomeGoodbyeSessions.delete(phoneNumber);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ✦ *${isWel ? 'WELCOME' : 'GOODBYE'}* :: DEFAULT\n\n   " The standard words\n     are restored. "`
                        ));
                    } else {
                        // custom -> ask for the message text
                        welcomeGoodbyeSessions.set(phoneNumber, { step: 'custom_text', type, group });
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ✦ *CUSTOM ${isWel ? 'WELCOME' : 'GOODBYE'}*\n\n` +
                            `   Send the ${isWel ? 'welcome' : 'goodbye'} message now.\n` +
                            `   (use *{{name}}* for the member's name)\n\n` +
                            `   or type *.cancel* to exit`
                        ));
                    }
                    break;
                }
                case 'wn_add':
                case 'wn_cfg':
                case 'wn_remove': {
                    const mode = votedOptionId === 'wn_add' ? 'add' : votedOptionId === 'wn_cfg' ? 'cfg' : 'remove';
                    let names = [];
                    let jids = [];
                    try {
                        const g = await sock.groupFetchAllParticipating();
                        if (mode === 'add') {
                            for (const [id, v] of Object.entries(g)) {
                                names.push(v.subject || id);
                                jids.push(id);
                            }
                        } else {
                            const warn = getWarnState(phoneNumber);
                            for (const id of Object.keys(warn.groups || {})) {
                                names.push(g[id]?.subject || id);
                                jids.push(id);
                            }
                        }
                    } catch (_) {}
                    names = names.slice(0, 10);
                    jids = jids.slice(0, 10);
                    if (!names.length) {
                        await safeWaReply(sock, remoteJid, mode === 'add' ? '❌ No groups found.' : '❌ No warn groups configured yet. Use Add Group first.');
                        break;
                    }
                    const prefixId = mode === 'add' ? 'wn_agrp_' : mode === 'cfg' ? 'wn_cgrp_' : 'wn_rgrp_';
                    warnConfigSessions.set(phoneNumber, { step: mode, groups: names, jids });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        mode === 'add' ? `   Choose a group to put under the warn ward:` :
                        mode === 'cfg' ? `   Choose which group's law to reshape:` :
                        `   Choose a group to release from the ward:`
                    ));
                    await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ SELECT GROUP ✦', names, names.map((_, i) => prefixId + i));
                    break;
                }
                case 'wn_limit':
                case 'wn_action':
                case 'wn_phrases':
                case 'wn_resetall':
                case 'wn_on':
                case 'wn_off':
                case 'wn_kick':
                case 'wn_none':
                case 'wn_ph_add':
                case 'wn_ph_del':
                case 'wn_ph_list': {
                    const sess = warnConfigSessions.get(phoneNumber);
                    const group = sess?.group;
                    if (!group) { await safeWaReply(sock, remoteJid, '❌ Warn session expired. Use .warnconfig again.'); break; }
                    if (votedOptionId === 'wn_limit') {
                        warnConfigSessions.set(phoneNumber, { step: 'awaiting_limit', group });
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *WARN_LIMIT* █▓▒░\n\n` +
                            `   Send how many warns before kick.\n` +
                            `   Use *0* to never kick.\n\n` +
                            `   (or type *.cancel*)`
                        ));
                        break;
                    }
                    if (votedOptionId === 'wn_action') {
                        await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ WARN ACTION ✦', ['👢 Kick on limit', '📋 Warn only (no kick)'], ['wn_kick', 'wn_none']);
                        break;
                    }
                    if (votedOptionId === 'wn_kick' || votedOptionId === 'wn_none') {
                        const action = votedOptionId === 'wn_none' ? 'none' : 'kick';
                        ensureWarnGroup(phoneNumber, group, { action });
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *WARN_ACTION* █▓▒░\n\n` +
                            `   ✦ *ACTION* :: ${action === 'none' ? 'WARN_ONLY' : 'KICK'}\n\n` +
                            `   " The sentence is set. "`
                        ));
                        break;
                    }
                    if (votedOptionId === 'wn_on' || votedOptionId === 'wn_off') {
                        ensureWarnGroup(phoneNumber, group, { enabled: votedOptionId === 'wn_on' });
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *PHRASE_WARD* █▓▒░\n\n` +
                            `   ✦ *STATE* :: ${votedOptionId === 'wn_on' ? 'ARMED' : 'IDLE'}\n\n` +
                            `   Auto-warn on listed phrases is\n   now ${votedOptionId === 'wn_on' ? 'watching' : 'silent'}.`
                        ));
                        break;
                    }
                    if (votedOptionId === 'wn_resetall') {
                        const log = loadWarnLog(phoneNumber);
                        delete log[group];
                        saveWarnLog(phoneNumber, log);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *LEDGER_BURNED* █▓▒░\n\n` +
                            `   All strikes in this group\n   have been wiped.`
                        ));
                        break;
                    }
                    if (votedOptionId === 'wn_phrases') {
                        await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ PHRASE WARD ✦', ['➕ Add Phrase', '🗑️ Delete Phrase', '📜 List Phrases'], ['wn_ph_add', 'wn_ph_del', 'wn_ph_list']);
                        break;
                    }
                    if (votedOptionId === 'wn_ph_add') {
                        warnConfigSessions.set(phoneNumber, { step: 'awaiting_phrase', group });
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *BIND_PHRASE* █▓▒░\n\n` +
                            `   Send the word or phrase.\n` +
                            `   Example: see   or   send nudes\n\n` +
                            `   Anyone who sends it is warned.\n` +
                            `   (or type *.cancel*)`
                        ));
                        break;
                    }
                    if (votedOptionId === 'wn_ph_list' || votedOptionId === 'wn_ph_del') {
                        const phrases = ensureWarnGroup(phoneNumber, group).phrases || [];
                        const list = phrases.length ? phrases.map((p, i) => `   [${i + 1}] ${p}`).join('\n') : '   _none bound_';
                        if (votedOptionId === 'wn_ph_del') {
                            warnConfigSessions.set(phoneNumber, { step: 'delete', group, phrases });
                            antiConfigSessions.delete(phoneNumber);
                            autoreactSessions.delete(phoneNumber);
                            await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                                `   ░▒▓█ *PHRASE_LIST* █▓▒░\n\n${list}\n\n` +
                                `   Delete by index: *_.del 1 3_*`
                            ));
                        } else {
                            await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                                `   ░▒▓█ *PHRASE_LIST* █▓▒░\n\n${list}`
                            ));
                        }
                        break;
                    }
                    break;
                }
                case 'ad_add': {
                    antiConfigSessions.set(phoneNumber, { step: 'category' });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *ENDPOINT_CATEGORY* █▓▒░\n\n` +
                        `   Which type of endpoint do\n` +
                        `   you want anti-delete on?`
                    ));
                    await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ ENDPOINT TYPE ✦', ['👥 Group', '📢 Channel', '👤 Contact'], ['ad_cat_group', 'ad_cat_channel', 'ad_cat_contact']);
                    break;
                }
                case 'ad_delete': {
                    const ad = getAntideleteState(phoneNumber);
                    const { list } = listAntideleteEndpoints(ad);
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *ANTIDELETE_ENDPOINTS* █▓▒░\n\n` +
                        `${list}\n\n` +
                        `   Delete by index: *_.del 2 5 6 9_*`
                    ));
                    antiConfigSessions.set(phoneNumber, { step: 'delete' });
                    autoreactSessions.delete(phoneNumber);
                    break;
                }
                case 'ad_cat_group':
                case 'ad_cat_channel':
                case 'ad_cat_contact': {
                    const type = votedOptionId.replace('ad_cat_', '');
                    if (type === 'contact') {
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *CONTACT_ENDPOINT* █▓▒░\n\n` +
                            `   Send the phone number you want\n` +
                            `   watched. Deleted msgs from that\n` +
                            `   chat will be forwarded to you.\n\n` +
                            `   (or type *.cancel* to exit)`
                        ));
                        antiConfigSessions.set(phoneNumber, { step: 'awaiting_contact' });
                    } else if (type === 'group') {
                        await offerGroupPickPoll(sock, remoteJid, phoneNumber, 'ad', 'Choose a group to watch for deletions.');
                    } else if (type === 'channel') {
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   📢 *CHANNEL_ENDPOINT*\n\n` +
                            `   Reply to this (or the poll) with\n` +
                            `   a channel link or ID.\n` +
                            `   I will follow it if I am not in.\n\n` +
                            `   or type *.cancel*`
                        ));
                        antiConfigSessions.set(phoneNumber, { step: 'awaiting_ref', ward: 'ad', endpoint: 'channel', chat: remoteJid });
                    }
                    break;
                }
                default:
                    if (await handleGameVote({ sock, remoteJid, phoneNumber, votedOptionId, pollId, voterJid })) {
                        break;
                    }
                    if (votedOptionId?.startsWith('ttt_m')) {
                        const idx = parseInt(String(votedOptionId).replace('ttt_m', ''), 10) - 1;
                        await tttTryMove(sock, phoneNumber, remoteJid, voterJid, idx);
                        break;
                    }
                    if (votedOptionId?.startsWith('wn_agrp_') || votedOptionId?.startsWith('wn_cgrp_') || votedOptionId?.startsWith('wn_rgrp_')) {
                        const kind = votedOptionId.startsWith('wn_agrp_') ? 'add' : votedOptionId.startsWith('wn_cgrp_') ? 'cfg' : 'remove';
                        const idx = parseInt(votedOptionId.replace(/wn_[acr]grp_/, ''), 10);
                        const sess = warnConfigSessions.get(phoneNumber);
                        const jid = sess?.jids?.[idx];
                        const name = sess?.groups?.[idx] || jid;
                        if (!jid) { await safeWaReply(sock, remoteJid, '❌ Could not resolve that group.'); break; }
                        if (kind === 'remove') {
                            const warn = getWarnState(phoneNumber);
                            delete warn.groups[jid];
                            saveWarnState(phoneNumber, warn);
                            const wlog = loadWarnLog(phoneNumber);
                            delete wlog[jid];
                            saveWarnLog(phoneNumber, wlog);
                            warnConfigSessions.delete(phoneNumber);
                            await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                                `   ░▒▓█ *WARD_RELEASED* █▓▒░\n\n` +
                                `   ✦ *GROUP* :: ${name}\n\n` +
                                `   " The law no longer\n     watches this hall. "`
                            ));
                            break;
                        }
                        if (kind === 'add') ensureWarnGroup(phoneNumber, jid, { enabled: true });
                        warnConfigSessions.set(phoneNumber, { step: 'matrix', group: jid });
                        const gcfg = ensureWarnGroup(phoneNumber, jid);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *WARN_LAW* █▓▒░\n\n` +
                            `   ✦ *GROUP* :: ${name}\n` +
                            `   ✦ *STATE* :: ${gcfg.enabled ? 'ARMED' : 'IDLE'}\n` +
                            `   ✦ *MAX* :: ${gcfg.maxWarns === 0 ? '∞' : gcfg.maxWarns}\n` +
                            `   ✦ *ACTION* :: ${gcfg.action.toUpperCase()}\n` +
                            `   ✦ *PHRASES* :: ${gcfg.phrases.length}\n\n` +
                            `   Shape the law below.`
                        ));
                        await sendMenuPoll(
                            sock, remoteJid, phoneNumber, '✦ WARN LAW ✦',
                            ['📊 Set Limit', '⚖️ Set Action', '📝 Phrases', '✅ Arm Phrases', '🚫 Disarm Phrases', '🔄 Reset Warns'],
                            ['wn_limit', 'wn_action', 'wn_phrases', 'wn_on', 'wn_off', 'wn_resetall']
                        );
                        break;
                    }
                    if (votedOptionId === 'ad_grp_paste' || votedOptionId === 'ar_grp_paste') {
                        const ward = votedOptionId.startsWith('ad') ? 'ad' : 'ar';
                        const map = ward === 'ad' ? antiConfigSessions : autoreactSessions;
                        map.set(phoneNumber, { ...(map.get(phoneNumber) || {}), step: 'awaiting_ref', ward, endpoint: 'group', chat: remoteJid });
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ✦ *PASTE LINK OR ID*\n\n` +
                            `   Reply with a group invite\n` +
                            `   (chat.whatsapp.com/…) or a group ID.\n` +
                            `   If I am not inside I will join.\n\n` +
                            `   or type *.cancel*`
                        ));
                        break;
                    }
                    if (votedOptionId?.startsWith('ad_grp_') || votedOptionId?.startsWith('ar_grp_')) {
                        const ward = votedOptionId.startsWith('ad') ? 'ad' : 'ar';
                        const sess = (ward === 'ad' ? antiConfigSessions : autoreactSessions).get(phoneNumber);
                        const idx = parseInt(String(votedOptionId).replace(/a[rd]_grp_/, ''), 10);
                        const row = sess?.rows?.[idx];
                        const jid = row?.id;
                        const name = row?.name || jid;
                        if (!jid) { await safeWaReply(sock, remoteJid, '❌ Could not resolve that group.'); break; }
                        applyWardEndpoint(phoneNumber, ward, 'group', jid);
                        (ward === 'ad' ? antiConfigSessions : autoreactSessions).delete(phoneNumber);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                            `   ✦ *TYPE* :: GROUP\n` +
                            `   ✦ *TARGET* :: ${name}\n\n` +
                            (ward === 'ad'
                                ? `   Anti-delete is watching this group.\n   Arm it with *.antidelete on* if needed.`
                                : `   Auto-react is watching this group.\n   Arm it with *.autoreact on* if needed.`)
                        ));
                        break;
                    }
                    log('POLL-MENU', `${phoneNumber}: unhandled vote id ${votedOptionId}`);
                    break;
            }
        } catch (err) {
            logError('POLL-MENU', `${phoneNumber}: failed handling menu vote ${votedOptionId}`, err);
        }
    }

    return Object.freeze({ handleMenuVote });
}
