# Slack Sync for Obsidian

A one-way sync plugin that pulls messages from Slack channels into your Obsidian vault as Markdown notes. Inspired by [LINE Notes Sync](https://github.com/onikun94/line_to_obsidian).

No relay server required — the plugin talks directly to the Slack Web API using a Bot Token.

## Features

- **Per-message notes** — Each Slack message becomes an individual `.md` file with YAML frontmatter
- **Multi-channel sync** — Sync multiple channels simultaneously, each into its own folder
- **Attachments & files** — Images and files are downloaded and embedded in notes
  - Files attached to a message are embedded as attachments of that note (`![[path]]`)
  - Standalone file uploads are saved as independent notes with the file embedded
- **Auto sync** — Configurable interval from 1 to 360 minutes, plus sync-on-startup option
- **Date grouping** — Optionally combine all messages from the same day into a single daily note
- **Thread replies** — Optionally include thread replies in the parent message note
- **Slack → Markdown conversion** — Converts Slack's mrkdwn syntax (`*bold*`, `_italic_`, `~strike~`, `<url|text>`, `<@user>`, `<#channel>`) to standard Markdown
- **User name resolution** — Resolves Slack user IDs to display names, cached for 1 hour
- **Customizable templates** — File names, frontmatter, and message formatting are all template-driven

## Setup

### 1. Create a Slack App

#### Quick setup (recommended)

1. Go to [Slack API — Your Apps](https://api.slack.com/apps) and click **Create New App** → **From an app manifest**
2. Select your workspace
3. Switch to the **JSON** tab and paste the contents of [`slack-app-manifest.json`](slack-app-manifest.json) included in this repository
4. Click **Create** and then **Install to Workspace**
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) from **OAuth & Permissions**

#### Manual setup

<details>
<summary>Click to expand manual setup instructions</summary>

1. Go to [Slack API — Your Apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Give it a name (e.g. "Obsidian Sync") and select your workspace
3. Navigate to **OAuth & Permissions** and add the following **Bot Token Scopes**:

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read messages from public channels |
| `channels:read` | List public channels |
| `groups:history` | Read messages from private channels (optional) |
| `groups:read` | List private channels (optional) |
| `users:read` | Resolve user IDs to display names |
| `files:read` | Download attached files and images |

4. Click **Install to Workspace** and authorize the app
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

</details>

### 2. Invite the Bot to Channels

In each channel you want to sync, invite the bot:

```
/invite @YourBotName
```

### 3. Configure the Plugin

1. Open **Settings → Community Plugins → Slack Sync**
2. Paste your **Bot Token** into the token field
3. Click **Test Connection** to verify it works
4. Click **Fetch Channels** to load available channels from your workspace
5. Add the channels you want to sync and toggle them on
6. (Optional) Set custom folder names, file templates, and other preferences

## Usage

### Manual Sync

- Click the **refresh icon** in the left ribbon
- Open the **Command Palette** (`Ctrl/Cmd + P`) and run `Sync Slack messages`
- Click **Sync Now** in the plugin settings

### Auto Sync

Enable **Auto Sync** in settings and set the interval (1–360 minutes). You can also enable **Sync on Startup** to sync automatically when Obsidian opens.

## Output Examples

### Individual Notes (default)

Each message produces a separate file:

```markdown
---
source: Slack
channel: general
author: John Doe
date: 2025-09-12
timestamp: 1694505278.000000
---

Here's the progress update for the project.

![[Slack/attachments/general/screenshot.png]]
```

### Date-Grouped Notes

When **Group Messages by Date** is enabled, all messages from the same channel and day are combined:

```markdown
---
source: Slack
channel: general
date: 2025-09-12
---

**John Doe** (09:54:38):
Good morning!

**Jane Smith** (10:15:22):
Good morning! Let's review today's agenda.
```

### Thread Replies

When **Sync Thread Replies** is enabled, replies are appended to the parent note:

```markdown
---
source: Slack
channel: general
author: John Doe
date: 2025-09-12
timestamp: 1694505278.000000
---

What do you think about the new design?

---

### Thread Replies

**Jane Smith** (10:20:15):
Looks great! I have a few suggestions though.

**Bob Wilson** (10:25:33):
Agreed, the layout is much better now.
```

## Folder Structure

```
Slack/
├── general/
│   ├── 2025-09-12-general-1694505278_000000.md
│   └── 2025-09-12-general-1694508922_000000.md
├── project-alpha/
│   └── 2025-09-12-project-alpha-1694510000_000000.md
└── attachments/
    ├── general/
    │   ├── screenshot.png
    │   └── report.xlsx
    └── project-alpha/
        └── design-doc.pdf
```

Each channel gets its own subfolder. Attachments are organized by channel under a separate `attachments/` directory. You can customize all folder paths in settings, and optionally enable date-based subfolders (`YYYY/MM/DD`).

## Template Variables

Templates are used for file names, frontmatter, and grouped message formatting.

| Variable | Description | Example |
|----------|-------------|---------|
| `{date}` | Date (YYYY-MM-DD) | `2025-09-12` |
| `{datecompact}` | Date (YYYYMMDD) | `20250912` |
| `{time}` | Time (HH:MM:SS) | `09:54:38` |
| `{timecompact}` | Time (HHMMSS) | `095438` |
| `{datetime}` | DateTime (YYYYMMDDHHMMSS) | `20250912095438` |
| `{ts}` | Slack timestamp | `1694505278_000000` |
| `{channelName}` | Channel name | `general` |
| `{userName}` | User display name | `John_Doe` |
| `{text}` | Message text (grouped mode only) | — |

### Default Templates

| Setting | Default Value |
|---------|---------------|
| File Name | `{date}-{channelName}-{ts}` |
| Grouped File Name | `{date}-{channelName}` |
| Grouped Frontmatter | `source: Slack`<br>`channel: {channelName}`<br>`date: {date}` |
| Grouped Message | `**{userName}** ({time}):\n{text}` |

## Settings Reference

| Setting | Description | Default |
|---------|-------------|---------|
| **Slack Bot Token** | Bot User OAuth Token (`xoxb-...`) | — |
| **Auto Sync** | Enable periodic automatic sync | Off |
| **Sync Interval** | Minutes between auto-syncs (1–360) | 30 |
| **Sync on Startup** | Sync when Obsidian launches | Off |
| **Sync Thread Replies** | Include thread replies in parent note | Off |
| **Note Folder Path** | Root folder for notes | `Slack` |
| **Attachment Folder Path** | Root folder for downloaded files | `Slack/attachments` |
| **Organize by Date** | Create `YYYY/MM/DD` subfolders | Off |
| **File Name Template** | Template for note file names | `{date}-{channelName}-{ts}` |
| **Group Messages by Date** | Merge daily messages into one note | Off |

## Slack API Rate Limits

The plugin is designed to stay within Slack's API rate limits:

- **1,100 ms delay** between message history pagination requests
- **200 ms delay** between user info lookups
- **1-hour cache** for user info to minimize redundant API calls
- Configurable sync interval (minimum 1 minute) to prevent excessive polling

## Architecture

```
┌──────────────┐       Slack Web API        ┌─────────────┐
│              │  ──── conversations.history ──→             │
│   Obsidian   │  ──── conversations.replies ──→   Slack    │
│   Plugin     │  ──── users.info ───────────→   Servers   │
│              │  ──── file download ────────→             │
└──────┬───────┘                             └─────────────┘
       │
       ▼
  ┌────────────┐
  │  Vault     │
  │  ├── notes │
  │  └── files │
  └────────────┘
```

The plugin polls Slack's Web API directly — no intermediate server, no webhook, no database. Sync state (last-synced timestamp per channel) is stored locally in the plugin's `data.json`.

## Development

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build
```

### Project Structure

```
src/
├── main.ts            # Plugin entry point and settings UI
├── slackApi.ts        # Slack Web API client
├── syncEngine.ts      # Core sync orchestration
├── fileManager.ts     # Note creation and attachment handling
├── slackMarkdown.ts   # Slack mrkdwn → Markdown converter
├── dateUtils.ts       # Date formatting and template engine
├── types.ts           # TypeScript interfaces
└── constants.ts       # Default settings and API endpoints
```

## License

[MIT](LICENSE)
