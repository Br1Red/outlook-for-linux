const { BrowserWindow, screen } = require('electron');
const path = require('path');

/**
 * Quick Compose Dialog - A small popup window for composing emails
 */
class QuickCompose {
	/**
	 * @param {Object} accountManager - AccountManager instance
	 * @param {Object} config - App configuration
	 */
	constructor(accountManager, config) {
		this.accountManager = accountManager;
		this.config = config;
		this.dialogWindow = null;
	}

	/**
	 * Open the quick compose dialog
	 * @param {string} [accountId] - Optional account ID to use
	 */
	openDialog(accountId = null) {
		// If dialog is already open, focus it
		if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
			this.dialogWindow.focus();
			return;
		}

		// Determine which account to use
		const account = this.getAccount(accountId);
		if (!account) {
			console.error('[QuickCompose] No account available');
			return;
		}

		// Get screen dimensions for positioning
		const { width, height } = screen.getPrimaryDisplay().workAreaSize;

		// Window dimensions
		const dialogWidth = 500;
		const dialogHeight = 600;

		// Position in bottom-right corner with margin
		const margin = 20;
		const x = width - dialogWidth - margin;
		const y = height - dialogHeight - margin;

		// Create the dialog window
		this.dialogWindow = new BrowserWindow({
			width: dialogWidth,
			height: dialogHeight,
			x: x,
			y: y,
			backgroundColor: '#302a75',
			show: false,
			autoHideMenuBar: true,
			resizable: true,
			minimizable: false,
			maximizable: false,
			alwaysOnTop: true,
			title: 'New Message - Outlook',
			webPreferences: {
				partition: account.partition,
				nodeIntegration: false,
				contextIsolation: false,
				sandbox: false,
				preload: path.join(__dirname, '..', 'browser', 'index.js'),
				additionalArguments: [`--accountId=${account.id}`]
			}
		});

		// Prevent eval for security
		this.dialogWindow.eval = global.eval = function () {
			throw new Error('Sorry, this app does not support window.eval().');
		};

		// Handle window close
		this.dialogWindow.on('closed', () => {
			this.dialogWindow = null;
		});

		// Show when ready
		this.dialogWindow.once('ready-to-show', () => {
			this.dialogWindow.setPosition(x, y);
			this.dialogWindow.show();
			this.dialogWindow.focus();
		});

		// Load Outlook compose URL
		const composeUrl = this.config.url.replace(/\/$/, '') + '/mail/0/deeplink/compose';
		this.dialogWindow.loadURL(composeUrl, { userAgent: this.config.chromeUserAgent });
	}

	/**
	 * Get the account to use for composing
	 * @param {string} [accountId] - Optional account ID
	 * @returns {Object|null}
	 */
	getAccount(accountId = null) {
		if (accountId) {
			return this.accountManager.getAccount(accountId);
		}

		if (this.accountManager.tabbedMode && this.accountManager.tabManager) {
			const activeTabId = this.accountManager.tabManager.activeTabId;
			if (activeTabId) {
				const account = this.accountManager.getAccount(activeTabId);
				if (account) return account;
			}
		}

		if (this.accountManager.focusedAccountId) {
			const account = this.accountManager.getAccount(this.accountManager.focusedAccountId);
			if (account) return account;
		}

		const accounts = this.accountManager.getAllAccounts();
		return accounts.length > 0 ? accounts[0] : null;
	}

	/**
	 * Check if quick compose dialog is currently open
	 * @returns {boolean}
	 */
	isOpen() {
		return this.dialogWindow && !this.dialogWindow.isDestroyed();
	}

	/**
	 * Close the quick compose dialog
	 */
	close() {
		if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
			this.dialogWindow.close();
		}
	}
}

module.exports = QuickCompose;
