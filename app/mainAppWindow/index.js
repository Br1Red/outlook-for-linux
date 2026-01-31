require('@electron/remote/main').initialize();
const { BrowserWindow, nativeTheme } = require('electron');
const isDarkMode = nativeTheme.shouldUseDarkColors;
const path = require('path');
const Menus = require('../menus');
const { LucidLog } = require('lucid-log');
const TrayIconChooser = require('../browser/tools/trayIconChooser');
// eslint-disable-next-line no-unused-vars
const { AppConfiguration } = require('../appConfiguration');
const notificationModule = require('../notification');

/**
 * @type {TrayIconChooser}
 */
let iconChooser;

// NOTE: isControlPressed removed - no longer needed in multi-account mode

/**
 * @type {LucidLog}
 */
let logger;

// NOTE: aboutBlankRequestCount removed - no longer needed in multi-account mode
let config;

// NOTE: window variable removed - no longer a single main window in multi-account mode

/**
 * @type {AccountManager}
 */
let accountManager;

/**
 * @param {AppConfiguration} mainConfig
 */
exports.onAppReady = async function onAppReady(mainConfig) {
	const AccountManager = require('../accountManager');
	const mainApp = require('../index');

	config = mainConfig.startupConfig;
	iconChooser = new TrayIconChooser(mainConfig.startupConfig);
	logger = new LucidLog({
		levels: config.appLogLevels.split(',')
	});

	// Create menus instance (will be shared across all accounts)
	const menus = new Menus(null, config, iconChooser.getFile(), mainConfig);

	// Create account manager
	const accMgr = new AccountManager(config, iconChooser.getFile(), menus, mainConfig);

	// Set as global reference for IPC handlers
	mainApp.setAccountManager(accMgr);

	// Initialize notification module (will be called by each account window)
	notificationModule.init(null, iconChooser.getFile(), menus);

	// Store references for other functions
	// Store in module-level variable for access from event handlers (which lose 'this' context)
	accountManager = accMgr;
	this.accountManager = accMgr;
	this.menus = menus;

	// Restore saved accounts (or create default if none exist)
	// If multiple accounts exist, show chooser first
	const accounts = accMgr.getAllAccounts();
	if (accounts.length === 0) {
		// No accounts, create default one
		await accountManager.restoreAccounts();
	} else if (accounts.length === 1) {
		// Single account, just restore it
		await accountManager.restoreAccounts();
	} else {
		// Multiple accounts - show chooser
		await showStartupAccountChooser(accountManager);
	}

	// Note: addEventHandlers() removed - no longer a single main window

	// Handle command line args (e.g., mailto links)
	const result = processArgs(process.argv);
	if (result && result.isMailto) {
		// Open mailto in new compose window
		await openComposeWindow(result.url, accountManager);
	}
};

let allowFurtherRequests = true;

exports.onAppSecondInstance = async function onAppSecondInstance(event, args) {
	logger.debug('second-instance started');
	event.preventDefault();

	const result = processArgs(args);
	if (result && allowFurtherRequests) {
		allowFurtherRequests = false;
		setTimeout(() => { allowFurtherRequests = true; }, 5000);

		if (result.isMailto) {
			// Open mailto links in new compose window
			await openComposeWindow(result.url, accountManager);
		} else {
			// For other URLs, load in the first available account window
			const accounts = accountManager?.getAllAccounts() || [];
			const firstAccount = accounts.find(a => a.window && !a.window.isDestroyed());
			if (firstAccount) {
				firstAccount.window.loadURL(result.url, { userAgent: config.chromeUserAgent });
				firstAccount.window.show();
				firstAccount.window.focus();
			}
		}
	}

	// Show all account windows (but not after mailto - user may have cancelled)
	if (!result?.isMailto) {
		accountManager?.showAllWindows();
	}
};

// Export functions for external access
exports.getAccountManager = function() {
	return this.accountManager;
};

