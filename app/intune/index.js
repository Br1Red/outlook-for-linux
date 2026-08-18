const dbus = require('@homebridge/dbus-native');

let intuneAccount = null;

const BROKER_SERVICE = 'com.microsoft.identity.broker1';
const BROKER_PATH = '/com/microsoft/identity/broker1';
const BROKER_INTERFACE = 'com.microsoft.identity.Broker1';
const PROTOCOL_VERSION = '0.0';
const CLIENT_ID = '88200948-af09-45a1-9c03-53cdcc75c183';

const sessionBus = dbus.sessionBus();

function invokeBrokerMethod(methodName, request, correlationId = '') {
	return new Promise((resolve, reject) => {
		sessionBus.invoke(
			{
				destination: BROKER_SERVICE,
				path: BROKER_PATH,
				interface: BROKER_INTERFACE,
				member: methodName,
				signature: 'sss',
				body: [
					PROTOCOL_VERSION,
					correlationId,
					JSON.stringify(request),
				],
			},
			(err, result) => (err ? reject(err) : resolve(result)),
		);
	});
}

function getCookieContent(response) {
	if (Array.isArray(response.cookieItems) && response.cookieItems.length > 0) {
		return response.cookieItems[0].cookieContent || null;
	}
	return response.cookieContent || null;
}

function parseAccounts(response, requestedUser) {
	if (response.error || !Array.isArray(response.accounts)) {
		return null;
	}

	if (requestedUser) {
		const requestedUserLower = requestedUser.toLowerCase();
		return (
			response.accounts.find(
				(account) => account.username?.toLowerCase() === requestedUserLower,
			) || null
		);
	}

	return response.accounts[0] || null;
}

async function getAccounts() {
	return invokeBrokerMethod('getAccounts', {
		clientId: CLIENT_ID,
		redirectUri: 'urn:ietf:oob',
	});
}

exports.initSso = async function initSso(requestedUser = '') {
	intuneAccount = null;

	try {
		const response = JSON.parse(await getAccounts());
		intuneAccount = parseAccounts(response, requestedUser);
		if (intuneAccount) {
			console.info('[INTUNE] Microsoft Identity Broker account selected');
		} else {
			console.warn('[INTUNE] No matching Identity Broker account found');
		}
	} catch (error) {
		console.warn('[INTUNE] Identity Broker unavailable', error.message || error);
	}
};

exports.isEnabled = function isEnabled() {
	return intuneAccount != null;
};

exports.setupUrlFilter = function setupUrlFilter(filter) {
	filter.urls.push('https://login.microsoftonline.com/*');
};

exports.isSsoUrl = function isSsoUrl(url) {
	return intuneAccount != null && url.startsWith('https://login.microsoftonline.com/');
};

exports.attachToSession = function attachToSession(browserSession) {
	browserSession.webRequest.onBeforeSendHeaders(
		{ urls: ['https://login.microsoftonline.com/*'] },
		exports.addSsoCookie,
	);
};

function buildRequest(url) {
	return {
		account: intuneAccount,
		authParameters: {
			account: intuneAccount,
			additionalQueryParametersForAuthorization: {},
			authority: 'https://login.microsoftonline.com/common',
			authorizationType: 8,
			clientId: 'd7b530a4-7680-4c23-a8bf-c52c121d2e87',
			redirectUri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
			requestedScopes: ['openid', 'profile', 'offline_access'],
			username: intuneAccount.username,
			uxContextHandle: -1,
			ssoUrl: url,
		},
		mamEnrollment: false,
		ssoUrl: url,
	};
}

exports.addSsoCookie = async function addSsoCookie(detail, callback) {
	if (!intuneAccount) {
		callback({ requestHeaders: detail.requestHeaders });
		return;
	}

	try {
		const response = JSON.parse(
			await invokeBrokerMethod('acquirePrtSsoCookie', buildRequest(detail.url)),
		);
		const cookieContent = getCookieContent(response);
		if (cookieContent) {
			detail.requestHeaders['X-Ms-Refreshtokencredential'] = cookieContent;
		}
	} catch (error) {
		console.warn('[INTUNE] Failed to acquire SSO cookie', error.message || error);
	}

	callback({ requestHeaders: detail.requestHeaders });
};