const { Tray, Menu, nativeImage, dialog, nativeTheme, app } = require('electron');
const { saveConfigFile } = require('../config');

class ApplicationTray {
	constructor(window, appMenu, iconPath, config) {
		/**
		 * @type {Electron.BrowserWindow|null}
		 */
		this.window = window;
		this.iconPath = iconPath;
		this.appMenu = appMenu;
		this.config = config;
		/**
		 * @type {AccountManager|null}
		 */
		this.accountManager = null;
		/**
		 * Cache to prevent unnecessary menu rebuilds
		 */
		this.lastAccountsHash = null;
		this.lastMenuTemplate = null;
		/**
		 * Cache for badge to prevent unnecessary icon updates
		 */
		this.lastBadgeCount = null;
		this.lastBadgeType = null;
		this.addTray();
	}

	/**
	 * Set the account manager reference
	 * @param {AccountManager} accountManager
	 */
	setAccountManager(accountManager) {
		this.accountManager = accountManager;
		this.updateMenu();
	}

	addTray() {
		this.tray = new Tray(this.iconPath);
		this.tray.setToolTip('Microsoft Outlook');
		this.tray.on('click', () => this.showAndFocusWindow());
		this.tray.setContextMenu(Menu.buildFromTemplate(this.buildMenu()));
	}

