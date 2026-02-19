export interface ChannelConfig {
	id: string;
	name: string;
	enabled: boolean;
	folderName?: string;
}

export interface SlackSyncSettings {
	channels: ChannelConfig[];
	noteFolderPath: string;
	attachmentFolderPath: string;
	autoSync: boolean;
	syncInterval: number;
	syncOnStartup: boolean;
	organizeByDate: boolean;
	fileNameTemplate: string;
	groupMessagesByDate: boolean;
	groupedFileNameTemplate: string;
	groupedFrontmatterTemplate: string;
	groupedMessageTemplate: string;
	includeUserName: boolean;
	syncThreadReplies: boolean;
	lastSyncTimestamps: Record<string, string>;
}

export interface SlackUser {
	id: string;
	name: string;
	real_name?: string;
	display_name?: string;
}

export interface SlackFile {
	id: string;
	name: string;
	title: string;
	mimetype: string;
	filetype: string;
	size: number;
	url_private_download?: string;
	url_private?: string;
	mode: string;
	is_external: boolean;
}

export interface SlackMessage {
	type: string;
	subtype?: string;
	user?: string;
	bot_id?: string;
	text: string;
	ts: string;
	thread_ts?: string;
	reply_count?: number;
	files?: SlackFile[];
	attachments?: SlackAttachment[];
}

export interface SlackAttachment {
	title?: string;
	text?: string;
	fallback?: string;
	image_url?: string;
	thumb_url?: string;
	from_url?: string;
	original_url?: string;
	service_name?: string;
}

export interface SlackChannel {
	id: string;
	name: string;
	is_channel: boolean;
	is_group: boolean;
	is_im: boolean;
	is_mpim: boolean;
	is_private: boolean;
	is_archived: boolean;
	is_member: boolean;
}

export interface SlackApiResponse<T> {
	ok: boolean;
	error?: string;
	response_metadata?: {
		next_cursor?: string;
	};
	messages?: SlackMessage[];
	channels?: SlackChannel[];
	user?: {
		id: string;
		name: string;
		real_name?: string;
		profile?: {
			display_name?: string;
			real_name?: string;
		};
	};
	channel?: SlackChannel;
	members?: string[];
}

export interface SyncResult {
	channelId: string;
	channelName: string;
	messagesCreated: number;
	threadsUpdated: number;
	filesDownloaded: number;
	errors: string[];
}

export interface ProcessedMessage {
	message: SlackMessage;
	userName: string;
	channelName: string;
	date: Date;
	markdownContent: string;
	frontmatter: Record<string, string>;
	attachmentPaths: string[];
}
