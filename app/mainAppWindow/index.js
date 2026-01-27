require('@electron/remote/main').initialize();
const { shell, BrowserWindow, app, session, nativeTheme, dialog } = require('electron');
const isDarkMode = nativeTheme.shouldUseDarkColors;
const windowStateKeeper = require('electron-window-state');
const path = require('path');
const login = require('../login');
const Menus = require('../menus');
const { LucidLog } = require('lucid-log');
const exec = require('child_process').exec;
const TrayIconChooser = require('../browser/tools/trayIconChooser');
// eslint-disable-next-line no-unused-vars
const { AppConfiguration } = require('../appConfiguration');
const connMgr = require('../connectionManager');
const notificationModule = require('../notification');

/**
 * @type {TrayIconChooser}
 */
let iconChooser;

let isControlPressed = false;

/**
 * @type {LucidLog}
 */
let logger;

let aboutBlankRequestCount = 0;
let config;

/**
 * @type {BrowserWindow}
 */
let window = null;

/**
 * @param {AppConfiguration} mainConfig 
 */
exports.onAppReady = async function onAppReady(mainConfig) {
	config = mainConfig.startupConfig;
	iconChooser = new TrayIconChooser(mainConfig.startupConfig);
	logger = new LucidLog({
		levels: config.appLogLevels.split(',')
	});

	window = await createWindow();

	const menus = new Menus(window, config, iconChooser.getFile(), mainConfig);

	// Initialize notification module with window, icon, and menus (for badge updates)
	notificationModule.init(window, iconChooser.getFile(), menus);

	addEventHandlers();

	const result = processArgs(process.argv);
	if (result && result.isMailto) {
		// Open mailto in new compose window
		openComposeWindow(result.url);
		// Start with default URL
		connMgr.start(null, {
			window: window,
			config: config
		});
	} else {
		// Start with the provided URL or default
		connMgr.start(result ? result.url : null, {
			window: window,
			config: config
		});
	}

	applyAppConfiguration(config, window);
};

let allowFurtherRequests = true;

exports.onAppSecondInstance = function onAppSecondInstance(event, args) {
	logger.debug('second-instance started');
	if (window) {
		event.preventDefault();
		const result = processArgs(args);
		if (result && allowFurtherRequests) {
			allowFurtherRequests = false;
			setTimeout(() => { allowFurtherRequests = true; }, 5000);

			if (result.isMailto) {
				// Open mailto links in new compose window
				openComposeWindow(result.url);
			} else {
				// Load other URLs in main window
				window.loadURL(result.url, { userAgent: config.chromeUserAgent });
			}
		}

		restoreWindow();
	}
};

/**
 * Applies the configuration passed as arguments when executing the app.
 * @param config Configuration object.
 * @param {BrowserWindow} window The browser window.
 */
function applyAppConfiguration(config, window) {
	if (typeof config.clientCertPath !== 'undefined' && config.clientCertPath !== '') {
		app.importCertificate({ certificate: config.clientCertPath, password: config.clientCertPassword }, (result) => {
			logger.info('Loaded certificate: ' + config.clientCertPath + ', result: ' + result);
		});
	}

	window.webContents.setUserAgent(config.chromeUserAgent);

	if (!config.minimized) {
		window.show();
	} else {
		window.hide();
	}

	if (config.webDebug) {
		window.openDevTools();
	}
}

function restoreWindow() {
	// If minimized, restore.
	if (window.isMinimized()) {
		window.restore();
	}

	// If closed to tray, show.
	else if (!window.isVisible()) {
		window.show();
	}

	window.focus();
}

function processArgs(args) {
	var regHttps = /^https:\/\/outlook.microsoft.com\/l\/(meetup-join|channel)\//g;
	var regMS = /^msoutlook:\/l\/(meetup-join|channel)\//g;
	var regMailto = /^mailto:/i;
	logger.debug('processArgs:', args);
	for (const arg of args) {
		if (regHttps.test(arg)) {
			logger.debug('A url argument received with https protocol');
			window.show();
			return { url: arg, isMailto: false };
		}
		if (regMS.test(arg)) {
			logger.debug('A url argument received with msoutlook protocol');
			window.show();
			return { url: config.url + arg.substring(8, arg.length), isMailto: false };
		}
		if (regMailto.test(arg)) {
			logger.debug('A mailto argument received');
			window.show();
			// Convert mailto: URL to Outlook compose URL
			return { url: convertMailtoToOutlookURL(arg), isMailto: true };
		}
	}
}

