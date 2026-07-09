const { app, Menu, dialog, session, ipcMain, Notification } = require('electron');
const fs = require('fs'),
	path = require('path');
const application = require('./application');
const preferences = require('./preferences');
const help = require('./help');
const Tray = require('./tray');
const { LucidLog } = require('lucid-log');
const connectionManager = require('../connectionManager');

class Menus {
	constructor(window, config, iconPath, appConfig) {
		/**
		 * @type {Electron.BrowserWindow}
		 */
		this.window = window;
		this.iconPath = iconPath;
		this.config = config;
		this.appConfig = appConfig;
		this.allowQuit = false;
		/**
		 * @type {AccountManager|null}
		 */
		this.accountManager = null;
		/**
		 * @type {QuickCompose|null}
		 */
		this.quickCompose = null;
		this.logger = new LucidLog({
			levels: config.appLogLevels.split(',')
		});
		this.initialize();
	}

	/**
	 * Set the account manager reference
	 * @param {AccountManager} accountManager
	 */
	setAccountManager(accountManager) {
		this.accountManager = accountManager;
		this.updateTrayMenu();
	}

	/**
	 * Set quick compose reference
	 * @param {QuickCompose} quickCompose
	 */
	setQuickCompose(quickCompose) {
		this.quickCompose = quickCompose;
		// Also set on tray if it exists
		if (this.tray && this.tray.setQuickCompose) {
			this.tray.setQuickCompose(quickCompose);
		}
	}

	/**
	 * Open quick compose dialog
	 */
	openQuickCompose() {
		if (this.quickCompose) {
			// Use focused account or first available
			const accountId = this.accountManager?.focusedAccountId || null;
			this.quickCompose.openDialog(accountId);
		}
	}

	/**
	 * Get account menu items for the Accounts menu
	 * @returns {Array}
	 */
	getAccountsMenuItems() {
		if (!this.accountManager) {
			return [
				{
					label: 'Add Account',
					click: () => this.createAccount()
				}
			];
		}

		const accounts = this.accountManager.getAllAccounts();
		const items = [];

		// Add Account
		items.push({
			label: 'Add Account',
			click: () => this.createAccount()
		});

		items.push({ type: 'separator' });

		// List all accounts
		accounts.forEach(account => {
			const label = account.email || account.displayName;
			items.push({
				label: `${label} ${account.autoRestore ? '✓' : ''}`,
				submenu: [
					{
						label: 'Focus Window',
						click: () => this.focusAccount(account.id)
					},
					{
						label: 'Auto-restore on startup',
						type: 'checkbox',
						checked: account.autoRestore !== false,
						click: () => this.toggleAutoRestore(account.id)
					},
					{ type: 'separator' },
					{
						label: 'Remove Account',
						click: () => this.removeAccount(account.id)
					}
				]
			});
		});

		return items;
	}

	/**
	 * Create a new account
	 */
	async createAccount() {
		if (this.accountManager) {
			const account = this.accountManager.createAccount();
			this.logger.info(`Created account: ${account.displayName}`);
		} else {
			// Fallback: use IPC
			const { ipcRenderer } = require('electron');
			// This won't work in main process, so we need to handle it differently
			this.logger.warn('Account manager not available');
		}
	}

	/**
	 * Remove an account
	 * @param {string} accountId
	 */
	async removeAccount(accountId) {
		if (this.accountManager) {
			this.accountManager.removeAccount(accountId);
		}
	}

	/**
	 * Focus an account's window
	 * @param {string} accountId
	 */
	async focusAccount(accountId) {
		if (this.accountManager) {
			this.accountManager.focusAccount(accountId);
		}
	}

	/**
	 * Toggle auto-restore for an account
	 * @param {string} accountId
	 */
	async toggleAutoRestore(accountId) {
		if (this.accountManager) {
			this.accountManager.toggleAutoRestore(accountId);
		}
	}

