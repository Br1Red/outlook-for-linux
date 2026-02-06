const { BrowserWindow, app, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const { LucidLog } = require('lucid-log');
const connectionManager = require('../connectionManager');
const TrayIconChooser = require('../browser/tools/trayIconChooser');

/**
 * Manages multiple Outlook accounts with isolated sessions
 */
class AccountManager {
	/**
	 * @param {Object} config - App configuration
	 * @param {string} iconPath - Path to tray icon
	 * @param {Object} menus - Menus instance
	 * @param {Object} appConfig - App configuration with settings store
	 */
	constructor(config, iconPath, menus, appConfig) {
		/** @type {Object} */
		this.config = config;

		/** @type {string} */
		this.iconPath = iconPath;

		/** @type {Object} */
		this.menus = menus;

		/** @type {Object} */
		this.appConfig = appConfig;

		/** @type {Array<Account>} */
		this.accounts = [];

		/** @type {boolean} */
		this.isQuitting = false;

		/** @type {LucidLog} */
		this.logger = new LucidLog({
			levels: config.appLogLevels.split(',')
		});

		/** @type {TrayIconChooser} */
		this.iconChooser = new TrayIconChooser(config);

		// Load saved accounts
		this.loadAccounts();

		// Track which partition is currently focused (for badge rotation)
		this.focusedAccountId = null;
		this.badgeRotationInterval = null;
		this.currentBadgeIndex = 0;

		// Set this AccountManager on the Menus and Tray
		if (menus) {
			menus.setAccountManager(this);
			if (menus.tray) {
				menus.tray.setAccountManager(this);
			}
		}

		// Listen for before-quit to allow windows to close properly
		app.on('before-quit', () => {
			this.isQuitting = true;
		});

		// Register global handlers once (shared by all windows)
		this.registerGlobalHandlers();
	}

	/**
	 * Register global event handlers (only once for all accounts)
	 */
	registerGlobalHandlers() {
		// Check if already registered
		if (this.globalHandlersRegistered) {
			return;
		}
		this.globalHandlersRegistered = true;

		const refreshAllWindows = () => {
			this.accounts.forEach(account => {
				if (account.window && !account.window.isDestroyed()) {
					this.refreshAccountWindow(account);
				}
			});
		};

		// Register global offline-retry handler
		ipcMain.removeAllListeners('offline-retry');
		ipcMain.on('offline-retry', refreshAllWindows);

		// Register global system resume handler
		powerMonitor.removeAllListeners('resume');
		powerMonitor.on('resume', refreshAllWindows);

		this.logger.info('Global handlers registered for connection management');
	}

	/**
	 * Refresh a single account window
	 * @param {Account} account
	 */
	refreshAccountWindow(account) {
		if (!account.window || account.window.isDestroyed()) {
			return;
		}

		const currentUrl = account.window.webContents.getURL();
		const hasUrl = currentUrl && currentUrl.startsWith('https://') ? true : false;

		if (hasUrl) {
			account.window.reload();
		} else {
			account.window.loadURL(this.config.url, { userAgent: this.config.chromeUserAgent });
		}
	}

	/**
	 * Load accounts from persistent storage
	 */
	loadAccounts() {
		const savedAccounts = this.appConfig.settingsStore.get('accounts', []);
		this.accounts = savedAccounts.map(acc => ({
			...acc,
			window: null,
			unreadCount: 0,
			reminderCount: 0
		}));
		this.logger.info(`Loaded ${this.accounts.length} accounts from storage`);
	}

	/**
	 * Save accounts to persistent storage
	 */
	saveAccounts() {
		const accountsToSave = this.accounts.map(acc => ({
			id: acc.id,
			email: acc.email,
			partition: acc.partition,
			displayName: acc.displayName,
			autoRestore: acc.autoRestore !== false, // default true
			createdAt: acc.createdAt
		}));
		this.appConfig.settingsStore.set('accounts', accountsToSave);
		this.logger.debug(`Saved ${accountsToSave.length} accounts to storage`);
	}

	/**
	 * Generate unique account ID
	 * @returns {string}
	 */
	generateAccountId() {
		return `account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Create a new account
	 * @param {Object} options
	 * @param {string} [options.email] - Optional email address
	 * @param {string} [options.displayName] - Optional display name
	 * @returns {Account} The created account
	 */
	createAccount(options = {}) {
		const id = this.generateAccountId();
		const partition = `persist:${id}`;

		const account = {
			id,
			partition,
			email: options.email || null,
			displayName: options.displayName || `Account ${this.accounts.length + 1}`,
			autoRestore: true,
			createdAt: Date.now(),
			window: null,
			unreadCount: 0,
			reminderCount: 0
		};

		this.accounts.push(account);
		this.saveAccounts();

		this.createAccountWindow(account);

		this.logger.info(`Created account: ${account.displayName} (${account.id})`);
		this.updateTrayMenu();

		return account;
	}

	/**
	 * Create the browser window for an account
	 * @param {Account} account
	 */
	createAccountWindow(account) {
		// Check if window already exists
		if (account.window && !account.window.isDestroyed()) {
			account.window.show();
			account.window.focus();
			return;
		}

		// Load window state
		const windowState = windowStateKeeper({
			defaultWidth: 1280,
			defaultHeight: 800,
			file: `window-state-${account.id}`
		});

		const window = new BrowserWindow({
			title: `Microsoft Outlook - ${account.displayName}`,
			x: windowState.x,
			y: windowState.y,
			width: windowState.width,
			height: windowState.height,
			backgroundColor: '#302a75',
			show: false,
			autoHideMenuBar: this.config.menubar == 'auto',
			icon: this.iconChooser.getFile(),
			webPreferences: {
				partition: account.partition,
				preload: path.join(__dirname, '..', 'browser', 'index.js'),
				plugins: true,
				contextIsolation: false,
				sandbox: false,
				spellcheck: false,
				additionalArguments: [`--accountId=${account.id}`]
			}
		});

		// Enable @electron/remote for this window
		require('@electron/remote/main').enable(window.webContents);

		// Store reference
		account.window = window;

		// Manage window state
		windowState.manage(window);

		// Prevent eval
		window.eval = global.eval = function () { // eslint-disable-line no-eval
			throw new Error('Sorry, this app does not support window.eval().');
		};

		// Show when ready, or after a timeout fallback
		let shown = false;
		const showWindow = () => {
			if (!shown) {
				shown = true;
				window.show();
				this.logger.info(`Account window shown: ${account.displayName}`);
			}
		};

		window.once('ready-to-show', showWindow);

		// Fallback: show window after 5 seconds even if not ready
		setTimeout(() => {
			showWindow();
		}, 5000);

		// Handle window close - prevent closing and hide instead (minimize to tray)
		// But allow closing if app is quitting
		window.on('close', (event) => {
			if (this.isQuitting) {
				// Allow the window to close when app is quitting
				this.logger.info(`Account window closing (app quitting): ${account.displayName}`);
				return;
			}

			this.logger.info(`Account window close requested: ${account.displayName}`);
			// Prevent the window from closing, just hide it
			event.preventDefault();
			window.hide();
			this.logger.info(`Account window hidden to tray: ${account.displayName}`);
		});

		// Handle window closed
		window.on('closed', () => {
			account.window = null;
			this.logger.info(`Account window closed: ${account.displayName}`);
		});

		// Handle window focus for badge rotation
		window.on('focus', () => {
			this.focusedAccountId = account.id;
		});

		// Add context menu (right-click)
		window.webContents.on('context-menu', (event, params) => {
			const { Menu, MenuItem } = require('electron');
			const menu = new Menu();

			// Add "Reload Page" option
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
					window.loadURL(this.config.url, { userAgent: this.config.chromeUserAgent });
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
			if (this.config.webDebug) {
				menu.append(new MenuItem({
					label: 'Inspect Element',
					click: () => {
						window.webContents.inspectElement(params.x, params.y);
					}
				}));
			}

			menu.popup({ window });
		});

		// Load the Outlook URL for this account window
		window.loadURL(this.config.url, { userAgent: this.config.chromeUserAgent });

		this.logger.info(`Created account window: ${account.displayName} (partition: ${account.partition})`);
	}

	/**
	 * Remove an account
	 * @param {string} accountId
	 */
	removeAccount(accountId) {
		const index = this.accounts.findIndex(a => a.id === accountId);
		if (index === -1) {
			this.logger.warn(`Account not found: ${accountId}`);
			return;
		}

		const account = this.accounts[index];

		// Close window if open
		if (account.window && !account.window.isDestroyed()) {
			account.window.close();
		}

		// Remove from list
		this.accounts.splice(index, 1);
		this.saveAccounts();

		this.logger.info(`Removed account: ${account.displayName}`);
		this.updateTrayMenu();

		// If no accounts left, create a new one
		if (this.accounts.length === 0) {
			this.logger.info('No accounts remaining, creating default account');
			this.createAccount();
		}
	}

	/**
	 * Get account by ID
	 * @param {string} accountId
	 * @returns {Account|null}
	 */
	getAccount(accountId) {
		return this.accounts.find(a => a.id === accountId) || null;
	}

	/**
	 * Get account by window
	 * @param {BrowserWindow} window
	 * @returns {Account|null}
	 */
	getAccountByWindow(window) {
		return this.accounts.find(a => a.window === window) || null;
	}

	/**
	 * Get all accounts
	 * @returns {Array<Account>}
	 */
	getAllAccounts() {
		return [...this.accounts];
	}

	/**
	 * Restore accounts (open windows for accounts with autoRestore enabled)
	 */
	async restoreAccounts() {
		const accountsToRestore = this.accounts.filter(a => a.autoRestore !== false);

		if (accountsToRestore.length === 0 && this.accounts.length === 0) {
			// No accounts exist, create first one
			this.logger.info('No accounts found, creating default account');
			this.createAccount();
			return;
		}

		this.logger.info(`Restoring ${accountsToRestore.length} accounts...`);

		for (const account of accountsToRestore) {
			this.createAccountWindow(account);
		}

		// Start badge rotation
		this.startBadgeRotation();
	}

	/**
	 * Update account email (detected from page)
	 * @param {string} accountId
	 * @param {string} email
	 */
	setAccountEmail(accountId, email) {
		const account = this.getAccount(accountId);
		if (account && account.email !== email) {
			account.email = email;
			// Only update displayName from detection if user hasn't manually set a custom name
			if (!account.manualDisplayName) {
				account.displayName = email;
				this.logger.info(`Updated account display name from detection: ${email}`);
			}
			this.saveAccounts();
			this.logger.info(`Updated account email: ${account.displayName} -> ${email}`);
			this.updateTrayMenu();
		}
	}

	/**
	 * Update account display name
	 * @param {string} accountId
	 * @param {string} displayName
	 */
	setAccountDisplayName(accountId, displayName) {
		const account = this.getAccount(accountId);
		if (account) {
			// If displayName is empty or whitespace, clear manual override to allow detection
			if (displayName.trim() === '') {
				account.manualDisplayName = null;
				// Revert to detected email or default
				account.displayName = account.email || `Account ${this.accounts.indexOf(account) + 1}`;
			} else {
				// Set manual override - detection won't override this
				account.manualDisplayName = displayName;
				account.displayName = displayName;
			}
			this.saveAccounts();

			// Update window title
			if (account.window && !account.window.isDestroyed()) {
				account.window.setTitle(`Microsoft Outlook - ${account.displayName}`);
			}

			this.updateTrayMenu();
		}
	}

	/**
	 * Toggle auto-restore setting for an account
	 * @param {string} accountId
	 */
	toggleAutoRestore(accountId) {
		const account = this.getAccount(accountId);
		if (account) {
			account.autoRestore = !account.autoRestore;
			this.saveAccounts();
			this.logger.info(`Auto-restore ${account.autoRestore ? 'enabled' : 'disabled'} for: ${account.displayName}`);
			this.updateTrayMenu();
		}
	}

	/**
	 * Focus an account's window
	 * @param {string} accountId
	 */
	focusAccount(accountId) {
		const account = this.getAccount(accountId);
		if (account && account.window && !account.window.isDestroyed()) {
			account.window.show();
			account.window.focus();
		}
	}

	/**
	 * Show all account windows (cascade them)
	 */
	showAllWindows() {
		let offset = 0;
		for (const account of this.accounts) {
			if (account.window && !account.window.isDestroyed()) {
				account.window.show();
				if (offset > 0) {
					const [x, y] = account.window.getPosition();
					account.window.setPosition(x + offset, y + offset);
				}
				offset += 30;
			}
		}

		// Focus the first account
		if (this.accounts.length > 0) {
			this.focusAccount(this.accounts[0].id);
		}
	}

	/**
	 * Update unread count for an account
	 * @param {string} accountId
	 * @param {number} count
	 */
	updateUnreadCount(accountId, count) {
		const account = this.getAccount(accountId);
		if (account) {
			account.unreadCount = count;
			this.updateBadge();
		}
	}

	/**
	 * Update reminder count for an account
	 * @param {string} accountId
	 * @param {number} count
	 */
	updateReminderCount(accountId, count) {
		const account = this.getAccount(accountId);
		if (account) {
			account.reminderCount = count;
			this.updateBadge();
		}
	}

	/**
	 * Start badge rotation between accounts
	 */
	startBadgeRotation() {
		if (this.badgeRotationInterval) {
			clearInterval(this.badgeRotationInterval);
		}

		this.badgeRotationInterval = setInterval(() => {
			this.updateBadge();
		}, 3000);
	}

	/**
	 * Update badge (rotate between accounts)
	 */
	updateBadge() {
		// Find accounts with unread items
		const accountsWithUnread = this.accounts.filter(a => a.unreadCount > 0 || a.reminderCount > 0);

		if (accountsWithUnread.length === 0) {
			app.setBadgeCount(0);
			if (this.menus && this.menus.tray) {
				this.menus.tray.updateBadge(0, 'email');
			}
			return;
		}

		// Rotate to next account
		this.currentBadgeIndex = (this.currentBadgeIndex + 1) % accountsWithUnread.length;
		const account = accountsWithUnread[this.currentBadgeIndex];

		// Show reminder count if available, otherwise email count
		const count = account.reminderCount > 0 ? account.reminderCount : account.unreadCount;
		const type = account.reminderCount > 0 ? 'reminder' : 'email';

		app.setBadgeCount(count);
		if (this.menus && this.menus.tray) {
			this.menus.tray.updateBadge(count, type);
		}
	}

	/**
	 * Update tray menu with account list
	 */
	updateTrayMenu() {
		if (this.menus && this.menus.updateTrayMenu) {
			this.menus.updateTrayMenu();
		}
	}

	/**
	 * Close all account windows
	 */
	closeAllWindows() {
		for (const account of this.accounts) {
			if (account.window && !account.window.isDestroyed()) {
				account.window.close();
			}
		}
	}
}

module.exports = AccountManager;