exports.getMenus = function() {
	return this.menus;
};

// NOTE: Old single-window functions removed - now handled per-account in AccountManager
// - applyAppConfiguration (no longer needed)
// - restoreWindow (no longer needed)

function processArgs(args) {
	var regHttps = /^https:\/\/outlook.microsoft.com\/l\/(meetup-join|channel)\//g;
	var regMS = /^msoutlook:\/l\/(meetup-join|channel)\//g;
	var regMailto = /^mailto:/i;
	logger.debug('processArgs:', args);
	for (const arg of args) {
		if (regHttps.test(arg)) {
			logger.debug('A url argument received with https protocol');
			// Note: window.show() removed - window is null in multi-account mode
			return { url: arg, isMailto: false };
		}
		if (regMS.test(arg)) {
			logger.debug('A url argument received with msoutlook protocol');
			// Note: window.show() removed - window is null in multi-account mode
			return { url: config.url + arg.substring(8, arg.length), isMailto: false };
		}
		if (regMailto.test(arg)) {
			logger.debug('A mailto argument received');
			// Note: window.show() removed - window is null in multi-account mode
			// Convert mailto: URL to Outlook compose URL
			return { url: convertMailtoToOutlookURL(arg), isMailto: true };
		}
	}
}

/**
 * Show a dialog to select which account to use for mailto
 * @param {AccountManager} accountManager
 * @returns {Promise<string|null>} Account ID or null if cancelled
 */
