import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
} from 'obsidian';
import { SlackSyncSettings, ChannelConfig, SlackChannel } from './types';
import { DEFAULT_SETTINGS, SLACK_BOT_TOKEN_SECRET_ID } from './constants';
import { SlackApiClient } from './slackApi';
import { FileManager } from './fileManager';
import { SyncEngine } from './syncEngine';

export default class SlackSyncPlugin extends Plugin {
	settings: SlackSyncSettings = DEFAULT_SETTINGS;
	api: SlackApiClient = new SlackApiClient('');
	private fileManager!: FileManager;
	syncEngine!: SyncEngine;
	private autoSyncInterval: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.migrateTokenToSecretStorage();

		const token = this.getToken();
		this.api = new SlackApiClient(token);
		this.fileManager = new FileManager(this.app.vault, this.settings);
		this.syncEngine = new SyncEngine(this.api, this.fileManager, this.settings);

		// Add ribbon icon for manual sync
		const ribbonIconEl = this.addRibbonIcon(
			'refresh-cw',
			'Sync Slack messages',
			async () => {
				await this.runSync();
			}
		);

		// Add command for manual sync
		this.addCommand({
			id: 'sync-slack-messages',
			name: 'Sync Slack messages',
			callback: async () => {
				await this.runSync();
			},
		});

		// Add settings tab
		this.addSettingTab(new SlackSyncSettingTab(this.app, this));

		// Set up auto-sync
		this.setupAutoSync();

