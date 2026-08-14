# Geeked AutoJail, Booster Roles and Secure Dashboard

This bot combines an audit-log-based AutoJail system with personal Server
Booster roles. All bot responses, commands, panels, logs, and console messages
are in English.

The bot only uses the standard `Guilds` and `GuildModeration` gateway intents.
Keep `Server Members Intent`, `Message Content Intent`, and `Presence Intent`
disabled in the Discord Developer Portal.

Version 3 also includes an optional secure web dashboard. GitHub Pages hosts
only the public interface, a Cloudflare Worker performs Discord OAuth2 and
strict validation, D1 stores configuration revisions, and the Wispbyte bot
independently verifies the staff member before applying a revision. Follow the
German step-by-step guide in `DASHBOARD-SETUP-DE.md`.

## Features

### AutoJail

When a member receives the configured trigger role, the bot:

1. keeps the trigger role;
2. adds the configured jail role;
3. removes every other role the bot is allowed to edit from that member;
4. restores the jail role if somebody removes it while the trigger remains.

Roles are only removed from the member. AutoJail never deletes the server's
role objects.

### Personal Booster roles

Active Server Boosters can create and edit exactly one personal role through an
English Components V2 panel:

- custom role name;
- solid HEX color;
- gradient when the server has `ENHANCED_ROLE_COLORS`;
- optional PNG or JPG role icon up to 256 KB when role icons are available;
- no permissions, no separate member-list display, and not mentionable;
- no emoji buttons.

The system has no booster database and no local mapping file. A user's assigned
role inside the reserved Discord role area is the mapping.

The official Geeked Booster role `1369776914016899204` is accepted as proof of
eligibility in addition to Discord's `premium_since` value.

### Automatic booster-role cleanup

Known custom-role owners are checked directly through Discord REST at a regular
interval. When a known owner stops boosting, the bot verifies that the role is
inside the reserved booster area and deletes it automatically. It then sends an
English Components V2 log like this:

```text
Booster status alert
@User has stopped boosting the server. Their custom role was deleted automatically.
```

The same safe cleanup runs when a tracked role owner leaves the server. The bot
never deletes roles outside the two Geeked booster marker roles. If Discord
rejects a deletion because of the role hierarchy, the log tells staff to review
it manually. Mentions in logs are displayed without pinging the user or role.

### Security commands

Authorized Geeked staff and the server owner can use one protected command with
five subcommands:

```text
/security status
/security test-log
/security check member:@User
/security jail member:@User reason:Reason
/security unjail member:@User reason:Reason
```

`status` checks both role positions, required permissions, and the AutoJail log
channel. `test-log` sends a real Components V2 test message. `check` previews
the exact action without changing roles. `jail` uses the same audited AutoJail
path as automatic role detection. `unjail` only removes the configured trigger
and jail roles; previously removed roles are never guessed or restored.

### Custom-role moderation log

Every creation and every later edit sends a separate English Components V2 log
to `BOOSTER_ROLE_LOG_CHANNEL_ID`. It includes the creator, role name, role ID,
color style, colors, and whether a new icon was uploaded. The log asks staff to
review the name and icon for inappropriate or NSFW content. If an icon exists,
the Components V2 log displays it directly as an image preview. Mentions do not
ping.

Without `Server Members Intent`, Discord does not send real-time member update
events for other users. This bot therefore uses targeted member requests and
rebuilds known role ownership from relevant audit-log history after a restart.
This is a best-effort design: an old role whose assignment is no longer present
in the scanned audit-log history cannot be identified after a restart without
persistent storage.

### Rotating Geeked bot status

The bot rotates through live English activities such as:

```text
Watching 1,284 active in Geeked
Watching 12,640 members in Geeked
Watching 86 boosts on Geeked
Listening to the Geeked community
```

The active value is Discord's approximate count of non-offline members. It is
requested through `GET /guilds/{id}?with_counts=true`, so this feature does not
need `Presence Intent` or `Server Members Intent`. By default, metrics refresh
every two minutes and the visible activity rotates every 30 seconds.

### Secure GitHub Pages dashboard

Authorized Geeked staff can configure:

- Components V2 accent color;
- AutoJail mode, roles, log channel, and debounce delay;
- official booster role, both booster log channels, and check interval;
- public booster-panel title, description, feature list, note, and button labels;
- rotating status text, server name, and intervals.

The eight staff role IDs are deliberately not editable in the browser. The
Worker checks them during Discord login and the bot checks the current member
again before applying an update. Revision zero never overrides `.env`, empty
protected fields inherit Wispbyte values, request bodies are size-limited, and
every applied revision creates a Components V2 audit log.

## 1. Create and invite the Discord bot

1. Open <https://discord.com/developers/applications> and create an application.
2. Open `Bot`, create the bot, and copy or reset its token.
3. Keep all switches under `Privileged Gateway Intents` disabled.
4. Under `OAuth2 -> URL Generator`, select:
   - scopes: `bot` and `applications.commands`;
   - permissions: `Manage Roles` and `View Audit Log`;
   - for log channels: `View Channels` and `Send Messages`.

The bot does not need `Administrator`.

## 2. Configure the role hierarchy

The bot's highest role must be above:

- the AutoJail trigger role;
- the AutoJail jail role;
- both booster-role marker roles;
- every member role AutoJail should remove.

