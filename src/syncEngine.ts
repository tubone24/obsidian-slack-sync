import { Notice } from 'obsidian';
import { SlackApiClient } from './slackApi';
import { FileManager } from './fileManager';
import { slackMrkdwnToMarkdown, createUserResolver } from './slackMarkdown';
import {
	SlackSyncSettings,
	SlackMessage,
	SlackFile,
	SlackUser,
	ChannelConfig,
	SyncResult,
} from './types';
import { SYNC_BATCH_SIZE } from './constants';

export class SyncEngine {
	private api: SlackApiClient;
	private fileManager: FileManager;
	private settings: SlackSyncSettings;
	private userMap: Map<string, SlackUser> = new Map();
	private isSyncing = false;

	constructor(api: SlackApiClient, fileManager: FileManager, settings: SlackSyncSettings) {
		this.api = api;
		this.fileManager = fileManager;
		this.settings = settings;
	}

	updateSettings(settings: SlackSyncSettings): void {
		this.settings = settings;
		this.fileManager.updateSettings(settings);
	}

	getIsSyncing(): boolean {
		return this.isSyncing;
	}

	/**
	 * Run a full sync for all enabled channels.
	 */
	async syncAll(
		onSaveSettings: () => Promise<void>
	): Promise<SyncResult[]> {
		if (this.isSyncing) {
			new Notice('Slack Sync: Sync already in progress');
			return [];
		}

		this.isSyncing = true;
		const results: SyncResult[] = [];

		try {
			const enabledChannels = this.settings.channels.filter((c) => c.enabled);
			if (enabledChannels.length === 0) {
				new Notice('Slack Sync: No channels configured for sync');
				return [];
			}

			new Notice(`Slack Sync: Syncing ${enabledChannels.length} channel(s)...`);

			for (const channel of enabledChannels) {
				try {
					const result = await this.syncChannel(channel);
					results.push(result);
				} catch (e) {
					const error = e as Error;
					results.push({
						channelId: channel.id,
						channelName: channel.name,
						messagesCreated: 0,
						threadsUpdated: 0,
						filesDownloaded: 0,
						errors: [error.message],
					});
				}
			}

			// Save updated timestamps
			await onSaveSettings();

			// Report results
			const totalMessages = results.reduce((sum, r) => sum + r.messagesCreated, 0);
			const totalThreads = results.reduce((sum, r) => sum + r.threadsUpdated, 0);
			const totalFiles = results.reduce((sum, r) => sum + r.filesDownloaded, 0);
			const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

			let resultMessage = `Slack Sync: ${totalMessages} note(s), ${totalFiles} file(s) synced`;
			if (totalThreads > 0) {
				resultMessage += `, ${totalThreads} thread(s) updated`;
			}
			if (totalErrors > 0) {
				const allErrors = results.flatMap((r) => r.errors);
				resultMessage += ` (${totalErrors} error(s))`;
				console.error('Slack Sync errors:', allErrors);
				new Notice(resultMessage + '\n' + allErrors.join('\n'), 10000);
			} else {
				new Notice(resultMessage);
			}
		} finally {
			this.isSyncing = false;
		}

		return results;
	}

	/**
	 * Sync a single channel.
	 */
	private async syncChannel(channel: ChannelConfig): Promise<SyncResult> {
		const result: SyncResult = {
			channelId: channel.id,
			channelName: channel.name,
			messagesCreated: 0,
			threadsUpdated: 0,
			filesDownloaded: 0,
			errors: [],
		};

		const oldest = this.settings.lastSyncTimestamps[channel.id];
		let allMessages: SlackMessage[] = [];
		let hasMore = true;
		let cursor: string | undefined;

		// Fetch all messages since last sync, handling pagination
		while (hasMore) {
			const response = await this.api.getChannelHistory(
				channel.id,
				oldest,
				SYNC_BATCH_SIZE
			);
			allMessages.push(...response.messages);
			hasMore = response.hasMore;
			cursor = response.nextCursor;

			if (hasMore && cursor) {
				// Small delay to respect rate limits
				await sleep(1100);
			}
		}

		if (allMessages.length === 0) {
			return result;
		}

		// Sort messages oldest-first for chronological processing
		allMessages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

		// Resolve user names for all messages
		const userIds = new Set<string>();
		for (const msg of allMessages) {
			if (msg.user) userIds.add(msg.user);
		}

		// Also collect user IDs mentioned in message text
		for (const msg of allMessages) {
			const mentions = msg.text?.match(/<@([A-Z0-9]+)>/g) || [];
			for (const mention of mentions) {
				const match = mention.match(/<@([A-Z0-9]+)>/);
				if (match) userIds.add(match[1]);
			}
		}

		await this.resolveUsers(Array.from(userIds));

		const userResolver = createUserResolver(this.userMap);

		// First pass: identify which messages are new parents vs thread replies
		// to detect previously-synced messages that have become threads
		const parentTsInBatch = new Set<string>();
		const threadParentTsToUpdate = new Set<string>();

		for (const message of allMessages) {
			if (this.shouldSkipMessage(message)) continue;
			if (message.thread_ts && message.thread_ts !== message.ts) {
				// This is a thread reply — its thread_ts points to a parent
				// that may have been synced before without thread replies
				threadParentTsToUpdate.add(message.thread_ts);
				continue;
			}
			parentTsInBatch.add(message.ts);
		}

		// Parents in the current batch will be processed normally with their
		// threads, so no need to update them separately
		for (const ts of parentTsInBatch) {
			threadParentTsToUpdate.delete(ts);
		}

		// Process each message (new messages)
		let latestTs = oldest || '0';
		for (const message of allMessages) {
			try {
				// Skip bot messages, subtypes we don't care about
				if (this.shouldSkipMessage(message)) {
					continue;
				}

				// Skip thread replies at top level (they belong to parent threads)
				if (message.thread_ts && message.thread_ts !== message.ts) {
					continue;
				}

				await this.processMessage(message, channel, userResolver, result);
			} catch (e) {
				result.errors.push(`Message ${message.ts}: ${(e as Error).message}`);
			}

			// Track the latest timestamp
			if (parseFloat(message.ts) > parseFloat(latestTs)) {
				latestTs = message.ts;
			}
		}

		// Update existing notes whose messages became threads after initial sync
		if (this.settings.syncThreadReplies && threadParentTsToUpdate.size > 0) {
			await this.updateExistingThreads(
				channel,
				threadParentTsToUpdate,
				userResolver,
				result
			);
		}

		// Update last sync timestamp
		this.settings.lastSyncTimestamps[channel.id] = latestTs;

		return result;
	}

