const { app, ipcMain, dialog, globalShortcut } = require("electron");
const path = require("path");
const { LucidLog } = require("lucid-log");
const isDev = require("electron-is-dev");

// Set app name for notifications BEFORE anything else
// Linux: use a stable unique identity for desktop integration (dock, Background Apps, tray)
if (process.platform === "linux") {
	app.name = "outlook-for-linux";
} else {
	app.name = "Microsoft Outlook";
}
// Set desktop name to match the .desktop file for notification persistence
if (process.platform === "linux") {
	app.setDesktopName("outlook-for-linux");
}

if (app.commandLine.hasSwitch("customUserDir")) {
	app.setPath("userData", app.commandLine.getSwitchValue("customUserDir"));
}

const { AppConfiguration } = require("./appConfiguration");
const appConfig = new AppConfiguration(app.getPath("userData"));

const config = appConfig.startupConfig;
config.appPath = path.join(__dirname, isDev ? "" : "../../");

const logger = new LucidLog({
	levels: config.appLogLevels.split(","),
});

const notificationSounds = [
	{
		type: "new-message",
		file: path.join(config.appPath, "assets/sounds/new_message.wav"),
	},
];

// Notification sound player
/**
 * @type {NodeSoundPlayer}
 */
let player;
try {
	// eslint-disable-next-line no-unused-vars
	const { NodeSound } = require("node-sound");
	player = NodeSound.getDefaultPlayer();
} catch (e) {
	logger.info("No audio players found. Audio notifications might not work.");
}

const certificateModule = require("./certificate");
const notificationModule = require("./notification");
const gotTheLock = app.requestSingleInstanceLock();
const mainAppWindow = require("./mainAppWindow");
const QuickCompose = require("./quickCompose");

if (config.proxyServer)
	app.commandLine.appendSwitch("proxy-server", config.proxyServer);
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");
app.commandLine.appendSwitch("enable-ntlm-v2", config.ntlmV2enabled);
app.commandLine.appendSwitch("try-supported-channel-layouts");

// Enable S/MIME support - allow client certificates
app.commandLine.appendSwitch("ignore-certificate-errors-spki-list");
logger.info("Enabled client certificate support for S/MIME");