function showAccountSelectionDialog(accountManager) {
	return new Promise((resolve) => {
		const { BrowserWindow, ipcMain } = require('electron');
		const accounts = accountManager.getAllAccounts();
		if (accounts.length === 0) {
			resolve(null);
			return;
		}

		// Get dark mode preference
		const isDarkMode = nativeTheme.shouldUseDarkColors;

		// Calculate height based on number of accounts
		const baseHeight = 140;
		const accountHeight = 45;
		const height = Math.min(baseHeight + (accounts.length * accountHeight), 500);

		// Create selection dialog - same pattern as tray dialog (modal: false, no parent)
		const selectDialog = new BrowserWindow({
			width: 400,
			height: height,
			resizable: false,
			modal: false,
			show: false,
			autoHideMenuBar: true,
			title: 'Select Account',
			backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false
			}
		});

		// Build account buttons HTML
		const accountButtons = accounts.map(a =>
			`<button class="account-btn" data-id="${a.id}">${a.displayName}</button>`
		).join('');

		selectDialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
			<!DOCTYPE html>
			<html>
			<head>
				<meta name="color-scheme" content="${isDarkMode ? 'dark' : 'light'}">
				<style>
					* { box-sizing: border-box; }
					body {
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
						padding: 20px;
						margin: 0;
						background-color: ${isDarkMode ? '#1e1e1e' : '#ffffff'};
						color: ${isDarkMode ? '#e0e0e0' : '#000000'};
					}
					h2 { margin: 0 0 10px 0; font-size: 18px; }
					p { margin: 5px 0 15px 0; font-size: 14px; color: ${isDarkMode ? '#aaa' : '#666'}; }
					.account-list {
						display: flex;
						flex-direction: column;
						gap: 8px;
						max-height: 350px;
						overflow-y: auto;
					}
					.account-btn {
						padding: 12px;
						text-align: left;
						background: ${isDarkMode ? '#2d2d2d' : '#f5f5f5'};
						border: 1px solid ${isDarkMode ? '#444' : '#ddd'};
						border-radius: 4px;
						cursor: pointer;
						font-size: 14px;
						color: ${isDarkMode ? '#e0e0e0' : '#000000'};
					}
					.account-btn:hover {
						background: ${isDarkMode ? '#3a3a3a' : '#e5e5e5'};
					}
				</style>
			</head>
			<body>
				<h2>Select Account</h2>
				<p>Which account would you like to use?</p>
				<div class="account-list">
					${accountButtons}
				</div>
				<script>
					const { ipcRenderer } = require('electron');

					document.querySelectorAll('.account-btn').forEach(btn => {
						btn.addEventListener('click', () => {
							ipcRenderer.send('mailto-account-selected', btn.dataset.id);
							window.close();
						});
					});
				</script>
			</body>
			</html>
		`));

		const handler = (_event, accountId) => {
			resolve(accountId || null);
			ipcMain.removeListener('mailto-account-selected', handler);
		};

		ipcMain.once('mailto-account-selected', handler);

		selectDialog.on('closed', () => {
			ipcMain.removeListener('mailto-account-selected', handler);
			resolve(null);
		});

		selectDialog.once('ready-to-show', () => {
			selectDialog.show();
			selectDialog.focus();
		});
	});
}

/**
 * Show startup account chooser dialog
 * Similar to tray selection but allows choosing which accounts to open on startup
 * @param {AccountManager} accountManager
 * @returns {Promise<void>}
 */
async function showStartupAccountChooser(accountManager) {
	const { BrowserWindow, ipcMain } = require('electron');
	const accounts = accountManager.getAllAccounts();

	// Get dark mode preference
	const isDarkMode = nativeTheme.shouldUseDarkColors;

	// Calculate height based on number of accounts + header + buttons
	const baseHeight = 180;
	const accountHeight = 50;
	const height = Math.min(baseHeight + (accounts.length * accountHeight), 500);

	// Create selection dialog
	const selectDialog = new BrowserWindow({
		width: 420,
		height: height,
		resizable: false,
		modal: false,
		show: false,
		autoHideMenuBar: true,
		title: 'Select Accounts',
		backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});

	// Build account checkboxes HTML
	const accountItems = accounts.map(a =>
		`<label class="account-item">
			<input type="checkbox" data-id="${a.id}" ${a.autoRestore !== false ? 'checked' : ''}>
			<span>${a.displayName}</span>
		</label>`
	).join('');

	selectDialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
		<!DOCTYPE html>
		<html>
		<head>
			<meta name="color-scheme" content="${isDarkMode ? 'dark' : 'light'}">
			<style>
				* { box-sizing: border-box; }
				body {
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
					padding: 20px;
					margin: 0;
					background-color: ${isDarkMode ? '#1e1e1e' : '#ffffff'};
					color: ${isDarkMode ? '#e0e0e0' : '#000000'};
				}
				h2 { margin: 0 0 10px 0; font-size: 18px; }
				p { margin: 5px 0 15px 0; font-size: 14px; color: ${isDarkMode ? '#aaa' : '#666'}; }
				.account-list {
					display: flex;
					flex-direction: column;
					gap: 8px;
					max-height: 300px;
					overflow-y: auto;
					margin-bottom: 15px;
				}
				.account-item {
					display: flex;
					align-items: center;
					gap: 10px;
					padding: 10px;
					background: ${isDarkMode ? '#2d2d2d' : '#f5f5f5'};
					border: 1px solid ${isDarkMode ? '#444' : '#ddd'};
					border-radius: 4px;
					cursor: pointer;
					transition: background 0.2s;
				}
				.account-item:hover {
					background: ${isDarkMode ? '#3a3a3a' : '#e9e9e9'};
				}
				.account-item input[type="checkbox"] {
					width: 18px;
					height: 18px;
					cursor: pointer;
				}
				.account-item span {
					flex: 1;
					color: ${isDarkMode ? '#e0e0e0' : '#000000'};
				}
				.buttons {
					display: flex;
					justify-content: flex-end;
					gap: 10px;
				}
				button {
					padding: 10px 20px;
					font-size: 14px;
					cursor: pointer;
					border-radius: 4px;
					border: none;
				}
				#cancel {
					background: ${isDarkMode ? '#3a3a3a' : '#f0f0f0'};
					color: ${isDarkMode ? '#e0e0e0' : '#000000'};
				}
				#open {
					background: #0078d4;
					color: white;
				}
				#open:hover { background: #106ebe; }
				#cancel:hover { background: ${isDarkMode ? '#4a4a4a' : '#e0e0e0'}; }
			</style>
		</head>
		<body>
			<h2>Select Accounts to Open</h2>
			<p>Choose which accounts to open on startup:</p>
			<div class="account-list">
				${accountItems}
			</div>
			<div class="buttons">
				<button id="open">Open Selected</button>
			</div>
			<script>
				const { ipcRenderer } = require('electron');

				// Toggle checkbox when clicking the label
				document.querySelectorAll('.account-item').forEach(item => {
					item.addEventListener('click', (e) => {
						if (e.target.tagName !== 'INPUT') {
							const checkbox = item.querySelector('input');
							checkbox.checked = !checkbox.checked;
						}
					});
				});

				document.getElementById('open').addEventListener('click', () => {
					const checkedIds = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
						.map(cb => cb.dataset.id);
					ipcRenderer.send('startup-account-selection', checkedIds);
					window.close();
				});
			</script>
		</body>
		</html>
	`));

	const handler = (_event, accountIds) => {
		if (accountIds && accountIds.length > 0) {
			// Create windows for selected accounts
			accountIds.forEach(id => {
				const account = accountManager.getAccount(id);
				if (account) {
					accountManager.createAccountWindow(account);
				}
			});
		}
		ipcMain.removeListener('startup-account-selection', handler);
	};

	ipcMain.once('startup-account-selection', handler);

	selectDialog.on('closed', () => {
		ipcMain.removeListener('startup-account-selection', handler);
		// If dialog is closed without selection, open no windows
	});

	selectDialog.once('ready-to-show', () => {
		selectDialog.show();
		selectDialog.focus();
	});
}

