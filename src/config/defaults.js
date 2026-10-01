export const DEFAULT_BOT_CONFIG = Object.freeze({
    prefix: '.',
    aliases: {},
    name: '',
    bio: '',
    geminiApiKey: '',
    persona: '',
    helpPersona: '',
    sudos: [],
    lastDeployNotifiedCommit: '',
    autoreact: {
        enabled: false,
        endpoints: { groups: [], channels: [], contacts: [] }
    },
    antidelete: {
        enabled: false,
        endpoints: { groups: [], channels: [], contacts: [] }
    },
    settings: {},
    anti: {
        antilink: {},
        antimention: {},
        antiforward: {}
    }
});