	/**
	 * Update tray menu (called when accounts change)
	 */
	updateTrayMenu() {
		if (this.tray && this.tray.updateMenu) {
			this.tray.updateMenu();
		}
	}

	async quit(clearStorage = false) {
		this.allowQuit = true;

		// Handle quit for multi-account mode
		if (this.accountManager) {
			if (clearStorage) {
				const confirmed = dialog.showMessageBoxSync(null, {
					buttons: ['Yes', 'No'],
					title: 'Quit',
					normalizeAccessKeys: true,
					defaultId: 1,
					cancelId: 1,
					message: 'Are you sure you want to clear the storage before quitting?',
					type: 'question'
				}) === 0;

				if (confirmed) {
					// Clear storage for all accounts
					const accounts = this.accountManager.getAllAccounts();
					for (const account of accounts) {
						const { session } = require('electron');
						const accountSession = session.fromPartition(account.partition);
						await accountSession.clearStorageData();
					}
				}
			}

			// Close all account windows
			this.accountManager.closeAllWindows();
		} else if (this.window) {
			// Single account mode
			clearStorage = clearStorage && dialog.showMessageBoxSync(this.window, {
				buttons: ['Yes', 'No'],
				title: 'Quit',
				normalizeAccessKeys: true,
				defaultId: 1,
				cancelId: 1,
				message: 'Are you sure you want to clear the storage before quitting?',
				type: 'question'
			}) === 0;

			if (clearStorage) {
				const defSession = session.fromPartition(this.config.partition);
				await defSession.clearStorageData();
			}

			this.window.close();
		} else {
			// No window and no account manager, just quit
			const { app } = require('electron');
			app.quit();
		}
	}

	open() {
		if (this.accountManager) {
			// Show all account windows
			this.accountManager.showAllWindows();
		} else if (this.window) {
			if (!this.window.isVisible()) {
				this.window.show();
			}
			this.window.focus();
		}
	}

	about() {
		const appInfo = [];
		appInfo.push(`outlook-for-linux@${app.getVersion()}\n`);
		for (const prop in process.versions) {
			if (prop === 'node' || prop === 'v8' || prop === 'electron' || prop === 'chrome') {
				appInfo.push(`${prop}: ${process.versions[prop]}`);
			}
		}
		const targetWindow = this.accountManager ?
			this.accountManager.getAllAccounts().find(a => a.window)?.window :
			this.window;
		dialog.showMessageBoxSync(targetWindow || null, {
			buttons: ['OK'],
			title: 'About',
			normalizeAccessKeys: true,
			defaultId: 0,
			cancelId: 0,
			message: appInfo.join('\n'),
			type: 'info'
		});
	}

	reload(show = true) {
		if (this.accountManager) {
			// Reload all account windows
			const accounts = this.accountManager.getAllAccounts();
			accounts.forEach(account => {
				if (account.window && !account.window.isDestroyed()) {
					if (show) account.window.show();
					account.window.reload();
				}
			});
		} else if (this.window) {
			if (show) {
				this.window.show();
			}
			connectionManager.refresh();
		}
	}

	debug() {
		if (this.accountManager) {
			// Open DevTools for first account window
			const accounts = this.accountManager.getAllAccounts();
			const firstAccount = accounts.find(a => a.window && !a.window.isDestroyed());
			if (firstAccount) {
				firstAccount.window.openDevTools();
			}
		} else if (this.window) {
			this.window.openDevTools();
		}
	}

	hide() {
		if (this.accountManager) {
			// Hide all account windows
			const accounts = this.accountManager.getAllAccounts();
			accounts.forEach(account => {
				if (account.window && !account.window.isDestroyed()) {
					account.window.hide();
				}
			});
		} else if (this.window) {
			this.window.hide();
		}
	}