	/**
	 * Build the tray menu
	 * @returns {Array}
	 */
	buildMenu() {
		const menu = [];

			// Open
		menu.push({
			label: 'Open',
			click: () => this.showAllWindows()
		});

		// Refresh
		menu.push({
			label: 'Refresh',
			click: () => this.reload()
		});

		// Hide
		menu.push({
			label: 'Hide',
			click: () => this.hideAllWindows()
		});

		menu.push({ type: 'separator' });

		// Accounts submenu
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();

			if (accounts.length > 0) {
				accounts.forEach(account => {
					const label = account.displayName + '      ';
					menu.push({
						label: label,
						submenu: [
							{
								label: 'Focus Window',
								click: () => this.focusAccount(account.id)
							},
							{
								label: 'Rename Account...',
								click: () => this.renameAccount(account)
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

				menu.push({ type: 'separator' });
			}

			menu.push({
				label: 'Add Account...',
				click: () => this.createAccount()
			});
		}

		menu.push({ type: 'separator' });

		// Tabbed mode toggle
		menu.push({
			label: 'Tabbed Mode',
			type: 'checkbox',
			checked: this.config.tabbedMode || false,
			click: () => this.toggleTabbedMode()
		});

		menu.push({ type: 'separator' });

		// About
		menu.push({
			label: 'About',
			click: () => this.showAbout()
		});

		// Quit
		menu.push({
			label: 'Quit',
			click: () => {
				const { app } = require('electron');
				app.quit();
			}
		});

		return menu;
	}

	/**
	 * Update the tray menu (call when accounts change)
	 */
	updateMenu() {
		if (!this.tray) return;

		// Calculate current accounts hash to detect changes
		let currentHash = null;
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();
			currentHash = accounts.map(a => `${a.id}:${a.email || ''}:${a.displayName}:${a.autoRestore}`).join('|');
		}

		// Only rebuild menu if accounts have changed
		if (currentHash !== this.lastAccountsHash) {
			this.lastAccountsHash = currentHash;
			this.lastMenuTemplate = this.buildMenu();
			this.tray.setContextMenu(Menu.buildFromTemplate(this.lastMenuTemplate));
		}
	}

	/**
	 * Show all account windows
	 */
	showAllWindows() {
		if (this.accountManager) {
			this.accountManager.showAllWindows();
		} else if (this.window) {
			// Fallback for single window mode
			this.window.show();
			this.window.focus();
		}
	}

	/**
	 * Reload all account windows
	 */
	reload() {
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();
			accounts.forEach(account => {
				if (account.window && !account.window.isDestroyed()) {
					account.window.show();
					account.window.reload();
				}
			});
		} else if (this.window) {
			this.window.show();
			this.window.reload();
		}
	}

	/**
	 * Hide all account windows
	 */
	hideAllWindows() {
		if (this.accountManager) {
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

	/**
	 * Focus a specific account's window
	 * @param {string} accountId
	 */
	focusAccount(accountId) {
		if (this.accountManager) {
			const account = this.accountManager.getAccount(accountId);
			if (!account) {
				console.error('[Tray] Account not found:', accountId);
				return;
			}

			// In tabbed mode, switch to the tab
			if (this.accountManager.tabbedMode) {
				console.log('[Tray] Switching to tab:', account.displayName);
				this.accountManager.focusAccount(accountId);
			} else {
				// Regular window mode
				if (!account.window || account.window.isDestroyed()) {
					console.log('[Tray] Creating window for account:', account.displayName);
					this.accountManager.createAccountWindow(account);
				} else {
					// Show and focus existing window
					account.window.show();
					account.window.focus();
				}
			}
		}
	}

	/**
	 * Toggle auto-restore for an account
	 * @param {string} accountId
	 */
	toggleAutoRestore(accountId) {
		if (this.accountManager) {
			this.accountManager.toggleAutoRestore(accountId);
		}
	}

	/**
	 * Rename an account
	 * @param {Object} account
	 */
	renameAccount(account) {
		if (this.accountManager) {
			const { BrowserWindow } = require('electron');

			// In tabbed mode, use main tabbed window as parent
			const parentWindow = this.accountManager.mainTabbedWindow || account.window || null;

			// Create a simple input dialog
			const inputDialog = new BrowserWindow({
				width: 450,
				height: account.manualDisplayName ? 260 : 240,
				resizable: false,
				modal: parentWindow !== null, // Only modal if we have a parent
				parent: parentWindow,
				show: false,
				autoHideMenuBar: true,
				webPreferences: {
					nodeIntegration: true,
					contextIsolation: false
				}
			});

			// Prepare values for template
			const currentName = account.displayName;
			const inputValue = account.manualDisplayName || '';
			const placeholder = account.manualDisplayName
				? 'Leave empty to revert to auto-detection'
				: 'Enter new name or leave empty for auto-detection';
			const revertText = account.manualDisplayName
				? `<p class="info-text">Leave empty to revert to auto-detection (${account.email || 'detected email'})</p>`
				: '';

			// Get dark mode preference
			const isDarkMode = nativeTheme.shouldUseDarkColors;

			// Load a simple HTML page with an input form
			inputDialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
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
							overflow: hidden;
							background-color: ${isDarkMode ? '#1e1e1e' : '#ffffff'};
							color: ${isDarkMode ? '#e0e0e0' : '#000000'};
						}
						h2 { margin: 0 0 15px 0; font-size: 18px; }
						p { margin: 5px 0; font-size: 14px; }
						.info-text { font-size: 12px; color: ${isDarkMode ? '#aaa' : '#666'}; margin-bottom: 12px; }
						input {
							width: 100%;
							padding: 8px;
							font-size: 14px;
							margin: 12px 0;
							background-color: ${isDarkMode ? '#2d2d2d' : '#ffffff'};
							border: 1px solid ${isDarkMode ? '#444' : '#ccc'};
							color: ${isDarkMode ? '#e0e0e0' : '#000000'};
						}
						input:focus { outline: 2px solid #0078d4; border-color: #0078d4; }
						.buttons {
							display: flex;
							justify-content: flex-end;
							gap: 10px;
							margin-top: 15px;
						}
						button {
							padding: 8px 16px;
							font-size: 14px;
							cursor: pointer;
							border-radius: 4px;
						}
						#cancel {
							background: ${isDarkMode ? '#3a3a3a' : '#f0f0f0'};
							border: 1px solid ${isDarkMode ? '#555' : '#ccc'};
							color: ${isDarkMode ? '#e0e0e0' : '#000000'};
						}
						#rename { background: #0078d4; color: white; border: none; }
						#rename:hover { background: #106ebe; }
						#cancel:hover { background: ${isDarkMode ? '#4a4a4a' : '#e0e0e0'}; }
					</style>
				</head>
				<body>
					<h2>Rename Account</h2>
					<p>Current: <strong>${currentName}</strong></p>
					${revertText}
					<input type="text" id="nameInput" value="${inputValue}" placeholder="${placeholder}" autofocus />
					<div class="buttons">
						<button id="cancel">Cancel</button>
						<button id="rename">Rename</button>
					</div>
					<script>
						const { ipcRenderer } = require('electron');
						const input = document.getElementById('nameInput');
						const cancelBtn = document.getElementById('cancel');
						const renameBtn = document.getElementById('rename');

						input.select();
						input.focus();

						function submit() {
							ipcRenderer.send('rename-account-result', input.value);
							window.close();
						}

						renameBtn.addEventListener('click', submit);
						cancelBtn.addEventListener('click', () => window.close());

						input.addEventListener('keydown', (e) => {
							if (e.key === 'Enter') submit();
							if (e.key === 'Escape') window.close();
						});
					</script>
				</body>
				</html>
			`));

			// Handle the result
			const { ipcMain } = require('electron');
			const handler = (_event, newName) => {
				// Always allow submission (including empty) to let user clear manual override
				if (newName !== null) {
					this.accountManager.setAccountDisplayName(account.id, newName);
				}
				inputDialog.close();
				ipcMain.removeListener('rename-account-result', handler);
			};

			ipcMain.once('rename-account-result', handler);

			// Handle window close
			inputDialog.on('closed', () => {
				ipcMain.removeListener('rename-account-result', handler);
			});

			inputDialog.once('ready-to-show', () => {
				inputDialog.show();
				inputDialog.focus();
			});
		}
	}

	/**
	 * Remove an account
	 * @param {string} accountId
	 */
	removeAccount(accountId) {
		if (this.accountManager) {
			const account = this.accountManager.getAccount(accountId);
			if (!account) {
				return;
			}

			const label = account.email || account.displayName;

			// Confirm before removing
			const result = dialog.showMessageBoxSync({
				type: 'warning',
				buttons: ['Cancel', 'Remove Account'],
				defaultId: 0,
				cancelId: 0,
				title: 'Remove Account',
				message: `Are you sure you want to remove "${label}"?`,
				detail: 'This will close the account window and remove it from the account list. You can add it again later.'
			});

			if (result === 1) {
				this.accountManager.removeAccount(accountId);
			}
		}
	}

	/**
	 * Create a new account
	 */
	async createAccount() {
		if (this.accountManager) {
			this.accountManager.createAccount();
		}
	}

	/**
	 * Toggle tabbed mode (requires restart)
	 */
	toggleTabbedMode() {
		const { dialog } = require('electron');
		const newValue = !this.config.tabbedMode;

		// Update config
		this.config.tabbedMode = newValue;

		// Save to config file
		saveConfigFile(app.getPath('userData'), { tabbedMode: newValue });

		// Show restart dialog
		dialog.showMessageBoxSync({
			type: 'info',
			buttons: ['OK'],
			title: 'Tabbed Mode',
			message: `Tabbed mode has been ${newValue ? 'enabled' : 'disabled'}.`,
			detail: 'Please restart the application for this change to take effect.'
		});

		// Update menu to show new state
		this.updateMenu();
	}

	/**
	 * Show About dialog
	 */
	showAbout() {
		const { app, dialog } = require('electron');
		const appInfo = [];
		appInfo.push(`outlook-for-linux@${app.getVersion()}\n`);
		for (const prop in process.versions) {
			if (prop === 'node' || prop === 'v8' || prop === 'electron' || prop === 'chrome') {
				appInfo.push(`${prop}: ${process.versions[prop]}`);
			}
		}

		// Find first available account window for the dialog
		let targetWindow = null;
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();
			const firstAccount = accounts.find(a => a.window && !a.window.isDestroyed());
			if (firstAccount) {
				targetWindow = firstAccount.window;
			}
		} else if (this.window) {
			targetWindow = this.window;
		}

		dialog.showMessageBoxSync(targetWindow || null, {
			buttons: ['OK'],
			title: 'About',
			defaultId: 0,
			cancelId: 0,
			message: appInfo.join('\n'),
			type: 'info'
		});
	}

	/**
	 * Update the tray icon with a badge count
	 * @param {number} count - Number to display on the badge
	 * @param {string} type - 'email' or 'reminder' (default: 'email')
	 */
	async updateBadge(count, type = 'email') {
		// Skip update if count and type haven't changed
		if (this.lastBadgeCount === count && this.lastBadgeType === type) {
			return;
		}

		this.lastBadgeCount = count;
		this.lastBadgeType = type;

		// Find first available window for rendering badge
		let windowForBadge = this.window;

		if (this.accountManager && !windowForBadge) {
			const accounts = this.accountManager.getAllAccounts();
			const firstAccount = accounts.find(a => a.window && !a.window.isDestroyed());
			if (firstAccount) {
				windowForBadge = firstAccount.window;
			}
		}

		if (count > 0 && windowForBadge && windowForBadge.webContents) {
			// Determine badge color based on type
			const badgeColor = type === 'reminder' ? '#FF6600' : '#FF0000'; // Orange for reminders, red for emails
			const tooltipText = type === 'reminder'
				? `Microsoft Outlook - ${count} active reminder${count > 1 ? 's' : ''}`
				: `Microsoft Outlook - ${count} unread email${count > 1 ? 's' : ''}`;

			// Get icon data URL first
			const iconDataURL = nativeImage.createFromPath(this.iconPath).toDataURL();

			// Render badge in the renderer process (has access to Canvas API)
			try {
				const dataURL = await windowForBadge.webContents.executeJavaScript(
					`(function(iconSrc, color, count) {
						const canvas = document.createElement('canvas');
						canvas.width = 140;
						canvas.height = 140;
						const ctx = canvas.getContext('2d');

						// Load base icon
						const image = new Image();
						image.src = iconSrc;

						return new Promise((resolve) => {
							image.onload = () => {
								// Draw base icon
								ctx.drawImage(image, 0, 0, 140, 140);

								// Draw badge circle with color
								ctx.fillStyle = color;
								ctx.beginPath();
								ctx.arc(95, 50, 45, 0, 2 * Math.PI);
								ctx.fill();

								// Add white border
								ctx.strokeStyle = 'white';
								ctx.lineWidth = 3;
								ctx.stroke();

								// Draw count text
								const displayText = count > 9 ? '9+' : count.toString();
								const fontSize = count > 9 ? 58 : 70;

								ctx.textAlign = 'center';
								ctx.textBaseline = 'middle';
								ctx.fillStyle = 'white';
								ctx.font = 'bold ' + fontSize + 'px Arial';
								ctx.fillText(displayText, 95, 50);

								resolve(canvas.toDataURL());
							};
						});
					})(${JSON.stringify(iconDataURL)}, ${JSON.stringify(badgeColor)}, ${count})`
				);

				const image = nativeImage.createFromDataURL(dataURL);
				this.tray.setImage(image);
				this.tray.setToolTip(tooltipText);
			} catch (err) {
				console.error('[Tray] Failed to render badge:', err);
				console.error('[Tray] Badge color:', badgeColor);
				console.error('[Tray] Count:', count);
				console.error('[Tray] Type:', type);
			}
		} else {
			// Reset to original icon
			this.tray.setImage(this.iconPath);
			this.tray.setToolTip('Microsoft Outlook');
		}
	}

	showAndFocusWindow() {
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();

			// In tabbed mode, show main tabbed window directly
			if (this.accountManager.tabbedMode && this.accountManager.mainTabbedWindow) {
				const mainWin = this.accountManager.mainTabbedWindow;
				if (!mainWin.isDestroyed()) {
					if (mainWin.isMinimized()) {
						mainWin.restore();
					}
					mainWin.show();
					mainWin.focus();
				}
				return;
			}

			// If only one account, just show it
			if (accounts.length === 1) {
				this.focusAccount(accounts[0].id);
				return;
			}

			// If multiple accounts, show selection dialog
			this.showAccountSelectionDialog(accounts);
		} else if (this.window) {
			this.window.show();
			this.window.focus();
		}
	}

	/**
	 * Show a custom HTML dialog to select which account window to open
	 * @param {Array} accounts - List of accounts
	 */
	showAccountSelectionDialog(accounts) {
		const { BrowserWindow, ipcMain } = require('electron');

		// Calculate height based on number of accounts + show all button
		const baseHeight = 140;
		const accountHeight = 45;
		const height = Math.min(baseHeight + ((accounts.length + 1) * accountHeight), 500);

		// Get dark mode preference
		const isDarkMode = nativeTheme.shouldUseDarkColors;

		// Create selection dialog
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
		const accountButtons = accounts.map((a, i) =>
			`<button class="account-btn" data-index="${i}" data-id="${a.id}">${a.displayName}</button>`
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
					.account-btn, .show-all-btn {
						padding: 12px;
						text-align: left;
						background: ${isDarkMode ? '#2d2d2d' : '#f5f5f5'};
						border: 1px solid ${isDarkMode ? '#444' : '#ddd'};
						border-radius: 4px;
						cursor: pointer;
						font-size: 14px;
						transition: background 0.2s;
						color: ${isDarkMode ? '#e0e0e0' : '#000000'};
					}
					.account-btn:hover, .show-all-btn:hover {
						background: ${isDarkMode ? '#3a3a3a' : '#e5e5e5'};
					}
					.show-all-btn {
						background: ${isDarkMode ? '#1a3a5c' : '#e8f4ff'};
						border-color: #0078d4;
						font-weight: 500;
					}
					.show-all-btn:hover {
						background: ${isDarkMode ? '#2a4a6c' : '#d0e8ff'};
					}
				</style>
			</head>
			<body>
				<h2>Select Account</h2>
				<p>Which account window would you like to open?</p>
				<div class="account-list">
					<button class="show-all-btn" data-action="show-all">Show All Windows</button>
					${accountButtons}
				</div>
				<script>
					const { ipcRenderer } = require('electron');

					document.querySelector('.show-all-btn').addEventListener('click', () => {
						ipcRenderer.send('tray-account-selection', { action: 'show-all' });
						window.close();
					});

					document.querySelectorAll('.account-btn').forEach(btn => {
						btn.addEventListener('click', () => {
							ipcRenderer.send('tray-account-selection', { action: 'focus', accountId: btn.dataset.id });
							window.close();
						});
					});
				</script>
			</body>
			</html>
		`));

		const handler = (_event, result) => {
			if (result.action === 'show-all') {
				this.showAllWindows();
			} else if (result.action === 'focus' && result.accountId) {
				this.focusAccount(result.accountId);
			}
			ipcMain.removeListener('tray-account-selection', handler);
		};

		ipcMain.once('tray-account-selection', handler);

		selectDialog.on('closed', () => {
			ipcMain.removeListener('tray-account-selection', handler);
		});

		selectDialog.once('ready-to-show', () => {
			selectDialog.show();
			selectDialog.focus();
		});
	}

	close() {
		this.tray.destroy();
	}
}
exports = module.exports = ApplicationTray;