Discord does not allow bots to edit roles above their highest role. Managed bot
and integration roles are protected and remain on jailed members.

## 3. Configure the environment

Rename `.env.example` to `.env` and fill in the IDs:

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
GUILD_ID=YOUR_SERVER_ID
JAIL_TRIGGER_ROLE_ID=ROLE_THAT_ACTIVATES_AUTOJAIL
JAIL_ROLE_ID=ADDITIONAL_JAIL_ROLE

BOOSTER_ROLE_ID=1369776914016899204
BOOSTER_STAFF_ROLE_IDS=1478058575149531300,1456339648187072625,1449402351793471488,1522528313061539850,1401221741665062962,1410006517083537411,1492287102589731107,1374039598019379302

# Strongly recommended AutoJail and security log channel. Booster cleanup logs
# also use this channel by default.
LOG_CHANNEL_ID=YOUR_LOG_CHANNEL_ID

# Optional separate channel for booster-stop logs.
BOOSTER_LOG_CHANNEL_ID=

# Required for custom-role creation/edit moderation logs.
BOOSTER_ROLE_LOG_CHANNEL_ID=YOUR_CUSTOM_ROLE_LOG_CHANNEL_ID

# Minutes between targeted booster checks. Allowed range: 1 to 60.
BOOSTER_CHECK_INTERVAL_MINUTES=5

# Rotating bot presence.
STATUS_ENABLED=true
STATUS_SERVER_NAME=Geeked
STATUS_ROTATION_SECONDS=30
STATUS_REFRESH_MINUTES=2

CHECK_RECENT_ON_START=true
DEBOUNCE_MS=800

# Enable only after completing DASHBOARD-SETUP-DE.md.
DASHBOARD_ENABLED=false
DASHBOARD_API_URL=https://geeked-dashboard-api.YOUR_SUBDOMAIN.workers.dev
DASHBOARD_SYNC_TOKEN=PASTE_A_LONG_RANDOM_SECRET
DASHBOARD_SYNC_SECONDS=60
```

Enable Discord Developer Mode and use `Copy ID` to obtain server, role, and
channel IDs.

## 4. Start on Wispbyte

Node.js 18.17 or newer is required. Wispbyte Node.js 19.9 is supported.

Choose `index.js` as the Wispbyte Main File. Alternatively, use:

```bash
npm install
npm start
```

The bot automatically registers its server commands on every start.

## 5. Post the booster panel

On the first start, the bot creates these two empty marker roles:

```text
Geeked | Booster Roles
Geeked | Booster Roles End
```

Personal roles are always placed between them. Do not rename, delete, duplicate,
or reverse the markers. Keep the bot role above both markers.

Run this command in the channel where the public panel should appear:

```text
/booster-panel channel:#booster-roles
```

The command is restricted in code to the configured Geeked staff role whitelist
and the server owner. The bot posts the public panel in the selected channel and
sends the command confirmation privately, so the command does not create an
ugly public response in the channel where it was executed. Unauthorized users
receive a private English denial.
Every panel button independently checks the official Booster role or Discord's
current boost status. Existing owners always edit their same role; the bot
refuses to create a second assigned personal role.

## 6. Verify AutoJail and security logs

After the bot starts, run:

```text
/security status
/security test-log
```

Every line in `status` should say `PASS`, and the second command must create a
green Components V2 test log in `LOG_CHANNEL_ID`. If either role hierarchy
check fails, move the bot role above both the AutoJail trigger and jail roles.

## 7. Manual booster-role cleanup

Automatic cleanup normally removes the personal role after the member stops
boosting. Staff can still clean up a legacy or failed role manually:

```text
/booster-cleanup member user:@User
```

The command refuses while the member is still boosting. Use `force:True` only
for an intentional override.

When the member already left the server:

```text
/booster-cleanup role role:@OldRole
```

Both cleanup actions use the same staff-role whitelist and can only delete roles
inside the reserved booster area. A booster can also delete their own role with
the `Remove my role` panel button.

The staff commands may remain visible to ordinary members because Discord does
not let a bot apply role-specific command visibility using only its bot token.
Visibility is not access: every execution is checked server-side before the bot
performs any action.

## Storage and restart behavior

The booster system does not write user IDs, role IDs, boost history, or images
to SQLite, JSON, or another external store. Discord itself stores the roles,
role assignments, public panels, and requested logs. Uploaded role images are
validated in memory and sent directly to Discord.

When the optional dashboard is enabled, Cloudflare D1 stores dashboard
settings, revisions, audit attribution, and short 30-minute staff sessions. It
still does not store booster mappings, boost history, role images, or message
content. The bot reloads the latest authorized dashboard revision after a
restart, so configured messages and status settings survive Wispbyte downtime.

Consequences of using no persistent mapping:

- no fully guaranteed real-time unboost event;
- no guaranteed reconstruction of very old role owners after a long audit-log
  history has passed;
- a repeated restart can produce another warning for an already stale role;
- AutoJail does not restore roles it removed from a member;
- no booster history or statistics are kept.

## Unjailing a member

Remove the trigger role first and then remove the jail role. If the trigger role
is still present, the bot adds the jail role again.

If startup fails, the console reports the missing permission, invalid ID, or
incorrect role hierarchy.