if (process.env.XDG_SESSION_TYPE === "wayland") {
	logger.info("Running under Wayland, switching to PipeWire...");

	const features = app.commandLine.hasSwitch("enable-features")
		? app.commandLine.getSwitchValue("enable-features").split(",")
		: [];
	if (!features.includes("WebRTCPipeWireCapturer"))
		features.push("WebRTCPipeWireCapturer");

	app.commandLine.appendSwitch("enable-features", features.join(","));
	app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

// Register protocol handlers
const protocols = ["msoutlook", "mailto"];
protocols.forEach((protocol) => {
	if (!app.isDefaultProtocolClient(protocol, process.execPath)) {
		app.setAsDefaultProtocolClient(protocol, process.execPath);
		logger.info(`Registered as default protocol handler for: ${protocol}`);
	}
});

app.allowRendererProcessReuse = false;

if (!gotTheLock) {
	logger.info("App already running");
	app.quit();
} else {
	app.on("second-instance", mainAppWindow.onAppSecondInstance);
	app.on("open-url", (event, url) => {
		event.preventDefault();
		logger.info("open-url event received:", url);
		mainAppWindow.onAppSecondInstance(event, [url]);
	});
	app.on("ready", handleAppReady);
	app.on("quit", () => logger.debug("quit"));
	app.on("render-process-gone", onRenderProcessGone);
	app.on("will-quit", () => logger.debug("will-quit"));
	app.on("certificate-error", handleCertificateError);
	app.on("select-client-certificate", handleSelectClientCertificate);
	ipcMain.handle("getConfig", handleGetConfig);
	ipcMain.handle("getZoomLevel", handleGetZoomLevel);
	ipcMain.handle("saveZoomLevel", handleSaveZoomLevel);
	ipcMain.handle("play-notification-sound", playNotificationSound);
	ipcMain.handle("set-badge-count", setBadgeCountHandler);
	ipcMain.handle("showEmailNotification", handleShowEmailNotification);
	ipcMain.handle("showReminderNotification", handleShowReminderNotification);
	ipcMain.handle("updateUnreadCount", handleUpdateUnreadCount);
	ipcMain.handle("updateReminderCount", handleUpdateReminderCount);
	ipcMain.handle("account-email-detected", handleAccountEmailDetected);
	ipcMain.handle("create-account", handleCreateAccount);
	ipcMain.handle("remove-account", handleRemoveAccount);
	ipcMain.handle("focus-account", handleFocusAccount);
	ipcMain.handle("toggle-auto-restore", handleToggleAutoRestore);
	ipcMain.handle("set-account-display-name", handleSetAccountDisplayName);
	ipcMain.handle("get-accounts", handleGetAccounts);

	// Tabbed mode IPC handlers
	ipcMain.handle("switch-tab", handleSwitchTab);
	ipcMain.handle("close-tab", handleCloseTab);

	// Quick Compose IPC handlers
	ipcMain.handle("open-quick-compose", handleOpenQuickCompose);
	ipcMain.handle("send-quick-compose", handleSendQuickCompose);
}

// Global reference to account manager (set by mainAppWindow)
let accountManager = null;

// Global reference to quick compose module
let quickCompose = null;

function setAccountManager(am) {
	accountManager = am;
	// Initialize quick compose after account manager is set
	quickCompose = new QuickCompose(accountManager, config);

	// Register global shortcut for quick compose (Ctrl+Shift+N)
	// Common email app shortcut
	globalShortcut.register("CommandOrControl+Shift+N", () => {
		if (quickCompose) {
			quickCompose.openDialog();
		}
	});
	logger.info("Registered global shortcut: Ctrl+Shift+N for Quick Compose");
}

// eslint-disable-next-line no-unused-vars
async function playNotificationSound(event, options) {
	logger.debug(
		`Notificaion => Type: ${options.type}, Audio: ${options.audio}, Title: ${options.title}, Body: ${options.body}`,
	);
	// Player failed to load or notification sound disabled in config
	if (!player || config.disableNotificationSound) {
		logger.debug("Notification sounds are disabled");
		return;
	}

	const sound = notificationSounds.filter((ns) => {
		return ns.type === options.type;
	})[0];

	if (sound) {
		logger.debug(`Playing file: ${sound.file}`);
		await player.play(sound.file);
		return;
	}

	logger.debug("No notification sound played", player, options);
}

function onRenderProcessGone() {
	logger.debug("render-process-gone");
	app.quit();
}

function onAppTerminated(signal) {
	if (signal === "SIGTERM") {
		process.abort();
	} else {
		app.quit();
	}
}

function handleAppReady() {
	process.on("SIGTRAP", onAppTerminated);
	process.on("SIGINT", onAppTerminated);
	process.on("SIGTERM", onAppTerminated);
	//Just catch the error
	process.stdout.on("error", () => {});
	mainAppWindow.onAppReady(appConfig);
}

async function handleGetConfig() {
	return config;
}

async function handleGetZoomLevel(_, name) {
	const partition = getPartition(name) || {};
	return partition.zoomLevel ? partition.zoomLevel : 0;
}

async function handleSaveZoomLevel(_, args) {
	let partition = getPartition(args.partition) || {};
	partition.name = args.partition;
	partition.zoomLevel = args.zoomLevel;
	savePartition(partition);
}

function getPartitions() {
	return appConfig.settingsStore.get("app.partitions") || [];
}

function getPartition(name) {
	const partitions = getPartitions();
	return partitions.filter((p) => {
		return p.name === name;
	})[0];
}

function savePartition(arg) {
	const partitions = getPartitions();
	const partitionIndex = partitions.findIndex((p) => {
		return p.name === arg.name;
	});

	if (partitionIndex >= 0) {
		partitions[partitionIndex] = arg;
	} else {
		partitions.push(arg);
	}
	appConfig.settingsStore.set("app.partitions", partitions);
}

function handleCertificateError() {
	const arg = {
		event: arguments[0],
		webContents: arguments[1],
		url: arguments[2],
		error: arguments[3],
		certificate: arguments[4],
		callback: arguments[5],
		config: config,
	};
	certificateModule.onAppCertificateError(arg, logger);
}

/**
 * Handle client certificate selection for S/MIME
 * This allows Outlook to use system certificates for encrypted emails
 */
function handleSelectClientCertificate(
	event,
	webContents,
	url,
	list,
	callback,
) {
	event.preventDefault();

	logger.info(`Client certificate requested for URL: ${url}`);
	logger.info(`Available certificates: ${list.length}`);

	if (list.length > 0) {
		// Log certificate details for debugging
		list.forEach((cert, index) => {
			logger.info(
				`Certificate ${index}: ${cert.subjectName} (Issuer: ${cert.issuerName})`,
			);
		});

		// Select the first available certificate
		// In a production app, you might want to prompt the user to choose
		callback(list[0]);
		logger.info(`Selected certificate: ${list[0].subjectName}`);
	} else {
		logger.warn("No client certificates available");
		callback();
	}
}

/**
 * Handle user-status-changed message
 *
 * @param {*} event
 * @param {*} count
 */
async function setBadgeCountHandler(event, count) {
	logger.debug(`Badge count set to '${count}'`);
	app.setBadgeCount(count);
}

/**
 * Handle email notification from preload script
 *
 * @param {*} event
 * @param {{address: string, subject: string}} notification
 */
async function handleShowEmailNotification(event, notification) {
	console.log(
		`[Main] Email notification: ${notification.address} - ${notification.subject}`,
	);
	notificationModule.showEmailNotification(notification);
}

/**
 * Handle reminder notification from preload script
 *
 * @param {*} event
 * @param {{text: string, time: string}} notification
 */
async function handleShowReminderNotification(event, notification) {
	console.log(
		`[Main] Reminder notification: ${notification.text} (${notification.time})`,
	);
	notificationModule.showReminderNotification(notification);
}

/**
 * Handle unread count update from preload script
 *
 * @param {*} event
 * @param {{accountId: string|null, count: number}} data
 */
async function handleUpdateUnreadCount(event, data) {
	console.log("[Main] Unread count updated:", data);
	const count = typeof data === "number" ? data : data.count;
	const accountId =
		typeof data === "object" && data.accountId ? data.accountId : null;

	// Update account manager if we have accountId
	if (accountManager && accountId) {
		accountManager.updateUnreadCount(accountId, count);
	} else {
		// Fallback for single account mode
		notificationModule.updateBadgeFromUnreadCount(count);
	}
}

/**
 * @param {*} event
 * @param {{accountId: string|null, count: number}} data
 */
async function handleUpdateReminderCount(event, data) {
	console.log("[Main] Reminder count updated:", data);
	const count = typeof data === "number" ? data : data.count;
	const accountId =
		typeof data === "object" && data.accountId ? data.accountId : null;

	// Update account manager if we have accountId
	if (accountManager && accountId) {
		accountManager.updateReminderCount(accountId, count);
	} else {
		// Fallback for single account mode
		console.log(
			"[Main] Calling notificationModule.updateBadgeFromReminderCount...",
		);
		notificationModule.updateBadgeFromReminderCount(count);
		console.log(
			"[Main] Called notificationModule.updateBadgeFromReminderCount",
		);
	}
}

/**
 * Handle account email detection from preload script
 * @param {*} event
 * @param {{accountId: string, email: string}} data
 */
async function handleAccountEmailDetected(event, data) {
	console.log(
		`[Main] Account email detected: ${data.accountId} -> ${data.email}`,
	);
	if (accountManager) {
		accountManager.setAccountEmail(data.accountId, data.email);
	}
}

/**
 * Handle create account request
 * @param {*} event
 * @param {Object} options
 */
async function handleCreateAccount(event, options) {
	if (accountManager) {
		return accountManager.createAccount(options);
	}
	return null;
}

/**
 * Handle remove account request
 * @param {*} event
 * @param {string} accountId
 */
async function handleRemoveAccount(event, accountId) {
	if (accountManager) {
		accountManager.removeAccount(accountId);
	}
}

/**
 * Handle focus account request
 * @param {*} event
 * @param {string} accountId
 */
async function handleFocusAccount(event, accountId) {
	if (accountManager) {
		accountManager.focusAccount(accountId);
	}
}

/**
 * Handle toggle auto-restore request
 * @param {*} event
 * @param {string} accountId
 */
async function handleToggleAutoRestore(event, accountId) {
	if (accountManager) {
		accountManager.toggleAutoRestore(accountId);
	}
}

/**
 * Handle set account display name request
 * @param {*} event
 * @param {{accountId: string, displayName: string}} data
 */
async function handleSetAccountDisplayName(event, data) {
	if (accountManager) {
		accountManager.setAccountDisplayName(data.accountId, data.displayName);
	}
}

/**
 * Handle get accounts request
 * @returns {Array}
 */
async function handleGetAccounts() {
	if (accountManager) {
		return accountManager.getAllAccounts();
	}
	return [];
}

/**
 * Handle switch tab request (tabbed mode)
 * @param {*} event
 * @param {string} tabId
 */
async function handleSwitchTab(_event, tabId) {
	if (accountManager && accountManager.tabManager) {
		accountManager.tabManager.switchTab(tabId);
	}
}

/**
 * Handle close tab request (tabbed mode)
 * @param {*} event
 * @param {string} tabId
 */
async function handleCloseTab(_event, tabId) {
	if (!accountManager) return;

	const account = accountManager.getAccount(tabId);
	if (!account) return;

	const label = account.email || account.displayName;

	// Confirm before closing tab/removing account
	const result = dialog.showMessageBoxSync({
		type: "warning",
		buttons: ["Cancel", "Close Tab"],
		defaultId: 0,
		cancelId: 0,
		title: "Close Tab",
		message: `Close "${label}"?`,
		detail:
			"This will remove the account from the tab bar. You can add it again later.",
	});

	if (result === 1) {
		accountManager.removeAccount(tabId);
	}
}

/**
 * Handle open quick compose request
 * @param {*} event
 * @param {string} [accountId] - Optional account ID to use
 */
async function handleOpenQuickCompose(_event, accountId) {
	if (!quickCompose) {
		logger.warn("QuickCompose module not initialized");
		return;
	}
	quickCompose.openDialog(accountId);
}

/**
 * Handle send quick compose request (send email directly)
 * @param {*} event
 * @param {{to: string, subject: string, body: string, accountId: string}} data
 */
async function handleSendQuickCompose(_event, data) {
	if (!quickCompose) {
		logger.warn("QuickCompose module not initialized");
		return;
	}

	// For now, just open the compose dialog
	// TODO: Implement direct send via mailto link or API
	const mailtoLink = `mailto:${data.to || ""}?subject=${encodeURIComponent(data.subject || "")}&body=${encodeURIComponent(data.body || "")}`;
	logger.info(`Opening mailto link: ${mailtoLink}`);

	const { shell } = require("electron");
	shell.openExternal(mailtoLink);
}

// Export setAccountManager for use by mainAppWindow
exports.setAccountManager = setAccountManager;
