import { requestUrl, RequestUrlParam } from 'obsidian';
import { SLACK_ENDPOINTS, SYNC_BATCH_SIZE, USER_CACHE_TTL } from './constants';
import { SlackApiResponse, SlackChannel, SlackMessage, SlackUser } from './types';

export class SlackApiClient {
	private token: string;
	private userCache: Map<string, { user: SlackUser; fetchedAt: number }> = new Map();

	constructor(token: string) {
		this.token = token;
	}

	setToken(token: string): void {
		this.token = token;
		this.userCache.clear();
	}

	private async apiCall<T>(url: string, params?: Record<string, string>): Promise<SlackApiResponse<T>> {
		const queryParams = new URLSearchParams(params || {});
		const fullUrl = params ? `${url}?${queryParams.toString()}` : url;

		const requestParams: RequestUrlParam = {
			url: fullUrl,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this.token}`,
				'Content-Type': 'application/json; charset=utf-8',
			},
		};

		const response = await requestUrl(requestParams);
		const data = response.json as SlackApiResponse<T>;

		if (!data.ok) {
			throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
		}

		return data;
	}

	async testAuth(): Promise<{ ok: boolean; team?: string; user?: string; error?: string }> {
		try {
			const response = await requestUrl({
				url: SLACK_ENDPOINTS.AUTH_TEST,
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.token}`,
					'Content-Type': 'application/json; charset=utf-8',
				},
			});
			const data = response.json;
			return {
				ok: data.ok,
				team: data.team,
				user: data.user,
				error: data.error,
			};
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}

	async listChannels(): Promise<SlackChannel[]> {
		const allChannels: SlackChannel[] = [];
		let cursor: string | undefined;

		do {
			const params: Record<string, string> = {
				types: 'public_channel,private_channel',
				exclude_archived: 'true',
				limit: '200',
			};
			if (cursor) {
				params.cursor = cursor;
			}

			const response = await this.apiCall<SlackChannel[]>(
				SLACK_ENDPOINTS.CONVERSATIONS_LIST,
				params
			);

			if (response.channels) {
				allChannels.push(...response.channels);
			}

			cursor = response.response_metadata?.next_cursor;
		} while (cursor);

		return allChannels;
	}

	async getChannelHistory(
		channelId: string,
		oldest?: string,
		limit: number = SYNC_BATCH_SIZE
	): Promise<{ messages: SlackMessage[]; hasMore: boolean; nextCursor?: string }> {
		const params: Record<string, string> = {
			channel: channelId,
			limit: limit.toString(),
		};
		if (oldest) {
			params.oldest = oldest;
		}

		const response = await this.apiCall<SlackMessage[]>(
			SLACK_ENDPOINTS.CONVERSATIONS_HISTORY,
			params
		);

		return {
			messages: response.messages || [],
			hasMore: !!response.response_metadata?.next_cursor,
			nextCursor: response.response_metadata?.next_cursor,
		};
	}

	async getThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
		const params: Record<string, string> = {
			channel: channelId,
			ts: threadTs,
			limit: '200',
		};

		const response = await this.apiCall<SlackMessage[]>(
			SLACK_ENDPOINTS.CONVERSATIONS_REPLIES,
			params
		);

		// First message is the parent, rest are replies
		const messages = response.messages || [];
		return messages.length > 1 ? messages.slice(1) : [];
	}

	/**
	 * Fetch a thread including the parent message and all replies.
	 */
	async getThread(channelId: string, threadTs: string): Promise<{ parent: SlackMessage; replies: SlackMessage[] }> {
		const params: Record<string, string> = {
			channel: channelId,
			ts: threadTs,
			limit: '200',
		};

		const response = await this.apiCall<SlackMessage[]>(
			SLACK_ENDPOINTS.CONVERSATIONS_REPLIES,
			params
		);

		const messages = response.messages || [];
		if (messages.length === 0) {
			throw new Error(`Thread ${threadTs} not found`);
		}

		return {
			parent: messages[0],
			replies: messages.slice(1),
		};
	}

	async getUserInfo(userId: string): Promise<SlackUser> {
		const cached = this.userCache.get(userId);
		if (cached && Date.now() - cached.fetchedAt < USER_CACHE_TTL) {
			return cached.user;
		}

		const response = await this.apiCall<SlackUser>(
			SLACK_ENDPOINTS.USERS_INFO,
			{ user: userId }
		);

		const user: SlackUser = {
			id: userId,
			name: response.user?.name || userId,
			real_name: response.user?.real_name || response.user?.profile?.real_name,
			display_name: response.user?.profile?.display_name,
		};

		this.userCache.set(userId, { user, fetchedAt: Date.now() });
		return user;
	}

	getUserDisplayName(user: SlackUser): string {
		return user.display_name || user.real_name || user.name;
	}

	async downloadFile(url: string): Promise<ArrayBuffer> {
		const response = await requestUrl({
			url: url,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this.token}`,
			},
		});

		return response.arrayBuffer;
	}
}