	/**
	 * Process a single message: create note, download attachments.
	 */
	private async processMessage(
		message: SlackMessage,
		channel: ChannelConfig,
		userResolver: (userId: string) => string,
		result: SyncResult
	): Promise<void> {
		const userName = message.user
			? userResolver(message.user)
			: 'bot';

		// Convert Slack mrkdwn to Markdown
		const markdownText = slackMrkdwnToMarkdown(message.text || '', userResolver);

		// Handle file attachments
		const attachmentEmbeds: string[] = [];
		if (message.files && message.files.length > 0) {
			for (const file of message.files) {
				try {
					const embedPath = await this.downloadAndSaveFile(
						file,
						channel.name,
						channel.folderName
					);
					if (embedPath) {
						attachmentEmbeds.push(this.fileManager.createEmbed(embedPath));
						result.filesDownloaded++;
					}
				} catch (e) {
					result.errors.push(`File ${file.name}: ${(e as Error).message}`);
				}
			}
		}

		// Handle Slack attachments (unfurled links with images)
		if (message.attachments) {
			for (const attachment of message.attachments) {
				if (attachment.image_url) {
					attachmentEmbeds.push(`![${attachment.title || 'image'}](${attachment.image_url})`);
				}
			}
		}

		// Determine if this is a standalone file upload (no meaningful text)
		const isStandaloneUpload = this.isStandaloneFileUpload(message);

		if (isStandaloneUpload && message.files && message.files.length > 0) {
			// For standalone file uploads, the note mainly embeds the file
			// We already have attachment embeds, so create with minimal text
			if (this.settings.groupMessagesByDate) {
				const fileDesc = message.files.map(f => f.title || f.name).join(', ');
				await this.fileManager.appendToGroupedNote(
					message,
					channel.name,
					userName,
					fileDesc,
					attachmentEmbeds,
					undefined,
					channel.folderName
				);
			} else {
				await this.fileManager.createIndividualNote(
					message,
					channel.name,
					userName,
					'',
					attachmentEmbeds,
					undefined,
					channel.folderName
				);
			}
			result.messagesCreated++;
			return;
		}

		// Fetch thread replies if enabled
		let threadReplies: { userName: string; text: string; ts: string }[] | undefined;
		if (
			this.settings.syncThreadReplies &&
			message.reply_count &&
			message.reply_count > 0
		) {
			try {
				const replies = await this.api.getThreadReplies(channel.id, message.ts);
				threadReplies = [];
				for (const reply of replies) {
					const replyUser = reply.user ? userResolver(reply.user) : 'bot';
					const replyText = slackMrkdwnToMarkdown(reply.text || '', userResolver);
					threadReplies.push({
						userName: replyUser,
						text: replyText,
						ts: reply.ts,
					});
				}
			} catch (e) {
				result.errors.push(`Thread ${message.ts}: ${(e as Error).message}`);
			}
		}

		// Create the note
		if (this.settings.groupMessagesByDate) {
			const created = await this.fileManager.appendToGroupedNote(
				message,
				channel.name,
				userName,
				markdownText,
				attachmentEmbeds,
				threadReplies,
				channel.folderName
			);
			if (created) result.messagesCreated++;
		} else {
			const created = await this.fileManager.createIndividualNote(
				message,
				channel.name,
				userName,
				markdownText,
				attachmentEmbeds,
				threadReplies,
				channel.folderName
			);
			if (created) result.messagesCreated++;
		}
	}

