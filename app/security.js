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
	isLoginPageUrl,
	isExternalNavigation,
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
function isLoginPageUrl(url, config) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		return (
			parsed.hostname.toLowerCase().startsWith('login.') &&
			isTrustedUrl(url, config)
		);
	} catch (_) {
		return false;
	}
}
// A navigation belongs to the external browser only when it targets a host we
// do not trust AND we are not in the middle of a sign-in flow. Microsoft
// sign-in hands the user off to the tenant's own identity provider (ADFS,
// Okta, ...), whose host cannot be known ahead of time; those hops must stay
// in the account window or it is left stranded on "Jumping to your company's
// login page" while the browser takes over.
function isExternalNavigation(targetUrl, currentUrl, config) {
	if (isTrustedUrl(targetUrl, config)) return false;

	let current;
	try {
		current = new URL(currentUrl);
	} catch (_) {
		return true;
	}
	if (current.protocol !== 'http:' && current.protocol !== 'https:') return true;

	// On a Microsoft login page, or already on the identity provider's own
	// (untrusted) pages, keep the flow inside the app.
	if (isTrustedUrl(currentUrl, config)) return !isLoginPageUrl(currentUrl, config);
	return false;
}