/**
 * Open a compose window with the given URL in the selected account's session
 * @param {string} url - Outlook compose URL
 * @param {AccountManager} [accountManager] - Account manager for account selection
 */
async function openComposeWindow(url, accountManager) {
	let targetPartition = config.partition;
	let targetAccountId = null;

	// If account manager provided, determine which account to use
	if (accountManager) {
		const accounts = accountManager.getAllAccounts();
		if (accounts.length === 0) {
			logger.debug('No accounts available, using default partition');
		} else if (accounts.length === 1) {
			// Single account - use it directly
			targetPartition = accounts[0].partition;
			targetAccountId = accounts[0].id;
		} else {
			// Multiple accounts - show selection dialog
			targetAccountId = await showAccountSelectionDialog(accountManager);
			if (!targetAccountId) {
				logger.debug('Account selection cancelled');
				return;
			}
			const account = accountManager.getAccount(targetAccountId);
			if (account) {
				targetPartition = account.partition;
			}
		}
	}

	const composeWindow = new BrowserWindow({
		width: 1000,
		height: 800,
		backgroundColor: isDarkMode ? '#302a75' : '#fff',
		show: false,
		autoHideMenuBar: true,
		icon: iconChooser.getFile(),
		webPreferences: {
			partition: targetPartition,
			preload: path.join(__dirname, '..', 'browser', 'index.js'),
			contextIsolation: false,
			sandbox: false,
			spellcheck: false,
			additionalArguments: targetAccountId ? [`--accountId=${targetAccountId}`] : []
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

// NOTE: Old single-window event handlers removed - now handled per-account in AccountManager
// - onBeforeRequestHandler (webRequest handler)
// - onNewWindow (window open handler)
// - onBeforeInput (input event handler)
// - onContextMenu (context menu handler)
// - secureOpenLink (link handling)
// - isOutlookWindow (URL checking)
// - isTelemetryUrl (telemetry blocking)
// - openInBrowser (browser opening)
// - getLinkAction (user dialog for links)
// - removePopupWindowMenu (popup menu removal)
// - createWindow (window creation)
// - createNewBrowserWindow (browser window creation)
