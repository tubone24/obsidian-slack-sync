import { SlackSyncSettings } from './types';

export const SLACK_API_BASE = 'https://slack.com/api';

export const SLACK_ENDPOINTS = {
	AUTH_TEST: `${SLACK_API_BASE}/auth.test`,
	CONVERSATIONS_LIST: `${SLACK_API_BASE}/conversations.list`,
	CONVERSATIONS_HISTORY: `${SLACK_API_BASE}/conversations.history`,
	CONVERSATIONS_REPLIES: `${SLACK_API_BASE}/conversations.replies`,
	CONVERSATIONS_INFO: `${SLACK_API_BASE}/conversations.info`,
	USERS_INFO: `${SLACK_API_BASE}/users.info`,
};

export const SLACK_BOT_TOKEN_SECRET_ID = 'slack-bot-token';

export const DEFAULT_SETTINGS: SlackSyncSettings = {
	channels: [],
	noteFolderPath: 'Slack',
	attachmentFolderPath: 'Slack/attachments',
	autoSync: false,
	syncInterval: 30,
	syncOnStartup: false,
	organizeByDate: false,
	fileNameTemplate: '{date}-{channelName}-{ts}',
	groupMessagesByDate: false,
	groupedFileNameTemplate: '{date}-{channelName}',
	groupedFrontmatterTemplate: 'source: Slack\nchannel: {channelName}\ndate: {date}',
	groupedMessageTemplate: '**{userName}** ({time}):\n{text}',
	includeUserName: true,
	syncThreadReplies: false,
	lastSyncTimestamps: {},
};

export const SYNC_BATCH_SIZE = 200;
export const USER_CACHE_TTL = 3600000; // 1 hour in ms