/**
 * Open a new compose window with the given URL
 * @param {string} url - Outlook compose URL
 */
function openComposeWindow(url) {
	const composeWindow = new BrowserWindow({
		width: 1000,
		height: 800,
		backgroundColor: isDarkMode ? '#302a75' : '#fff',
		show: false,
		autoHideMenuBar: true,
		icon: iconChooser.getFile(),
		webPreferences: {
			partition: config.partition,
			preload: path.join(__dirname, '..', 'browser', 'index.js'),
			contextIsolation: false,
			sandbox: false,
			spellcheck: false
		}
	});

	require('@electron/remote/main').enable(composeWindow.webContents);

	composeWindow.once('ready-to-show', () => {
		composeWindow.show();
	});

	composeWindow.loadURL(url, { userAgent: config.chromeUserAgent });

	logger.debug('Compose window opened with URL:', url);
}

/**
 * Convert mailto: URL to Outlook compose URL
 * @param {string} mailtoUrl - mailto URL (e.g., mailto:user@example.com?subject=Hello)
 * @returns {string} Outlook compose URL
 */
function convertMailtoToOutlookURL(mailtoUrl) {
	try {
		// Remove 'mailto:' prefix
		const mailtoContent = mailtoUrl.substring(7);

		// Parse the mailto URL
		const [recipient, queryString] = mailtoContent.split('?');

		// Build Outlook compose URL
		let outlookUrl = config.url;
		if (!outlookUrl.endsWith('/')) {
			outlookUrl += '/';
		}
		outlookUrl += 'mail/deeplink/compose?';

		// Add recipient
		if (recipient) {
			outlookUrl += `to=${encodeURIComponent(recipient)}`;
		}

		// Add other parameters
		// NOTE: Outlook uses ? for cc/bcc and & for subject/body (weird format)
		if (queryString) {
			const params = new URLSearchParams(queryString);

			// cc and bcc use ? separator
			if (params.has('cc')) {
				outlookUrl += `?cc=${params.get('cc')}`;
			}
			if (params.has('bcc')) {
				outlookUrl += `?bcc=${params.get('bcc')}`;
			}

			// subject and body use & separator
			if (params.has('subject')) {
				outlookUrl += `&subject=${encodeURIComponent(params.get('subject'))}`;
			}
			if (params.has('body')) {
				outlookUrl += `&body=${encodeURIComponent(params.get('body'))}`;
			}
		}

		logger.debug('Converted mailto URL to:', outlookUrl);
		return outlookUrl;
	} catch (err) {
		logger.error('Error converting mailto URL:', err);
		return config.url;
	}
}

/**
 * @param {Electron.OnBeforeRequestListenerDetails} details
 * @param {Electron.CallbackResponse} callback
 */
function onBeforeRequestHandler(details, callback) {
	// Always allow Outlook URLs to load
	if (isOutlookWindow(details.url)) {
		callback({});
		return;
	}

	// Block telemetry/analytics requests (don't open in browser, just cancel)
	if (isTelemetryUrl(details.url)) {
		logger.debug('Blocking telemetry request: ' + details.url);
		aboutBlankRequestCount = Math.max(0, aboutBlankRequestCount - 1); // Decrement but don't go negative
		callback({ cancel: true });
		return;
	}

	// Check if the counter was incremented
	if (aboutBlankRequestCount < 1) {
		// Proceed normally
		callback({});
	} else {
		// Open the request externally
		logger.debug('DEBUG - webRequest to  ' + details.url + ' intercepted!');
		shell.openExternal(details.url);
		// decrement the counter
		aboutBlankRequestCount -= 1;
		callback({ cancel: true });
	}
}

/**
 * @param {Electron.HandlerDetails} details
 * @returns {{action: 'deny'} | {action: 'allow', outlivesOpener?: boolean, overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions}}
 */
