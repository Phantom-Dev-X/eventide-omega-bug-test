// 🛠️ Dev helpers — dev identity checks for Telegram and WhatsApp, extracted
// from index.js unchanged. `isDev` gates Telegram admin commands against the
// DEV_IDS list from the environment config (empty list = everyone is a dev,
// matching the upstream behaviour); `isDevNumber` reads DEV_NUMBERS from the
// process env at call time (comma-separated raw numbers, matched against the
// digits of the given jid); `countSystemCommands` reports the size of the
// known-commands list for .cmdstats/.botinfo.
export function createDevHelpers(deps) {
    if (!Array.isArray(deps?.devIds)) {
        throw new Error('createDevHelpers: missing required dependency: devIds (array)');
    }
    const { devIds } = deps;

    function isDev(chatId) {
        if (devIds.length === 0) return true;
        return devIds.includes(Number(chatId));
    }

    // Dev numbers come from the RENDER env var DEV_NUMBERS (comma-separated).
    // Returns true if the given jid (or raw number) belongs to a dev.
    // Count the number of registered dot-commands (for .cmdstats/.botinfo).
    function countSystemCommands() {
        const known = [
            'menu','help','ping','uptime','runtime','info','status','version','os','botinfo','alive','dev','gpp','ggpp','profile',
            'listgc','session','sessions','logout','reconnect','sticker','toimg','vv','viewonce','qr','calc','base64','block','unblock',
            'cmdstats','restart','shutdown','autoreact','mode','public','owner','setprefix','setalias','delalias',
            'aliases','setname','setbio','setpp','settings','reset','join','add','kick','link','autoreactconfig','antidelete','antideleteconfig','del','hidetag','ht','warn','unwarn','warns','warnconfig','warnreset','ttt','tictactoe','xo','games','rps','roll'
        ];
        return known.length;
    }

    function isDevNumber(jid) {
        const raw = process.env.DEV_NUMBERS || '';
        const devs = raw.split(',').map(s => s.replace(/\D/g, '').trim()).filter(Boolean);
        if (!devs.length) return false;
        const num = String(jid || '').split(':')[0].split('@')[0].replace(/\D/g, '');
        return devs.includes(num);
    }

    return Object.freeze({ isDev, isDevNumber, countSystemCommands });
}
