# Multi-Server-Dashboard einrichten

## Discord Developer Portal

Unter OAuth2 → Redirects eintragen:

```text
https://geeked-dashboard-api.dashflyflash.workers.dev/auth/callback
```

Beim Installationslink werden weiterhin `bot` und `applications.commands`
verwendet. Privileged Gateway Intents bleiben ausgeschaltet.

## Cloudflare D1

Die vorhandene Datenbank `geeked-dashboard` weiterverwenden. Falls sie neu ist,
den Inhalt von `dashboard/worker/schema.sql` einmal in der D1 Console ausführen.
Die Tabelle `settings` besitzt bereits `guild_id` als Primärschlüssel und ist
damit ohne Schemaänderung Multi-Server-fähig.

## Cloudflare Worker

`dashboard/worker/src/index.js` als Worker-Code deployen. D1 unter dem Binding
`DB` verbinden.

Variables and Secrets:

| Name | Typ | Wert |
|---|---|---|
| `DISCORD_CLIENT_ID` | Text | Discord Application ID |
| `DISCORD_CLIENT_SECRET` | Secret | OAuth2 Client Secret |
| `FRONTEND_URL` | Text | `https://synt4ix.github.io/Something/` |
| `PUBLIC_API_ORIGIN` | Text | Worker-URL ohne Pfad |
| `BOT_SYNC_TOKEN` | Secret | langer zufälliger Wert |
| `SESSION_PEPPER` | Secret | anderer langer zufälliger Wert |
| `STATUS_GUILD_ID` | Text | `1369565242371342446` für Geeked |

`BOT_SYNC_TOKEN` und `SESSION_PEPPER` müssen unterschiedliche Werte sein.
Nach jeder Änderung deployen. Der Health-Check muss liefern:

```json
{"ok":true,"service":"geeked-dashboard-api"}
```

## GitHub Pages

Den kompletten Inhalt von `dashboard/github-pages/` nach `docs/` kopieren.
In `docs/config.js` muss die öffentliche Worker-URL stehen. GitHub Pages auf
Branch `main` und Ordner `/docs` stellen.

## Wispbyte

In `.env`:

```env
DASHBOARD_ENABLED=true
DASHBOARD_API_URL=https://geeked-dashboard-api.dashflyflash.workers.dev
DASHBOARD_SYNC_TOKEN=DER_GLEICHE_WERT_WIE_BOT_SYNC_TOKEN
DASHBOARD_SYNC_SECONDS=60
STATUS_GUILD_ID=1369565242371342446
```

## Erster Login

Nach dem v5-Update neu mit Discord anmelden. Die Seite zeigt alle Server, die
dem Account laut Discord gehören. Beim Wechsel im Auswahlfeld wird jeweils eine
andere `guild_id` geladen. Neue Server besitzen Revision 0 und deaktivierte
Module, bis der Besitzer eine gültige Konfiguration speichert.

## Zugriff

Das Web-Dashboard ist nur für den Serverbesitzer. Unter „Staff whitelist“ kann
der Besitzer pro Server bis zu 20 Rollen eintragen, die anschließend die
geschützten Slash-Commands verwenden dürfen. Diese Rollen erhalten keinen
Web-Dashboard-Zugriff.