	initialize() {
		const appMenu = application(this);

		// Only set menu if window exists
		if (this.window) {
			if (this.config.menubar === 'hidden') {
				this.window.removeMenu();
			} else {
				this.window.setMenu(Menu.buildFromTemplate([
					appMenu,
					preferences(),
					help(app, this.window),
				]));
			}

			this.initializeEventHandlers();
		}

		// Create tray (works with null window in multi-account mode)
		this.tray = new Tray(null, appMenu.submenu, this.iconPath, this.config);

		// If accountManager is already set, update tray
		if (this.accountManager) {
			this.tray.setAccountManager(this.accountManager);
		}
	}

	/**
	 * Update the tray icon badge count
	 * @param {number} count - Number of unread items
	 * @param {string} type - Badge type ('email' or 'reminder')
	 */
	updateTrayBadge(count, type = 'email') {
		if (this.tray) {
			this.tray.updateBadge(count, type);
		}
	}

	testNotification() {
		this.logger.info('Testing native notification');

		try {
			const notification = new Notification({
				title: 'Test Notification',
				body: 'This is a test notification using native Electron Notification!',
				icon: this.iconPath,
				urgency: 'normal',
			});

			notification.on('click', () => {
				this.logger.info('Notification has been clicked');
				if (this.accountManager) {
					this.accountManager.showAllWindows();
				} else if (this.window) {
					this.window.show();
					this.window.focus();
				}
			});

			notification.on('close', () => {
				this.logger.info('Notification has been closed');
			});

			notification.show();
			this.logger.info('Notification created successfully');
		} catch (error) {
			this.logger.error('Error creating notification:', error);
			this.logger.error('Stack:', error.stack);
		}
	}

	initializeEventHandlers() {
		app.on('before-quit', () => this.onBeforeQuit());
		ipcMain.on('get-outlook-settings', saveSettingsInternal);
		ipcMain.on('set-outlook-settings', restoreSettingsInternal);
		// Only attach close handler if we have a window (single account mode)
		if (this.window) {
			this.window.on('close', (event) => this.onClose(event));
		}
	}

	onBeforeQuit() {
		this.logger.debug('before-quit');
		this.allowQuit = true;
	}

	onClose(event) {
		this.logger.debug('window close');
		if (!this.allowQuit && !this.config.closeAppOnCross) {
			event.preventDefault();
			this.hide();
		} else {
			this.tray.close();
			if (this.window) {
				this.window.webContents.session.flushStorageData();
			}
		}
	}

	saveSettings() {
		if (this.accountManager) {
			// Send to all account windows
			const accounts = this.accountManager.getAllAccounts();
			accounts.forEach(account => {
				if (account.window && !account.window.isDestroyed()) {
					account.window.webContents.send('get-outlook-settings');
				}
			});
		} else if (this.window) {
			this.window.webContents.send('get-outlook-settings');
		}
	}

	restoreSettings() {
		const settingsPath = path.join(app.getPath('userData'), 'outlook_settings.json');
		try {
			const settings = JSON.parse(fs.readFileSync(settingsPath));
			if (this.accountManager) {
				// Send to all account windows
				const accounts = this.accountManager.getAllAccounts();
				accounts.forEach(account => {
					if (account.window && !account.window.isDestroyed()) {
						account.window.webContents.send('set-outlook-settings', settings);
					}
				});
			} else if (this.window) {
				this.window.webContents.send('set-outlook-settings', settings);
			}
		} catch (e) {
			this.logger.error('Error loading settings:', e);
		}
	}
}

function saveSettingsInternal(event, arg) {
	fs.writeFileSync(path.join(app.getPath('userData'), 'outlook_settings.json'), JSON.stringify(arg));
	dialog.showMessageBoxSync(this.window, {
		message: 'Settings have been saved successfully!',
		title: 'Save settings',
		type: 'info'
	});
}

function restoreSettingsInternal(event, arg) {
	if (arg) {
		dialog.showMessageBoxSync(this.window, {
			message: 'Settings have been restored successfully!',
			title: 'Restore settings',
			type: 'info'
		});
	}
}

exports = module.exports = Menus;
