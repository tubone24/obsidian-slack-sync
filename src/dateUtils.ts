/**
 * Convert a Slack timestamp (e.g., "1694505278.000000") to a Date object.
 */
export function slackTsToDate(ts: string): Date {
	const epochSeconds = parseFloat(ts);
	return new Date(epochSeconds * 1000);
}

/**
 * Format a date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Format a date as YYYYMMDD.
 */
export function formatDateCompact(date: Date): string {
	return formatDate(date).replace(/-/g, '');
}

/**
 * Format a time as HH:MM:SS.
 */
export function formatTime(date: Date): string {
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format a time as HHMMSS (no separators).
 */
export function formatTimeCompact(date: Date): string {
	return formatTime(date).replace(/:/g, '');
}

/**
 * Format a datetime as YYYYMMDDHHMMSS.
 */
export function formatDateTimeCompact(date: Date): string {
	return formatDateCompact(date) + formatTimeCompact(date);
}

/**
 * Get the date folder path components: YYYY/MM/DD.
 */
export function getDateFolderPath(date: Date): string {
	const year = date.getFullYear().toString();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}/${month}/${day}`;
}

/**
 * Apply template variables to a template string.
 */
export function applyTemplate(
	template: string,
	vars: Record<string, string>
): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
	}
	return result;
}

/**
 * Sanitize a string for use as a filename.
 */
export function sanitizeFileName(name: string): string {
	return name
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 200);
}
