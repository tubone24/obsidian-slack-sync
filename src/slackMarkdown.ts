import { SlackUser } from './types';

/**
 * Convert Slack mrkdwn format to standard Markdown.
 * Handles bold, italic, strikethrough, links, user/channel mentions, and code blocks.
 */
export function slackMrkdwnToMarkdown(
	text: string,
	userResolver?: (userId: string) => string
): string {
	if (!text) return '';

	let result = text;

	// Preserve code blocks before other transformations
	const codeBlocks: string[] = [];
	result = result.replace(/```([\s\S]*?)```/g, (_match, code) => {
		const index = codeBlocks.length;
		codeBlocks.push(code);
		return `\x00CODEBLOCK${index}\x00`;
	});

	// Preserve inline code
	const inlineCode: string[] = [];
	result = result.replace(/`([^`]+)`/g, (_match, code) => {
		const index = inlineCode.length;
		inlineCode.push(code);
		return `\x00INLINECODE${index}\x00`;
	});

	// Convert Slack links: <url|text> -> [text](url)
	result = result.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)');

	// Convert plain URLs: <url> -> url
	result = result.replace(/<(https?:\/\/[^>]+)>/g, '$1');

	// Convert mailto links: <mailto:email|text> -> [text](mailto:email)
	result = result.replace(/<mailto:([^|>]+)\|([^>]+)>/g, '[$2](mailto:$1)');

	// Convert user mentions: <@U123> -> @username
	result = result.replace(/<@([A-Z0-9]+)>/g, (_match, userId) => {
		if (userResolver) {
			const name = userResolver(userId);
			return `@${name}`;
		}
		return `@${userId}`;
	});

	// Convert channel mentions: <#C123|channel-name> -> #channel-name
	result = result.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');

	// Convert channel mentions without name: <#C123> -> #C123
	result = result.replace(/<#([A-Z0-9]+)>/g, '#$1');

	// Convert special commands: <!here>, <!channel>, <!everyone>
	result = result.replace(/<!here>/g, '@here');
	result = result.replace(/<!channel>/g, '@channel');
	result = result.replace(/<!everyone>/g, '@everyone');

	// Convert bold: *text* -> **text** (only when not inside a word)
	result = result.replace(/(^|\s)\*([^*\n]+)\*(\s|$|[.,!?;:])/g, '$1**$2**$3');

	// Convert italic: _text_ -> *text* (only when not inside a word)
	result = result.replace(/(^|\s)_([^_\n]+)_(\s|$|[.,!?;:])/g, '$1*$2*$3');

	// Convert strikethrough: ~text~ -> ~~text~~
	result = result.replace(/(^|\s)~([^~\n]+)~(\s|$|[.,!?;:])/g, '$1~~$2~~$3');

	// Convert blockquote: &gt; text -> > text (Slack encodes > as &gt;)
	result = result.replace(/^&gt;\s?/gm, '> ');

	// Restore code blocks
	result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, (_match, index) => {
		return '```' + codeBlocks[parseInt(index)] + '```';
	});

	// Restore inline code
	result = result.replace(/\x00INLINECODE(\d+)\x00/g, (_match, index) => {
		return '`' + inlineCode[parseInt(index)] + '`';
	});

	return result;
}

/**
 * Create a user resolver function from a map of userId -> SlackUser.
 */
export function createUserResolver(users: Map<string, SlackUser>): (userId: string) => string {
	return (userId: string) => {
		const user = users.get(userId);
		if (user) {
			return user.display_name || user.real_name || user.name;
		}
		return userId;
	};
}
