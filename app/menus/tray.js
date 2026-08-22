const {
	Tray,
	Menu,
	nativeImage,
	dialog,
	nativeTheme,
	app,
} = require("electron");
const { saveConfigFile } = require("../config");
const dndManager = require("../utils/dnd");
const notificationModule = require("../notification");
const fs = require("fs");
const os = require("os");
const path = require("path");

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
		 * @type {QuickCompose|null}
		 */
		this.quickCompose = null;
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
		this.baseTrayImage = null;
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

	/**
	 * Set the quick compose reference
	 * @param {QuickCompose} quickCompose
	 */
	setQuickCompose(quickCompose) {
		this.quickCompose = quickCompose;
	}

	addTray() {
		// Use a unique temp copy of the icon to avoid StatusNotifierItem/theme collisions
		// with other Electron apps (e.g., Teams for Linux) on some desktop environments.
		let iconPathToUse = this.iconPath;
		try {
			const uniqueIconPath = path.join(
				os.tmpdir(),
				`outlook-for-linux-tray-${process.pid}-${path.basename(this.iconPath)}`,
			);
			fs.copyFileSync(this.iconPath, uniqueIconPath);
			iconPathToUse = uniqueIconPath;
		} catch (_) {
			// Best-effort; fall back to the bundled icon.
		}

		const base = nativeImage.createFromPath(iconPathToUse);
		const trayImage =
			base && !base.isEmpty() && typeof base.resize === "function"
				? base.resize({ width: 24, height: 24 })
				: base;
		this.baseTrayImage = trayImage;

		this.tray = new Tray(trayImage);
		this.tray.setToolTip("Microsoft Outlook");
		this.tray.on("click", () => this.showAndFocusWindow());
		this.tray.setContextMenu(Menu.buildFromTemplate(this.buildMenu()));
	}

	/**
	 * Build the tray menu
	 * @returns {Array}
	 */
	buildMenu() {
		const menu = [];

		// New Message (Quick Compose)
		menu.push({
			label: "New Message",
			click: () => this.openQuickCompose(),
		});

		menu.push({ type: "separator" });

		// Open
		menu.push({
			label: "Open",
			click: () => this.showAllWindows(),
		});

		// Refresh
		menu.push({
			label: "Refresh",
			click: () => this.reload(),
		});

		// Hide
		menu.push({
			label: "Hide",
			click: () => this.hideAllWindows(),
		});

		menu.push({ type: "separator" });

		// Clear notifications
		menu.push({
			label: "Clear Notifications",
			click: () => notificationModule.reset(),
		});

		menu.push({ type: "separator" });

		// Accounts submenu
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();

			if (accounts.length > 0) {
				accounts.forEach((account) => {
					const label = account.displayName + "      ";
					menu.push({
						label: label,
						submenu: [
							{
								label: "Focus Window",
								click: () => this.focusAccount(account.id),
							},
							{
								label: "Rename Account...",
								click: () => this.renameAccount(account),
							},
							{
								label: "Auto-restore on startup",
								type: "checkbox",
								checked: account.autoRestore !== false,
								click: () => this.toggleAutoRestore(account.id),
							},
							{ type: "separator" },
							{
								label: "Remove Account",
								click: () => this.removeAccount(account.id),
							},
						],
					});
				});

				menu.push({ type: "separator" });
			}

			menu.push({
				label: "Add Account...",
				click: () => this.createAccount(),
			});
		}

		menu.push({ type: "separator" });

		// Tabbed mode toggle
		menu.push({
			label: "Tabbed Mode",
			type: "checkbox",
			checked: this.config.tabbedMode || false,
			click: () => this.toggleTabbedMode(),
		});

		// Do Not Disturb toggle
		menu.push({
			label: "Do Not Disturb",
			type: "checkbox",
			checked: dndManager.manualDND,
			click: () => this.toggleDND(),
		});

		// Run in background (hide to tray instead of quitting on close)
		menu.push({
			label: "Run in Background",
			type: "checkbox",
			checked: !this.config.closeAppOnCross,
			click: () => this.toggleRunInBackground(),
		});

		menu.push({ type: "separator" });

		// About
		menu.push({
			label: "About",
			click: () => this.showAbout(),
		});

		// Quit
		menu.push({
			label: "Quit",
			click: () => {
				const { app } = require("electron");
				app.quit();
			},
		});

		return menu;
	}

	/**
	 * Update the tray menu (call when accounts or toggle state change)
	 */
	updateMenu() {
		if (!this.tray) return;
		this.lastMenuTemplate = this.buildMenu();
		this.tray.setContextMenu(Menu.buildFromTemplate(this.lastMenuTemplate));
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
			accounts.forEach((account) => {
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
			accounts.forEach((account) => {
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
				console.error("[Tray] Account not found:", accountId);
				return;
			}

			// In tabbed mode, switch to the tab
			if (this.accountManager.tabbedMode) {
				console.log("[Tray] Switching to tab:", account.displayName);
				this.accountManager.focusAccount(accountId);
			} else {
				// Regular window mode
				if (!account.window || account.window.isDestroyed()) {
					console.log(
						"[Tray] Creating window for account:",
						account.displayName,
					);
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

	renameAccount(account) {
		if (!this.accountManager) return;

		const { BrowserWindow, ipcMain } = require('electron');
		const parentWindow =
			this.accountManager.mainTabbedWindow || account.window || null;
		const isDarkMode = nativeTheme.shouldUseDarkColors;
		const inputDialog = new BrowserWindow({
			width: 450,
			height: account.manualDisplayName ? 260 : 240,
			resizable: false,
			modal: parentWindow !== null,
			parent: parentWindow,
			show: false,
			autoHideMenuBar: true,
			webPreferences: {
				preload: path.join(__dirname, '..', 'dialogs', 'preload.js'),
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				additionalArguments: [
					'--dialog-type=rename',
					`--dialog-data=${encodeURIComponent(JSON.stringify({
						isDarkMode,
						currentName: account.displayName,
						inputValue: account.manualDisplayName || '',
						hasManualName: Boolean(account.manualDisplayName),
						email: account.email || '',
						placeholder: account.manualDisplayName
							? 'Leave empty to revert to auto-detection'
							: 'Enter new name or leave empty for auto-detection',
					}))}`,
				],
			},
		});

		inputDialog.loadFile(path.join(__dirname, '..', 'dialogs', 'dialog.html'));

		const handler = (event, newName) => {
			if (event.sender !== inputDialog.webContents || typeof newName !== 'string') {
				return;
			}
			this.accountManager.setAccountDisplayName(account.id, newName);
			inputDialog.close();
			ipcMain.removeListener('rename-account-result', handler);
		};

		ipcMain.on('rename-account-result', handler);
		inputDialog.on('closed', () => {
			ipcMain.removeListener('rename-account-result', handler);
		});
		inputDialog.once('ready-to-show', () => {
			inputDialog.show();
			inputDialog.focus();
		});
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
				type: "warning",
				buttons: ["Cancel", "Remove Account"],
				defaultId: 0,
				cancelId: 0,
				title: "Remove Account",
				message: `Are you sure you want to remove "${label}"?`,
				detail:
					"This will close the account window and remove it from the account list. You can add it again later.",
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
		const { dialog } = require("electron");
		const newValue = !this.config.tabbedMode;

		// Update config
		this.config.tabbedMode = newValue;

		// Save to config file
		saveConfigFile(app.getPath("userData"), { tabbedMode: newValue });

		// Show restart dialog
		dialog.showMessageBoxSync({
			type: "info",
			buttons: ["OK"],
			title: "Tabbed Mode",
			message: `Tabbed mode has been ${newValue ? "enabled" : "disabled"}.`,
			detail: "Please restart the application for this change to take effect.",
		});

		// Update menu to show new state
		this.updateMenu();
	}

	/**
	 * Toggle Do Not Disturb mode
	 */
	toggleDND() {
		const newState = dndManager.toggleManualDND();

		// Show brief notification
		const { Notification } = require("electron");
		const status = newState ? "enabled" : "disabled";
		new Notification({
			title: `Do Not Disturb ${status}`,
			body: newState
				? "Notifications will be suppressed"
				: "Notifications will resume",
			silent: true,
		}).show();

		// Update menu to show new state
		this.updateMenu();
	}

	/**
	 * Toggle hide-to-tray behavior when closing the window
	 */
	toggleRunInBackground() {
		const newValue = !this.config.closeAppOnCross;
		this.config.closeAppOnCross = newValue;
		saveConfigFile(app.getPath("userData"), { closeAppOnCross: newValue });
		this.updateMenu();
	}

	/**
	 * Show About dialog
	 */
	showAbout() {
		const { app, dialog } = require("electron");
		const appInfo = [];
		appInfo.push(`outlook-for-linux@${app.getVersion()}\n`);
		for (const prop in process.versions) {
			if (
				prop === "node" ||
				prop === "v8" ||
				prop === "electron" ||
				prop === "chrome"
			) {
				appInfo.push(`${prop}: ${process.versions[prop]}`);
			}
		}

		// Find first available account window for the dialog
		let targetWindow = null;
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();
			const firstAccount = accounts.find(
				(a) => a.window && !a.window.isDestroyed(),
			);
			if (firstAccount) {
				targetWindow = firstAccount.window;
			}
		} else if (this.window) {
			targetWindow = this.window;
		}

		dialog.showMessageBoxSync(targetWindow || null, {
			buttons: ["OK"],
			title: "About",
			icon: this.iconPath,
			defaultId: 0,
			cancelId: 0,
			message: appInfo.join("\n"),
			type: "info",
		});
	}

	/**
	 * Update the tray icon with a badge count
	 * @param {number} count - Number to display on the badge
	 * @param {string} type - 'email' or 'reminder' (default: 'email')
	 */
	async updateBadge(count, type = "email") {
		// Skip update if count and type haven't changed
		if (this.lastBadgeCount === count && this.lastBadgeType === type) {
			return;
		}

		// Find first available window for rendering badge
		let windowForBadge = this.window;

		if (this.accountManager && !windowForBadge) {
			const mainTabbedWindow = this.accountManager.mainTabbedWindow;
			if (mainTabbedWindow && !mainTabbedWindow.isDestroyed()) {
				windowForBadge = mainTabbedWindow;
			} else {
				const accounts = this.accountManager.getAllAccounts();
				const firstAccount = accounts.find(
					(a) => a.window && !a.window.isDestroyed(),
				);
				if (firstAccount) {
					windowForBadge = firstAccount.window;
				}
			}
		}
		if (count > 0 && windowForBadge && windowForBadge.webContents) {
			// Determine badge color based on type
			const badgeColor = type === "reminder" ? "#FF6600" : "#FF0000"; // Orange for reminders, red for emails
			const tooltipText =
				type === "reminder"
					? `Microsoft Outlook - ${count} active reminder${count > 1 ? "s" : ""}`
					: `Microsoft Outlook - ${count} unread email${count > 1 ? "s" : ""}`;

			// Get icon data URL first
			const iconDataURL = nativeImage.createFromPath(this.iconPath).toDataURL();

			// Render badge in the renderer process (has access to Canvas API)
			try {
				const dataURL = await windowForBadge.webContents.executeJavaScript(
					`(async function(iconSrc, color, count) {
						const encoded = iconSrc.substring(iconSrc.indexOf(',') + 1);
						const binary = atob(encoded);
						const bytes = Uint8Array.from(binary, (character) =>
							character.charCodeAt(0),
						);
						const bitmap = await createImageBitmap(
							new Blob([bytes], { type: 'image/png' }),
						);
						const canvas = document.createElement('canvas');
						canvas.width = 140;
						canvas.height = 140;
						const ctx = canvas.getContext('2d');

						ctx.drawImage(bitmap, 0, 0, 140, 140);
						bitmap.close();

						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.arc(95, 50, 45, 0, 2 * Math.PI);
						ctx.fill();

						ctx.strokeStyle = 'white';
						ctx.lineWidth = 3;
						ctx.stroke();

						const displayText = count > 9 ? '9+' : count.toString();
						const fontSize = count > 9 ? 58 : 70;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						ctx.fillStyle = 'white';
						ctx.font = 'bold ' + fontSize + 'px Arial';
						ctx.fillText(displayText, 95, 50);

						return canvas.toDataURL();
					})(${JSON.stringify(iconDataURL)}, ${JSON.stringify(badgeColor)}, ${count})`,
				);

				const image = nativeImage.createFromDataURL(dataURL);
				this.tray.setImage(image);
				this.tray.setToolTip(tooltipText);
				this.lastBadgeCount = count;
				this.lastBadgeType = type;
			} catch (err) {
				console.error("[Tray] Failed to render badge:", err);
				console.error("[Tray] Badge color:", badgeColor);
				console.error("[Tray] Count:", count);
				console.error("[Tray] Type:", type);
			}
		} else {
			// Reset to original icon
			this.tray.setImage(
				this.baseTrayImage || nativeImage.createFromPath(this.iconPath),
			);
			this.tray.setToolTip("Microsoft Outlook");
			if (count <= 0) {
				this.lastBadgeCount = count;
				this.lastBadgeType = type;
			}
		}
	}

	showAndFocusWindow() {
		if (this.accountManager) {
			const accounts = this.accountManager.getAllAccounts();

			// In tabbed mode, show main tabbed window directly
			if (
				this.accountManager.tabbedMode &&
				this.accountManager.mainTabbedWindow
			) {
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

	showAccountSelectionDialog(accounts) {
		const { BrowserWindow, ipcMain } = require('electron');
		const isDarkMode = nativeTheme.shouldUseDarkColors;
		const height = Math.min(140 + (accounts.length + 1) * 45, 500);
		const selectDialog = new BrowserWindow({
			width: 400,
			height,
			resizable: false,
			modal: false,
			show: false,
			autoHideMenuBar: true,
			title: 'Select Account',
			backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
			webPreferences: {
				preload: path.join(__dirname, '..', 'dialogs', 'preload.js'),
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				additionalArguments: [
					'--dialog-type=tray-account',
					`--dialog-data=${encodeURIComponent(JSON.stringify({
						isDarkMode,
						accounts: accounts.map(({ id, displayName }) => ({ id, displayName })),
					}))}`,
				],
			},
		});

		selectDialog.loadFile(path.join(__dirname, '..', 'dialogs', 'dialog.html'));

		const handler = (event, result) => {
			if (event.sender !== selectDialog.webContents || !result || typeof result !== 'object') {
				return;
			}
			if (result.action === 'show-all') {
				this.showAllWindows();
			} else if (
				result.action === 'focus' &&
				accounts.some((account) => account.id === result.accountId)
			) {
				this.focusAccount(result.accountId);
			} else {
				return;
			}
			ipcMain.removeListener('tray-account-selection', handler);
			selectDialog.close();
		};

		ipcMain.on('tray-account-selection', handler);
		selectDialog.on('closed', () => {
			ipcMain.removeListener('tray-account-selection', handler);
		});
		selectDialog.once('ready-to-show', () => {
			selectDialog.show();
			selectDialog.focus();
		});
	}

	/**
	 * Open quick compose dialog
	 */
	openQuickCompose() {
		if (this.quickCompose) {
			// If in multi-account mode, pass the focused account
			const accountId = this.accountManager?.focusedAccountId || null;
			this.quickCompose.openDialog(accountId);
		}
	}

	close() {
		this.tray.destroy();
	}
}
exports = module.exports = ApplicationTray;