	/**
	 * Update existing notes for messages that became threads after initial sync.
	 *
	 * When a reply appears in conversations.history, its thread_ts tells us
	 * which previously-synced parent message now has a thread. We fetch the
	 * full thread and update the existing note.
	 */
	private async updateExistingThreads(
		channel: ChannelConfig,
		threadParentTsSet: Set<string>,
		userResolver: (userId: string) => string,
		result: SyncResult
	): Promise<void> {
		for (const parentTs of threadParentTsSet) {
			try {
				const thread = await this.api.getThread(channel.id, parentTs);
				const parent = thread.parent;
				const replies = thread.replies;

				if (replies.length === 0) continue;

				// Resolve user IDs for thread participants
				const threadUserIds = new Set<string>();
				if (parent.user) threadUserIds.add(parent.user);
				for (const reply of replies) {
					if (reply.user) threadUserIds.add(reply.user);
					// Also collect mentioned user IDs
					const mentions = reply.text?.match(/<@([A-Z0-9]+)>/g) || [];
					for (const mention of mentions) {
						const match = mention.match(/<@([A-Z0-9]+)>/);
						if (match) threadUserIds.add(match[1]);
					}
				}
				await this.resolveUsers(Array.from(threadUserIds));

				const parentUserName = parent.user
					? userResolver(parent.user)
					: 'bot';
				const markdownText = slackMrkdwnToMarkdown(parent.text || '', userResolver);

				const threadReplies = replies.map((reply) => ({
					userName: reply.user ? userResolver(reply.user) : 'bot',
					text: slackMrkdwnToMarkdown(reply.text || '', userResolver),
					ts: reply.ts,
				}));

				let updated: boolean;
				if (this.settings.groupMessagesByDate) {
					updated = await this.fileManager.updateGroupedNoteThread(
						parent,
						channel.name,
						parentUserName,
						markdownText,
						threadReplies,
						channel.folderName
					);
				} else {
					updated = await this.fileManager.updateIndividualNoteThread(
						parent,
						channel.name,
						parentUserName,
						markdownText,
						threadReplies,
						channel.folderName
					);
				}

				if (updated) {
					result.threadsUpdated++;
				}

				// Rate limit between thread fetches
				await sleep(1100);
			} catch (e) {
				result.errors.push(`Thread update ${parentTs}: ${(e as Error).message}`);
			}
		}
	}

	/**
	 * Download a Slack file and save it as an attachment.
	 */
	private async downloadAndSaveFile(
		file: SlackFile,
		channelName: string,
		channelFolderName?: string
	): Promise<string | null> {
		const downloadUrl = file.url_private_download || file.url_private;
		if (!downloadUrl) {
			return null;
		}

		if (file.is_external) {
			// External files can't be downloaded via Slack API
			return null;
		}

		const data = await this.api.downloadFile(downloadUrl);
		const savedPath = await this.fileManager.saveAttachment(
			data,
			file.name,
			channelName,
			channelFolderName
		);
		return savedPath;
	}

	/**
	 * Determine if a message is a standalone file upload with no meaningful text.
	 */
	private isStandaloneFileUpload(message: SlackMessage): boolean {
		if (!message.files || message.files.length === 0) return false;

		const text = (message.text || '').trim();
		// Slack auto-generates text like "uploaded a file: <filename>" for standalone uploads
		// If text is empty or just the auto-generated file reference, treat as standalone
		if (!text) return true;

		// Check if the text is just the file upload notification
		if (message.subtype === 'file_share' && !text) return true;

		return false;
	}

	/**
	 * Check if a message should be skipped during sync.
	 */
	private shouldSkipMessage(message: SlackMessage): boolean {
		const skipSubtypes = new Set([
			'channel_join',
			'channel_leave',
			'channel_topic',
			'channel_purpose',
			'channel_name',
			'channel_archive',
			'channel_unarchive',
			'pinned_item',
			'unpinned_item',
		]);

		if (message.subtype && skipSubtypes.has(message.subtype)) {
			return true;
		}

		// Skip messages with no content and no files
		if (!message.text && (!message.files || message.files.length === 0)) {
			return true;
		}

		return false;
	}

	/**
	 * Resolve user info for a list of user IDs and cache them.
	 */
	private async resolveUsers(userIds: string[]): Promise<void> {
		for (const userId of userIds) {
			if (this.userMap.has(userId)) continue;
			try {
				const user = await this.api.getUserInfo(userId);
				this.userMap.set(userId, user);
			} catch (e) {
				// If user lookup fails, use the raw ID
				this.userMap.set(userId, {
					id: userId,
					name: userId,
				});
			}
			// Small delay to respect rate limits
			await sleep(200);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
