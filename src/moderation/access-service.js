// 🛡️ Access rights — the sudo system and poll-voting rights gate,
// extracted from index.js unchanged. `normalizeDigits` is the shared phone-
// digit normalizer; `isSudo` checks a JID against the per-session sudo list
// saved in bot_config.json (persisted via Supabase on Render and on disk for
// the panel — sudoes can command the bot even in owner mode); and
// `canVoteOnPoll` decides who may vote on which poll the bot sent:
// owner → everything, sudo → menu + game polls but never bot-self config
// polls (persona_/helpp_/ar_/ad_/wn_/wg_/greet_), everyone else → only
// game/ttt polls.
export function createAccessService(deps) {
    for (const name of ['loadBotConfig', 'isGamePoll']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createAccessService: missing required dependency: ${name}`);
        }
    }
    const { loadBotConfig, isGamePoll } = deps;

    // 🛡️ SUDO SYSTEM — elevated users per session. Saved in bot_config.json so
    // they persist via Supabase on Render and on disk for the panel. Sudoes can
    // command the bot even when the bot is in owner mode.
    function normalizeDigits(s) {
        return String(s || '').replace(/\D/g, '');
    }

    function isSudo(phoneNumber, jid) {
        const sudos = loadBotConfig(phoneNumber).sudos || [];
        if (!Array.isArray(sudos) || !sudos.length) return false;
        const num = normalizeDigits(String(jid || '').split(':')[0].split('@')[0]);
        return !!num && sudos.some(s => normalizeDigits(s) === num);
    }

    // 🛡️ POLL VOTING RIGHTS — who may vote on which poll the bot sent:
    //   • owner → everything
    //   • sudo → menu + game polls (they can navigate the bot) but NEVER
    //     bot-self config polls (persona_/helpp_/ar_/ad_/wn_/wg_/greet_ —
    //     those change the bot itself and stay owner-only)
    //   • everyone else → only game/ttt polls
    function canVoteOnPoll(phoneNumber, uniqVoters, ids, ownerJids) {
        const voters = Array.isArray(uniqVoters) ? uniqVoters : [];
        const list = Array.isArray(ids) ? ids : [];
        if (voters.some(v => ownerJids.includes(v))) return true;
        const isSudoVote = voters.some(v => isSudo(phoneNumber, v));
        const isConfigPoll = list.some(id => /^(persona_|helpp_|ar_|ad_|wn_|wg_|greet_)/.test(String(id)));
        if (isConfigPoll) return false; // bot-self settings: owner only, not even sudoes
        const isMenuPoll = list.some(id => /^(rm_|owners|group|fun|bug|system|config)/.test(String(id)));
        if (isMenuPoll) return isSudoVote; // menu navigation: owner + sudoes
        const isTttPoll = list.some(id => String(id).startsWith('ttt_'));
        const isArenaPoll = isGamePoll(list);
        return isTttPoll || isArenaPoll;
    }

    return Object.freeze({
        normalizeDigits,
        isSudo,
        canVoteOnPoll
    });
}