function onNewWindow(details) {
	if (details.url === 'about:blank' || details.url === 'about:blank#blocked') {
		// Check if this is a compose window by looking at window features
		const isComposeWindow = details.features && (
			details.features.includes('width=800') ||
			details.features.includes('resizable=1')
		);

		if (isComposeWindow) {
			// Allow the window to open, then it will load Outlook content
			return {
				action: 'allow',
				overrideBrowserWindowOptions: {
					width: 800,
					height: 700,
					show: true,
					autoHideMenuBar: true,
					webPreferences: {
						partition: config.partition,
						contextIsolation: false,
						sandbox: false
					}
				}
			};
		}

		// Regular about:blank for external links
		aboutBlankRequestCount += 1;
		logger.debug('DEBUG - captured about:blank');
		return { action: 'deny' };
	}

	return secureOpenLink(details);
}

function onWindowClosed() {
	logger.debug('window closed');
	window = null;
	app.quit();
}

function addEventHandlers() {
	window.webContents.setWindowOpenHandler(onNewWindow);
	window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, onBeforeRequestHandler);
	login.handleLoginDialogTry(window);
	window.on('closed', onWindowClosed);
	window.webContents.addListener('before-input-event', onBeforeInput);
	window.webContents.on('context-menu', onContextMenu);
}

/**
 * @param {Electron.Event} event
 * @param {Electron.Input} input
 */
function onBeforeInput(event, input) {
	isControlPressed = input.control;

	// Handle Ctrl+Home to go back to home page (for stuck session screens)
	if (input.control && input.key === 'Home' && input.type === 'keyDown') {
		logger.debug('Ctrl+Home pressed, navigating to home');
		window.loadURL(config.url, { userAgent: config.chromeUserAgent });
		event.preventDefault();
	}
}

/**
 * Handle context menu (right-click)
 * @param {Electron.Event} event
 * @param {Electron.ContextMenuParams} params
 */
function onContextMenu(event, params) {
	const { Menu, MenuItem } = require('electron');
	const menu = new Menu();

	// Add "Reload" option
	menu.append(new MenuItem({
		label: 'Reload Page',
		accelerator: 'Ctrl+R',
		click: () => {
			window.reload();
		}
	}));

	// Add "Go to Home" option
	menu.append(new MenuItem({
		label: 'Go to Home',
		accelerator: 'Ctrl+Home',
		click: () => {
			window.loadURL(config.url, { userAgent: config.chromeUserAgent });
		}
	}));

	menu.append(new MenuItem({ type: 'separator' }));

	// Standard context menu items (if text is selected or in an input field)
	if (params.isEditable || params.selectionText) {
		if (params.misspelledWord) {
			menu.append(new MenuItem({
				label: 'Add to Dictionary',
				click: () => {
					window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
				}
			}));
			menu.append(new MenuItem({ type: 'separator' }));
		}

		if (params.isEditable) {
			menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
			menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
			menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
		} else if (params.selectionText) {
			menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
		}

		menu.append(new MenuItem({ type: 'separator' }));
	}

	// Add "Inspect Element" for debugging
	if (config.webDebug) {
		menu.append(new MenuItem({
			label: 'Inspect Element',
			click: () => {
				window.webContents.inspectElement(params.x, params.y);
			}
		}));
	}

	menu.popup({ window });
}

/**
 * @param {Electron.HandlerDetails} details
 * @returns {{action: 'deny'} | {action: 'allow', outlivesOpener?: boolean, overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions}}
 */
function secureOpenLink(details) {
	logger.debug(`Requesting to open '${details.url}'`);

	// Allow Outlook compose/mail windows to open in Electron automatically
	if (isOutlookWindow(details.url)) {
		logger.debug('Outlook window detected, allowing in Electron');
		removePopupWindowMenu();
		return {
			action: 'allow',
			overrideBrowserWindowOptions: {
				width: 1000,
				height: 800,
				show: true,
				autoHideMenuBar: true,
				webPreferences: {
					partition: config.partition,
					contextIsolation: false,
					sandbox: false
				}
			}
		};
	}

	const action = getLinkAction();

	if (action === 0) {
		openInBrowser(details);
	}

	/**
	 * @type {{action: 'deny'} | {action: 'allow', outlivesOpener?: boolean, overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions}}
	 */
	const returnValue = action === 1 ? {
		action: 'allow',
		overrideBrowserWindowOptions: {
			modal: true,
			useContentSize: true,
			parent: window
		}
	} : { action: 'deny' };

	if (action === 1) {
		removePopupWindowMenu();
	}

	return returnValue;
}

