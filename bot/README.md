# Multi-server Discord bot with secure dashboard

Version 5 runs one Discord application in multiple servers. Every guild gets an
independent configuration, runtime, command whitelist, booster tracker and
reaction-role deployment file. Only the global presence remains connected to
the configured Geeked server.

## Included modules

- AutoJail through Discord audit-log events without the Server Members intent;
- one personal custom role per active booster, including solid colors,
  gradients and optional role icons;
- automatic custom-role deletion when a tracked owner stops boosting or leaves;
- Components v2 logs and public panels;
- button, dropdown or emoji reaction-role panels;
- per-server staff-role whitelist;
- Discord OAuth2 owner dashboard on GitHub Pages;
- Cloudflare Worker API and D1 storage separated by `guild_id`;
- one batched dashboard-sync request for up to 100 guilds at a time;
- Geeked-only rotating bot status.

No privileged Gateway Intent is used. Keep Server Members, Presence and Message
Content disabled in the Discord Developer Portal.

## Multi-server security model

The website requests the Discord OAuth scopes `identify guilds` and only shows
guilds where Discord reports the logged-in account as the owner. Every settings
read and write includes the selected guild ID and is checked against that owner
session. D1 uses `guild_id` as the primary key, so two servers cannot overwrite
each other's configuration.

The website remains owner-only. The owner can add up to 20 staff role IDs per
server; those roles may use `/security`, `/booster-panel`, `/booster-cleanup`
and `/reaction-role`, but they cannot enter the web dashboard.

New servers start with AutoJail, booster roles and reaction roles disabled. The
bot registers its commands but does not create booster boundary roles until the
owner enables the booster module and saves a valid role ID.

## Geeked-only presence

Set `STATUS_GUILD_ID` to Geeked's server ID. Only that runtime may start or
change the global Discord presence. Settings from every other guild are ignored
for status purposes, and the dashboard hides the status page there.

## Wispbyte

Use Node.js 22 when available. The startup command is:

```sh
cd /home/container || exit 1; /usr/local/bin/npm install --omit=dev; exec /usr/local/bin/node /home/container/src/start.js
```

Copy `.env.example` to `.env`. Existing v4 `.env` values remain a safe fallback
for the server in `GUILD_ID`; other servers are configured only through the
dashboard. `DASHBOARD_SYNC_TOKEN` must exactly match Cloudflare's
`BOT_SYNC_TOKEN` secret.

## Cloudflare Worker

Required bindings and variables:

- D1 binding `DB`;
- text `DISCORD_CLIENT_ID`;
- secret `DISCORD_CLIENT_SECRET`;
- text `FRONTEND_URL`;
- text `PUBLIC_API_ORIGIN`;
- secret `BOT_SYNC_TOKEN`;
- secret `SESSION_PEPPER`;
- text `STATUS_GUILD_ID` for Geeked.

The old `DISCORD_GUILD_ID` is accepted as a temporary status fallback. The old
`STAFF_ROLE_IDS` is read only to migrate a saved Geeked v4 document that does
not yet contain its own access list. Neither is needed for new installations.

Run `dashboard/worker/schema.sql` once in D1. Version 5 reuses the existing
schema, so an existing database does not need a destructive migration.

The Discord OAuth redirect must be:

```text
https://YOUR-WORKER.workers.dev/auth/callback
```

## Dashboard workflow

1. Sign in with Discord.
2. Choose one of your owned servers in the server selector.
3. Configure that server's modules and staff role IDs.
4. Save the configuration.
5. Wait for the next bot sync (normally 60 seconds).
6. Run `/reaction-role sync` after creating or changing reaction-role panels.

Switching servers never copies role IDs, channels, messages or settings from
the previous server.

## Commands

```text
/booster-panel channel:#channel
/booster-cleanup member user:@member
/booster-cleanup role role:@role
/security status
/security test-log
/security check member:@member
/security jail member:@member reason:...
/security unjail member:@member reason:...
/reaction-role sync
/reaction-role status
```

Server owners are always allowed. Other users need one of that server's saved
staff roles. Booster members only use the buttons in the public booster panel.

## Persistence

D1 stores per-server settings, revisions and audit metadata. The bot's local
reaction-role files store only panel IDs, channel IDs and message IDs and are
automatically suffixed with the guild ID. No reaction-role member assignments
or booster user database is stored.
