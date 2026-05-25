const { Client, GatewayIntentBits } = require('discord.js');
const { supabaseAdmin } = require('../db/supabase');

let client = null;

const PLAN_ROLE_ENV = {
  starter:    'DISCORD_ROLE_STARTER',
  all_access: 'DISCORD_ROLE_ALL_ACCESS',
  vip:        'DISCORD_ROLE_VIP'
};

// ── initDiscordBot ────────────────────────────────────────────────
// Call once at server startup. Non-fatal if token is missing.
function initDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token === 'your-bot-token') {
    console.log('[discord] No bot token configured — role assignment disabled.');
    return;
  }

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  client.once('ready', () => {
    console.log(`[discord] Bot online as ${client.user.tag}`);
  });

  client.on('error', err => {
    console.error('[discord] Client error:', err.message);
  });

  client.login(token).catch(err => {
    console.error('[discord] Login failed:', err.message);
    client = null;
  });
}

// ── assignDiscordRole ─────────────────────────────────────────────
// Called after a successful Stripe payment.
// Looks up the student's Discord username from their profile,
// finds them in the guild, and assigns the matching plan role.
async function assignDiscordRole(userId, planId) {
  if (!client?.isReady()) {
    console.log('[discord] Bot not ready — skipping role assignment');
    return;
  }

  const roleId  = process.env[PLAN_ROLE_ENV[planId]];
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!roleId || !guildId) {
    console.warn('[discord] Missing DISCORD_GUILD_ID or role ID for plan:', planId);
    return;
  }

  // Fetch Discord username from profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('discord_username, discord_id')
    .eq('id', userId)
    .single();

  const discordId       = profile?.discord_id;
  const discordUsername = profile?.discord_username;

  if (!discordId && !discordUsername) {
    console.log('[discord] No Discord info on profile for user:', userId);
    return;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.members.fetch(); // Cache all members

    let member;
    if (discordId) {
      member = guild.members.cache.get(discordId);
    }
    if (!member && discordUsername) {
      member = guild.members.cache.find(m =>
        m.user.username === discordUsername ||
        m.user.tag      === discordUsername
      );
    }

    if (!member) {
      console.warn(`[discord] Member not found in guild: ${discordUsername || discordId}`);
      return;
    }

    await member.roles.add(roleId);
    console.log(`[discord] Assigned role=${roleId} to ${member.user.tag} (plan=${planId})`);

  } catch (err) {
    console.error('[discord] assignDiscordRole error:', err.message);
    throw err;  // Re-thrown so caller can log
  }
}

// ── removeDiscordRole ─────────────────────────────────────────────
// Call on refund/cancellation.
async function removeDiscordRole(userId, planId) {
  if (!client?.isReady()) return;

  const roleId  = process.env[PLAN_ROLE_ENV[planId]];
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!roleId || !guildId) return;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('discord_id, discord_username')
    .eq('id', userId)
    .single();

  const discordId = profile?.discord_id;
  if (!discordId) return;

  try {
    const guild  = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) {
      await member.roles.remove(roleId);
      console.log(`[discord] Removed role=${roleId} from ${member.user.tag}`);
    }
  } catch (err) {
    console.error('[discord] removeDiscordRole error:', err.message);
  }
}

module.exports = { initDiscordBot, assignDiscordRole, removeDiscordRole };