/**
 * Check if URL is an Outlook window that should open in Electron
 * @param {string} url
 * @returns {boolean}
 */
function isOutlookWindow(url) {
	// Allow Outlook domains to open in Electron
	const outlookDomains = [
		'outlook.office.com',
		'outlook.office365.com',
		'outlook.live.com',
		'res.public.onecdn.static.microsoft',
		'addin.insights.static.microsoft',
		'substrate.office.com',
	];

	const urlLower = url.toLowerCase();

	// Check if URL contains any Outlook domain
	if (outlookDomains.some(domain => urlLower.includes(domain))) {
		return true;
	}

	// Also check for specific Outlook paths
	const outlookPatterns = [
		'/mail/deeplink/compose',
		'/mail/0/deeplink/compose',
		'/calendar/deeplink',
		'/mail/inbox/id/',
		'/mail/sentitems/id/',
	];

	return outlookPatterns.some(pattern => urlLower.includes(pattern));
}

/**
 * Check if URL is a telemetry/analytics request that should be blocked
 * @param {string} url
 * @returns {boolean}
 */
function isTelemetryUrl(url) {
	const telemetryPatterns = [
		'events.data.microsoft.com',
		'telemetry',
		'analytics',
		'collector',
		'/api/v2/track',
		'/collect',
	];

	const urlLower = url.toLowerCase();
	return telemetryPatterns.some(pattern => urlLower.includes(pattern));
}

function openInBrowser(details) {
	if (config.defaultURLHandler.trim() !== '') {
		exec(`${config.defaultURLHandler.trim()} ${details.url}`, openInBrowserErrorHandler);
	} else {
		shell.openExternal(details.url);
	}
}

function openInBrowserErrorHandler(error) {
	if (error) {
		logger.error(error.message);
	}
}

function getLinkAction() {
	const action = isControlPressed ? dialog.showMessageBoxSync(window, {
		type: 'warning',
		buttons: ['Allow', 'Deny'],
		title: 'Open URL',
		normalizeAccessKeys: true,
		defaultId: 1,
		cancelId: 1,
		message: 'This will open the URL in the application context. If this is for SSO, click Allow otherwise Deny.'
	}) + 1 : 0;

	isControlPressed = false;
	return action;
}

async function removePopupWindowMenu() {
	for (var i = 1; i <= 200; i++) {
		await sleep(10);
		const childWindows = window.getChildWindows();
		if (childWindows.length) {
			childWindows[0].removeMenu();
			break;
		}
	}
	return;
}

async function sleep(ms) {
	return await new Promise(r => setTimeout(r, ms));
}

async function createWindow() {
	// Load the previous state with fallback to defaults
	const windowState = windowStateKeeper({
		defaultWidth: 0,
		defaultHeight: 0,
	});

	if (config.clearStorage) {
		const defSession = session.fromPartition(config.partition);
		await defSession.clearStorageData();
	}

	// Create the window
	const window = createNewBrowserWindow(windowState);
	require('@electron/remote/main').enable(window.webContents);

	windowState.manage(window);

	window.eval = global.eval = function () { // eslint-disable-line no-eval
		throw new Error('Sorry, this app does not support window.eval().');
	};

	return window;
}

function createNewBrowserWindow(windowState) {
	return new BrowserWindow({
		title:'Outlook for Linux',
		x: windowState.x,
		y: windowState.y,

		width: windowState.width,
		height: windowState.height,
		backgroundColor: isDarkMode ? '#302a75' : '#fff',

		show: false,
		autoHideMenuBar: config.menubar == 'auto',
		icon: iconChooser.getFile(),

		webPreferences: {
			partition: config.partition,
			preload: path.join(__dirname, '..', 'browser', 'index.js'),
			plugins: true,
			contextIsolation: false,
			sandbox: false,
			spellcheck: false
		},
	});
}
