# Slack Sync for Obsidian

Slackワークスペースの指定チャンネルのメッセージを、Obsidianのマークダウンノートとして一方向同期するプラグインです。[LINE Notes Sync](https://github.com/onikun94/line_to_obsidian)にインスパイアされています。

## 機能

- **メッセージ同期**: Slackチャンネルのメッセージを個別のマークダウンファイルとして保存
- **複数チャンネル対応**: 複数チャンネルを同時に同期、チャンネルごとにフォルダ分け
- **添付ファイル対応**: 画像やファイルをダウンロードしてObsidianの添付ファイルとして保存
  - メッセージに添付されたファイル → そのノートのアタッチメントとして埋め込み
  - 独立したファイルアップロード → 独立したノートとしてダウンロード
- **自動同期**: 設定した間隔(1〜360分)での自動同期
- **日付別グループ化**: 1日分のメッセージを1つのノートにまとめるオプション
- **スレッド対応**: スレッドの返信を親メッセージのノートに含めるオプション
- **Slack記法変換**: Slackのmrkdwn記法を標準Markdownに自動変換
- **ユーザー名解決**: ユーザーIDを表示名に自動変換
- **テンプレート**: ファイル名やフロントマター、メッセージ形式のカスタマイズ

## セットアップ

### 1. Slack Appの作成

1. [Slack API](https://api.slack.com/apps)にアクセスし、**Create New App** → **From scratch**を選択
2. アプリ名を入力し、対象のワークスペースを選択
3. **OAuth & Permissions**で以下のBot Token Scopesを追加:
   - `channels:history` - パブリックチャンネルのメッセージ読み取り
   - `channels:read` - チャンネル一覧の取得
   - `groups:history` - プライベートチャンネルのメッセージ読み取り（必要な場合）
   - `groups:read` - プライベートチャンネル一覧の取得（必要な場合）
   - `users:read` - ユーザー情報の取得（表示名解決用）
   - `files:read` - ファイルのダウンロード
4. **Install to Workspace**をクリックしてアプリをインストール
5. **Bot User OAuth Token** (`xoxb-`で始まるトークン) をコピー

### 2. Botをチャンネルに追加

同期したい各チャンネルで、Botをメンバーとして招待します:
- チャンネルで `/invite @YourBotName` を実行

### 3. プラグインの設定

1. Obsidianの設定 → Community Plugins → Slack Sync
2. **Slack Bot Token**にコピーしたトークンを入力
3. **Test Connection**で接続を確認
4. **Fetch Channels**でチャンネル一覧を取得
5. 同期したいチャンネルを追加・有効化
6. 必要に応じてフォルダパスやテンプレートを設定

## 使い方

### 手動同期

- サイドバーのリフレッシュアイコンをクリック
- コマンドパレットから「Sync Slack messages」を実行
- 設定画面の「Sync Now」ボタンをクリック

### 自動同期

設定画面で**Auto Sync**を有効にし、同期間隔を設定してください。

## 生成されるノートの例

### 個別ノート (デフォルト)

```markdown
---
source: Slack
channel: general
author: John Doe
date: 2025-09-12
timestamp: 1694505278.000000
---

プロジェクトの進捗について共有します。

![[Slack/attachments/general/screenshot.png]]
```

### 日付別グループノート

```markdown
---
source: Slack
channel: general
date: 2025-09-12
---

**John Doe** (09:54:38):
おはようございます！

**Jane Smith** (10:15:22):
おはようございます！今日の予定を確認しましょう。
```

## フォルダ構造

```
Slack/
├── general/
│   ├── 2025-09-12-general-1694505278_000000.md
│   └── 2025-09-12-general-1694508922_000000.md
├── project-alpha/
│   └── 2025-09-12-project-alpha-1694510000_000000.md
└── attachments/
    ├── general/
    │   └── screenshot.png
    └── project-alpha/
        └── design-doc.pdf
```

## テンプレート変数

| 変数 | 説明 | 例 |
|------|------|-----|
| `{date}` | 日付 (YYYY-MM-DD) | 2025-09-12 |
| `{datecompact}` | 日付 (YYYYMMDD) | 20250912 |
| `{time}` | 時刻 (HH:MM:SS) | 09:54:38 |
| `{timecompact}` | 時刻 (HHMMSS) | 095438 |
| `{datetime}` | 日時 (YYYYMMDDHHMMSS) | 20250912095438 |
| `{ts}` | Slackタイムスタンプ | 1694505278_000000 |
| `{channelName}` | チャンネル名 | general |
| `{userName}` | ユーザー表示名 | John_Doe |

## Slack APIレート制限への配慮

プラグインはSlack APIのレート制限を考慮して設計されています:

- メッセージ取得のページネーション間に1100msの遅延
- ユーザー情報取得間に200msの遅延
- ユーザー情報を1時間キャッシュして不要なAPI呼び出しを削減

## 開発

```bash
# 依存関係のインストール
npm install

# 開発ビルド (ウォッチモード)
npm run dev

# プロダクションビルド
npm run build
```

## ライセンス

MIT