		// Sync on startup if enabled
		if (this.settings.syncOnStartup && token) {
			// Delay startup sync slightly to let Obsidian finish loading
			setTimeout(() => this.runSync(), 5000);
		}
	}

	onunload(): void {
		this.clearAutoSync();
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		if (data) {
			// Strip legacy plaintext token so it never leaks back to data.json
			delete data.slackBotToken;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.api.setToken(this.getToken());
		this.syncEngine.updateSettings(this.settings);
		this.setupAutoSync();
	}

	getToken(): string {
		return this.app.secretStorage.getSecret(SLACK_BOT_TOKEN_SECRET_ID) ?? '';
	}

	setToken(token: string): void {
		this.app.secretStorage.setSecret(SLACK_BOT_TOKEN_SECRET_ID, token);
		this.api.setToken(token);
	}

	/**
	 * Migrate token from data.json (pre-1.11.4) to SecretStorage.
	 * Removes the plaintext token from data.json after migration.
	 */
	private async migrateTokenToSecretStorage(): Promise<void> {
		const data = await this.loadData();
		if (data && data.slackBotToken) {
			const existing = this.app.secretStorage.getSecret(SLACK_BOT_TOKEN_SECRET_ID);
			if (!existing) {
				this.app.secretStorage.setSecret(SLACK_BOT_TOKEN_SECRET_ID, data.slackBotToken);
			}
			// Remove plaintext token from data.json
			delete data.slackBotToken;
			await this.saveData(data);
		}
	}

	private setupAutoSync(): void {
		this.clearAutoSync();
		const token = this.getToken();
		if (this.settings.autoSync && token) {
			const intervalMs = Math.max(1, this.settings.syncInterval) * 60 * 1000;
			this.autoSyncInterval = window.setInterval(() => {
				this.runSync();
			}, intervalMs);
			this.registerInterval(this.autoSyncInterval);
		}
	}

	private clearAutoSync(): void {
		if (this.autoSyncInterval !== null) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	private async runSync(): Promise<void> {
		if (!this.getToken()) {
			new Notice('Slack Sync: Please configure your Slack Bot Token in settings');
			return;
		}
		try {
			await this.syncEngine.syncAll(() => this.saveSettings());
		} catch (e) {
			console.error('Slack Sync error:', e);
			new Notice(`Slack Sync error: ${(e as Error).message}`);
		}
	}
}

class SlackSyncSettingTab extends PluginSettingTab {
	plugin: SlackSyncPlugin;
	private availableChannels: SlackChannel[] = [];

	constructor(app: App, plugin: SlackSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ──────── Connection ────────
		containerEl.createEl('h2', { text: 'Connection' });

		new Setting(containerEl)
			.setName('Slack Bot Token')
			.setDesc('Your Slack app Bot User OAuth Token (xoxb-...). Stored securely outside your vault.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text
					.setPlaceholder('xoxb-...')
					.setValue(this.plugin.getToken())
					.onChange(async (value) => {
						this.plugin.setToken(value.trim());
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Verify that the Bot Token is valid')
			.addButton((button) =>
				button.setButtonText('Test').onClick(async () => {
					if (!this.plugin.getToken()) {
						new Notice('Please enter a Bot Token first');
						return;
					}
					button.setDisabled(true);
					button.setButtonText('Testing...');
					try {
						const result = await this.plugin.api.testAuth();
						if (result.ok) {
							new Notice(
								`Connected to workspace: ${result.team} (as ${result.user})`
							);
						} else {
							new Notice(`Connection failed: ${result.error}`);
						}
					} catch (e) {
						new Notice(`Connection failed: ${(e as Error).message}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Test');
					}
				})
			);

		// ──────── Channels ────────
		containerEl.createEl('h2', { text: 'Channels' });

		new Setting(containerEl)
			.setName('Fetch Channels')
			.setDesc('Load available channels from your Slack workspace')
			.addButton((button) =>
				button.setButtonText('Fetch Channels').onClick(async () => {
					if (!this.plugin.getToken()) {
						new Notice('Please enter a Bot Token first');
						return;
					}
					button.setDisabled(true);
					button.setButtonText('Fetching...');
					try {
						this.availableChannels = await this.plugin.api.listChannels();
						new Notice(
							`Found ${this.availableChannels.length} channel(s)`
						);
						this.display(); // Refresh the settings UI
					} catch (e) {
						new Notice(
							`Failed to fetch channels: ${(e as Error).message}`
						);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Fetch Channels');
					}
				})
			);

		// Show configured channels
		const configuredChannels = this.plugin.settings.channels;
		if (configuredChannels.length > 0) {
			const channelListEl = containerEl.createDiv('slack-sync-channel-list');
			channelListEl.createEl('h3', { text: 'Configured Channels' });

			for (const channel of configuredChannels) {
				const channelSetting = new Setting(channelListEl)
					.setName(`#${channel.name}`)
					.setDesc(channel.id);

				channelSetting.addToggle((toggle) =>
					toggle.setValue(channel.enabled).onChange(async (value) => {
						channel.enabled = value;
						await this.plugin.saveSettings();
					})
				);

				channelSetting.addText((text) =>
					text
						.setPlaceholder('Custom folder name')
						.setValue(channel.folderName || '')
						.onChange(async (value) => {
							channel.folderName = value.trim() || undefined;
							await this.plugin.saveSettings();
						})
				);

				channelSetting.addExtraButton((button) => {
					button.setIcon('trash').setTooltip('Remove channel');
					button.onClick(async () => {
						this.plugin.settings.channels =
							this.plugin.settings.channels.filter(
								(c) => c.id !== channel.id
							);
						delete this.plugin.settings.lastSyncTimestamps[channel.id];
						await this.plugin.saveSettings();
						this.display();
					});
				});
			}
		}

		// Show available channels to add
		if (this.availableChannels.length > 0) {
			const addChannelEl = containerEl.createDiv('slack-sync-add-channel');
			addChannelEl.createEl('h3', { text: 'Available Channels' });

			const configuredIds = new Set(
				this.plugin.settings.channels.map((c) => c.id)
			);
			const unconfigured = this.availableChannels.filter(
				(c) => !configuredIds.has(c.id)
			);

			if (unconfigured.length === 0) {
				addChannelEl.createEl('p', {
					text: 'All available channels have been added.',
					cls: 'setting-item-description',
				});
			}

			for (const channel of unconfigured) {
				const label = channel.is_private
					? `🔒 ${channel.name}`
					: `#${channel.name}`;

				new Setting(addChannelEl).setName(label).addButton((button) =>
					button.setButtonText('Add').onClick(async () => {
						const newChannel: ChannelConfig = {
							id: channel.id,
							name: channel.name,
							enabled: true,
						};
						this.plugin.settings.channels.push(newChannel);
						await this.plugin.saveSettings();
						this.display();
					})
				);
			}
		}

		// ──────── Sync Behavior ────────
		containerEl.createEl('h2', { text: 'Sync Behavior' });

		new Setting(containerEl)
			.setName('Auto Sync')
			.setDesc('Automatically sync messages at a regular interval')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSync)
					.onChange(async (value) => {
						this.plugin.settings.autoSync = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.autoSync) {
			new Setting(containerEl)
				.setName('Sync Interval (minutes)')
				.setDesc('How often to auto-sync (1-360 minutes)')
				.addSlider((slider) =>
					slider
						.setLimits(1, 360, 1)
						.setValue(this.plugin.settings.syncInterval)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.syncInterval = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName('Sync on Startup')
			.setDesc('Sync messages when Obsidian starts')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.syncOnStartup = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Sync Thread Replies')
			.setDesc('Include thread replies in the parent message note')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncThreadReplies)
					.onChange(async (value) => {
						this.plugin.settings.syncThreadReplies = value;
						await this.plugin.saveSettings();
					})
			);

		// ──────── File Organization ────────
		containerEl.createEl('h2', { text: 'File Organization' });

		new Setting(containerEl)
			.setName('Note Folder Path')
			.setDesc('Root folder for synced notes')
			.addText((text) =>
				text
					.setPlaceholder('Slack')
					.setValue(this.plugin.settings.noteFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.noteFolderPath =
							value.trim() || 'Slack';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Attachment Folder Path')
			.setDesc('Root folder for downloaded files and images')
			.addText((text) =>
				text
					.setPlaceholder('Slack/attachments')
					.setValue(this.plugin.settings.attachmentFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolderPath =
							value.trim() || 'Slack/attachments';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Organize by Date')
			.setDesc('Create YYYY/MM/DD subfolders for notes')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.organizeByDate)
					.onChange(async (value) => {
						this.plugin.settings.organizeByDate = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('File Name Template')
			.setDesc(
				'Template for note file names. Variables: {date}, {datecompact}, {time}, {timecompact}, {datetime}, {ts}, {channelName}, {userName}'
			)
			.addText((text) =>
				text
					.setPlaceholder('{date}-{channelName}-{ts}')
					.setValue(this.plugin.settings.fileNameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.fileNameTemplate =
							value.trim() || '{date}-{channelName}-{ts}';
						await this.plugin.saveSettings();
					})
			);

		// ──────── Message Grouping ────────
		containerEl.createEl('h2', { text: 'Message Grouping' });

		new Setting(containerEl)
			.setName('Group Messages by Date')
			.setDesc(
				'Combine all messages from the same day into a single note'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.groupMessagesByDate)
					.onChange(async (value) => {
						this.plugin.settings.groupMessagesByDate = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.groupMessagesByDate) {
			new Setting(containerEl)
				.setName('Grouped File Name Template')
				.setDesc('Template for grouped note file names')
				.addText((text) =>
					text
						.setPlaceholder('{date}-{channelName}')
						.setValue(
							this.plugin.settings.groupedFileNameTemplate
						)
						.onChange(async (value) => {
							this.plugin.settings.groupedFileNameTemplate =
								value.trim() || '{date}-{channelName}';
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Grouped Frontmatter Template')
				.setDesc(
					'YAML frontmatter template for grouped notes. Variables: {date}, {channelName}'
				)
				.addTextArea((text) =>
					text
						.setPlaceholder(
							'source: Slack\nchannel: {channelName}\ndate: {date}'
						)
						.setValue(
							this.plugin.settings.groupedFrontmatterTemplate
						)
						.onChange(async (value) => {
							this.plugin.settings.groupedFrontmatterTemplate =
								value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Grouped Message Template')
				.setDesc(
					'Template for each message in a grouped note. Variables: {userName}, {time}, {text}'
				)
				.addText((text) =>
					text
						.setPlaceholder(
							'**{userName}** ({time}):\n{text}'
						)
						.setValue(
							this.plugin.settings.groupedMessageTemplate
						)
						.onChange(async (value) => {
							this.plugin.settings.groupedMessageTemplate =
								value || '**{userName}** ({time}):\n{text}';
							await this.plugin.saveSettings();
						})
				);
		}

		// ──────── Manual Actions ────────
		containerEl.createEl('h2', { text: 'Actions' });

		new Setting(containerEl)
			.setName('Sync Now')
			.setDesc('Manually trigger a sync of all enabled channels')
			.addButton((button) =>
				button
					.setButtonText('Sync Now')
					.setCta()
					.onClick(async () => {
						if (!this.plugin.getToken()) {
							new Notice(
								'Please configure a Bot Token first'
							);
							return;
						}
						button.setDisabled(true);
						button.setButtonText('Syncing...');
						try {
							await this.plugin.syncEngine.syncAll(() =>
								this.plugin.saveSettings()
							);
						} catch (e) {
							console.error('Slack Sync error:', e);
							new Notice(`Slack Sync error: ${(e as Error).message}`);
						} finally {
							button.setDisabled(false);
							button.setButtonText('Sync Now');
						}
					})
			);

		new Setting(containerEl)
			.setName('Clear Sync History')
			.setDesc(
				'Reset sync timestamps so the next sync fetches all available messages'
			)
			.addButton((button) =>
				button.setButtonText('Clear').setWarning().onClick(async () => {
					this.plugin.settings.lastSyncTimestamps = {};
					await this.plugin.saveSettings();
					new Notice('Sync history cleared');
				})
			);
	}
}
