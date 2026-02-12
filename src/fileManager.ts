import { Vault, TFolder, normalizePath } from 'obsidian';
import { SlackSyncSettings, SlackMessage, SlackFile } from './types';
import {
	slackTsToDate,
	formatDate,
	formatDateCompact,
	formatTime,
	formatTimeCompact,
	formatDateTimeCompact,
	getDateFolderPath,
	applyTemplate,
	sanitizeFileName,
} from './dateUtils';
import { slackMrkdwnToMarkdown } from './slackMarkdown';

export class FileManager {
	private vault: Vault;
	private settings: SlackSyncSettings;

	constructor(vault: Vault, settings: SlackSyncSettings) {
		this.vault = vault;
		this.settings = settings;
	}

	updateSettings(settings: SlackSyncSettings): void {
		this.settings = settings;
	}

	/**
	 * Ensure a folder path exists, creating any missing directories.
	 */
	async ensureFolder(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);
		const existing = this.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFolder) {
			return;
		}
		if (!existing) {
			await this.vault.createFolder(normalized);
		}
	}

	/**
	 * Build the full folder path for a note based on settings.
	 */
	getNoteFolderPath(channelName: string, date: Date, customFolderName?: string): string {
		const channelFolder = customFolderName || channelName;
		let basePath = normalizePath(`${this.settings.noteFolderPath}/${channelFolder}`);

		if (this.settings.organizeByDate) {
			basePath = normalizePath(`${basePath}/${getDateFolderPath(date)}`);
		}

		return basePath;
	}

	/**
	 * Build the full folder path for an attachment.
	 */
	getAttachmentFolderPath(channelName: string, customFolderName?: string): string {
		const channelFolder = customFolderName || channelName;
		return normalizePath(`${this.settings.attachmentFolderPath}/${channelFolder}`);
	}

	/**
	 * Get template variables for a given message context.
	 */
	getTemplateVars(
		ts: string,
		channelName: string,
		userName?: string
	): Record<string, string> {
		const date = slackTsToDate(ts);
		return {
			date: formatDate(date),
			datecompact: formatDateCompact(date),
			time: formatTime(date),
			timecompact: formatTimeCompact(date),
			datetime: formatDateTimeCompact(date),
			ts: sanitizeFileName(ts),
			channelName: sanitizeFileName(channelName),
			userName: sanitizeFileName(userName || 'unknown'),
		};
	}

	/**
	 * Create an individual note for a single message.
	 */
	async createIndividualNote(
		message: SlackMessage,
		channelName: string,
		userName: string,
		markdownText: string,
		attachmentEmbeds: string[],
		threadReplies?: { userName: string; text: string; ts: string }[],
		channelFolderName?: string
	): Promise<string | null> {
		const date = slackTsToDate(message.ts);
		const folderPath = this.getNoteFolderPath(channelName, date, channelFolderName);
		const vars = this.getTemplateVars(message.ts, channelName, userName);

		const fileName = sanitizeFileName(applyTemplate(this.settings.fileNameTemplate, vars));
		const filePath = normalizePath(`${folderPath}/${fileName}.md`);

		// Skip if already exists
		if (await this.vault.adapter.exists(filePath)) {
			return null;
		}

		await this.ensureFolder(folderPath);

		// Build frontmatter
		const frontmatter = [
			'---',
			'source: Slack',
			`channel: ${channelName}`,
			`author: ${userName}`,
			`date: ${formatDate(date)}`,
			`time: "${formatTime(date)}"`,
			`timestamp: ${message.ts}`,
			'---',
			'',
		].join('\n');

		// Build content
		let content = frontmatter + markdownText;

		// Add attachment embeds
		if (attachmentEmbeds.length > 0) {
			content += '\n\n' + attachmentEmbeds.join('\n');
		}

		// Add thread replies if enabled
		if (threadReplies && threadReplies.length > 0) {
			const threadTitle = markdownText.split('\n')[0].trim() || 'Thread';
			content += `\n\n---\n\n### ${threadTitle}\n\n`;
			for (const reply of threadReplies) {
				const replyDate = slackTsToDate(reply.ts);
				content += `**${reply.userName}** (${formatTime(replyDate)}):\n${reply.text}\n\n`;
			}
		}

		await this.vault.create(filePath, content);
		return filePath;
	}

	/**
	 * Parse YAML frontmatter and body from a note's content.
	 */
	private parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
		const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;
		return { frontmatter: match[1], body: match[2] };
	}

	/**
	 * Update the authors field in frontmatter YAML, adding a new author if not already present.
	 * Converts single `author:` to `authors:` list when multiple authors exist.
	 */
	private updateFrontmatterAuthors(frontmatterContent: string, newAuthor: string): string {
		const lines = frontmatterContent.split('\n');
		const existingAuthors: string[] = [];
		let authorLineIndex = -1;
		let authorsStartIndex = -1;
		let authorsEndIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.startsWith('author: ')) {
				authorLineIndex = i;
				existingAuthors.push(line.substring('author: '.length).trim());
			} else if (line.startsWith('authors:')) {
				authorsStartIndex = i;
				let j = i + 1;
				while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
					existingAuthors.push(lines[j].replace(/^\s+-\s+/, '').trim());
					j++;
				}
				authorsEndIndex = j - 1;
			}
		}

		if (existingAuthors.includes(newAuthor)) {
			return frontmatterContent;
		}

		existingAuthors.push(newAuthor);

		const authorsYaml = existingAuthors.length === 1
			? `author: ${existingAuthors[0]}`
			: `authors:\n${existingAuthors.map(a => `  - ${a}`).join('\n')}`;

		if (authorLineIndex >= 0) {
			lines[authorLineIndex] = authorsYaml;
		} else if (authorsStartIndex >= 0) {
			lines.splice(authorsStartIndex, authorsEndIndex - authorsStartIndex + 1, authorsYaml);
		} else {
			lines.push(authorsYaml);
		}

		return lines.join('\n');
	}

	/**
	 * Append a message to a grouped daily note.
	 */
	async appendToGroupedNote(
		message: SlackMessage,
		channelName: string,
		userName: string,
		markdownText: string,
		attachmentEmbeds: string[],
		threadReplies?: { userName: string; text: string; ts: string }[],
		channelFolderName?: string
	): Promise<string | null> {
		const date = slackTsToDate(message.ts);
		const folderPath = this.getNoteFolderPath(channelName, date, channelFolderName);
		const vars = this.getTemplateVars(message.ts, channelName, userName);

		const fileName = sanitizeFileName(
			applyTemplate(this.settings.groupedFileNameTemplate, vars)
		);
		const filePath = normalizePath(`${folderPath}/${fileName}.md`);

		await this.ensureFolder(folderPath);

		// Build the message entry with a hidden timestamp marker for deduplication
		const messageVars = {
			...vars,
			text: markdownText,
			userName: userName,
		};
		let messageEntry = applyTemplate(this.settings.groupedMessageTemplate, messageVars);

		if (attachmentEmbeds.length > 0) {
			messageEntry += '\n' + attachmentEmbeds.join('\n');
		}

		// Add thread replies as blockquotes below the parent message
		if (threadReplies && threadReplies.length > 0) {
			const threadTitle = markdownText.split('\n')[0].trim() || 'Thread';
			messageEntry += `\n\n#### ${threadTitle}\n\n`;
			for (const reply of threadReplies) {
				const replyDate = slackTsToDate(reply.ts);
				messageEntry += `> **${reply.userName}** (${formatTime(replyDate)}):\n> ${reply.text.split('\n').join('\n> ')}\n\n`;
			}
		}

		messageEntry = `<!-- ts:${message.ts} -->\n${messageEntry}`;

		const existingFile = this.vault.getAbstractFileByPath(filePath);
		if (existingFile) {
			// Append to existing file
			const existingContent = await this.vault.read(existingFile as any);

			// Check for duplicate by timestamp
			if (existingContent.includes(message.ts)) {
				return null;
			}

			// Update frontmatter to include new author if different
			const parsed = this.parseFrontmatter(existingContent);
			if (parsed) {
				const updatedFrontmatter = this.updateFrontmatterAuthors(parsed.frontmatter, userName);
				const newContent = `---\n${updatedFrontmatter}\n---\n${parsed.body}\n\n${messageEntry}`;
				await this.vault.modify(existingFile as any, newContent);
			} else {
				await this.vault.modify(existingFile as any, existingContent + '\n\n' + messageEntry);
			}
		} else {
			// Create new grouped file with frontmatter
			const frontmatterTemplate = this.settings.groupedFrontmatterTemplate;
			const frontmatterContent = applyTemplate(frontmatterTemplate, vars);
			const content = `---\n${frontmatterContent}\n---\n\n${messageEntry}`;
			await this.vault.create(filePath, content);
		}

		return filePath;
	}

	/**
	 * Update an existing individual note with thread replies.
	 * Used when a previously-synced message becomes a thread after initial sync.
	 */
	async updateIndividualNoteThread(
		message: SlackMessage,
		channelName: string,
		userName: string,
		markdownText: string,
		threadReplies: { userName: string; text: string; ts: string }[],
		channelFolderName?: string
	): Promise<boolean> {
		const date = slackTsToDate(message.ts);
		const folderPath = this.getNoteFolderPath(channelName, date, channelFolderName);
		const vars = this.getTemplateVars(message.ts, channelName, userName);
		const fileName = sanitizeFileName(applyTemplate(this.settings.fileNameTemplate, vars));
		const filePath = normalizePath(`${folderPath}/${fileName}.md`);

		const existingFile = this.vault.getAbstractFileByPath(filePath);
		if (!existingFile) return false;

		const content = await this.vault.read(existingFile as any);
		const parsed = this.parseFrontmatter(content);
		if (!parsed) return false;

		// Build new thread section
		const threadTitle = markdownText.split('\n')[0].trim() || 'Thread';
		let threadSection = `\n\n---\n\n### ${threadTitle}\n\n`;
		for (const reply of threadReplies) {
			const replyDate = slackTsToDate(reply.ts);
			threadSection += `**${reply.userName}** (${formatTime(replyDate)}):\n${reply.text}\n\n`;
		}

		// Replace or append thread section in the body
		const body = parsed.body;
		const threadSeparator = '\n\n---\n\n### ';
		const separatorIndex = body.indexOf(threadSeparator);

		let newBody: string;
		if (separatorIndex !== -1) {
			// Replace existing thread section
			newBody = body.substring(0, separatorIndex) + threadSection;
		} else {
			// Append new thread section
			newBody = body + threadSection;
		}

		const newContent = `---\n${parsed.frontmatter}\n---\n${newBody}`;
		if (newContent === content) return false;

		await this.vault.modify(existingFile as any, newContent);
		return true;
	}

	/**
	 * Update an existing grouped note entry with thread replies.
	 * Used when a previously-synced message becomes a thread after initial sync.
	 */
	async updateGroupedNoteThread(
		message: SlackMessage,
		channelName: string,
		userName: string,
		markdownText: string,
		threadReplies: { userName: string; text: string; ts: string }[],
		channelFolderName?: string
	): Promise<boolean> {
		const date = slackTsToDate(message.ts);
		const folderPath = this.getNoteFolderPath(channelName, date, channelFolderName);
		const vars = this.getTemplateVars(message.ts, channelName, userName);
		const fileName = sanitizeFileName(
			applyTemplate(this.settings.groupedFileNameTemplate, vars)
		);
		const filePath = normalizePath(`${folderPath}/${fileName}.md`);

		const existingFile = this.vault.getAbstractFileByPath(filePath);
		if (!existingFile) return false;

		const content = await this.vault.read(existingFile as any);

		const marker = `<!-- ts:${message.ts} -->`;
		const markerIndex = content.indexOf(marker);
		if (markerIndex === -1) return false;

		// Find the end of this message's section (next marker or end of file)
		const afterMarker = markerIndex + marker.length;
		const nextMarkerIndex = content.indexOf('<!-- ts:', afterMarker);
		const sectionEnd = nextMarkerIndex !== -1 ? nextMarkerIndex : content.length;

		// Get the current section content (between this marker and next)
		const sectionContent = content.substring(afterMarker, sectionEnd);

		// Build new thread section
		const threadTitle = markdownText.split('\n')[0].trim() || 'Thread';
		let threadPart = `\n\n#### ${threadTitle}\n\n`;
		for (const reply of threadReplies) {
			const replyDate = slackTsToDate(reply.ts);
			threadPart += `> **${reply.userName}** (${formatTime(replyDate)}):\n> ${reply.text.split('\n').join('\n> ')}\n\n`;
		}

		// Replace or append thread sub-section within this entry
		const threadSubIndex = sectionContent.indexOf('\n\n#### ');
		let newSection: string;
		if (threadSubIndex !== -1) {
			// Replace existing thread sub-section
			newSection = marker + sectionContent.substring(0, threadSubIndex) + threadPart;
		} else {
			// Append thread sub-section
			newSection = marker + sectionContent.trimEnd() + threadPart;
		}

		const newContent = content.substring(0, markerIndex)
			+ newSection
			+ (nextMarkerIndex !== -1 ? '\n' : '')
			+ content.substring(sectionEnd);

		if (newContent.trim() === content.trim()) return false;

		await this.vault.modify(existingFile as any, newContent);
		return true;
	}

	/**
	 * Save an attachment file and return its vault-relative path.
	 */
	async saveAttachment(
		data: ArrayBuffer,
		fileName: string,
		channelName: string,
		channelFolderName?: string
	): Promise<string> {
		const folderPath = this.getAttachmentFolderPath(channelName, channelFolderName);
		await this.ensureFolder(folderPath);

		const sanitized = sanitizeFileName(fileName);
		let filePath = normalizePath(`${folderPath}/${sanitized}`);

		// Handle name collisions by appending a number
		let counter = 1;
		while (await this.vault.adapter.exists(filePath)) {
			const dotIndex = sanitized.lastIndexOf('.');
			if (dotIndex !== -1) {
				const name = sanitized.slice(0, dotIndex);
				const ext = sanitized.slice(dotIndex);
				filePath = normalizePath(`${folderPath}/${name}_${counter}${ext}`);
			} else {
				filePath = normalizePath(`${folderPath}/${sanitized}_${counter}`);
			}
			counter++;
		}

		await this.vault.createBinary(filePath, data);
		return filePath;
	}

	/**
	 * Create an Obsidian embed link for a file.
	 */
	createEmbed(filePath: string): string {
		return `![[${filePath}]]`;
	}

	/**
	 * Create a note for standalone file uploads (files without accompanying text).
	 */
	async createFileNote(
		file: SlackFile,
		channelName: string,
		userName: string,
		ts: string,
		attachmentPath: string,
		channelFolderName?: string
	): Promise<string | null> {
		const date = slackTsToDate(ts);
		const folderPath = this.getNoteFolderPath(channelName, date, channelFolderName);
		const vars = this.getTemplateVars(ts, channelName, userName);

		const fileName = sanitizeFileName(applyTemplate(this.settings.fileNameTemplate, vars));
		const filePath = normalizePath(`${folderPath}/${fileName}.md`);

		if (await this.vault.adapter.exists(filePath)) {
			return null;
		}

		await this.ensureFolder(folderPath);

		const frontmatter = [
			'---',
			'source: Slack',
			`channel: ${channelName}`,
			`author: ${userName}`,
			`date: ${formatDate(date)}`,
			`timestamp: ${ts}`,
			`file_name: ${file.name}`,
			`file_type: ${file.filetype}`,
			'---',
			'',
		].join('\n');

		const title = file.title !== file.name ? `# ${file.title}\n\n` : '';
		const content = frontmatter + title + this.createEmbed(attachmentPath);

		await this.vault.create(filePath, content);
		return filePath;
	}
}
