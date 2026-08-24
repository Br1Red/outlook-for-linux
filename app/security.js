const TRUSTED_HOST_SUFFIXES = [
	'.microsoft.com',
	'.microsoftonline.com',
	'.office.com',
	'.office365.com',
	'.live.com',
	'.cloud.microsoft',
];

function isTrustedWebContents(webContents, config) {
	if (!webContents || webContents.isDestroyed()) return false;

	const url = webContents.getURL();
	if (url.startsWith('file://')) {
		return url.includes('/accountManager/tabbar.html');
	}
	return isTrustedUrl(url, config);
}

function isValidAccountId(value) {
	return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

function isValidPartition(value) {
	return (
		typeof value === 'string' &&
		value.length <= 200 &&
		/^[A-Za-z0-9:_-]+$/.test(value)
	);
}

function isValidCount(value) {
	return Number.isInteger(value) && value >= 0 && value <= 1000000;
}

function isValidText(value, maxLength = 10000) {
	return typeof value === 'string' && value.length <= maxLength;
}

module.exports = {
	isTrustedWebContents,
	isTrustedUrl,
	isSafeExternalUrl,
	isValidAccountId,
	isValidPartition,
	isValidCount,
	isValidText,
};
function isTrustedUrl(url, config) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		const configuredHost = new URL(config.url).hostname.toLowerCase();
		const host = parsed.hostname.toLowerCase();
		return (
			host === configuredHost ||
			host.endsWith(`.${configuredHost}`) ||
			TRUSTED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
		);
	} catch (_) {
		return false;
	}
}
function isSafeExternalUrl(url) {
	try {
		const protocol = new URL(url).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch (_) {
		return false;
	}
}
