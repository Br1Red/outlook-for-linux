const { app, ipcMain } = require('electron');
const path = require('path');
const { LucidLog } = require('lucid-log');
const isDev = require('electron-is-dev');

// Set app name for notifications BEFORE anything else
app.name = 'Microsoft Outlook';
// Set desktop name to match the .desktop file for notification persistence
if (process.platform === 'linux') {
	app.setDesktopName('outlook-for-linux.desktop');
}

if (app.commandLine.hasSwitch('customUserDir')) {
	app.setPath('userData', app.commandLine.getSwitchValue('customUserDir'));
}

const { AppConfiguration } = require('./appConfiguration');
const appConfig = new AppConfiguration(app.getPath('userData'));

const config = appConfig.startupConfig;
config.appPath = path.join(__dirname, isDev ? '' : '../../');

const logger = new LucidLog({
	levels: config.appLogLevels.split(',')
});

const notificationSounds = [{
	type: 'new-message',
	file: path.join(config.appPath, 'assets/sounds/new_message.wav')
}];

// Notification sound player
/**
 * @type {NodeSoundPlayer}
 */
let player;
try {
	// eslint-disable-next-line no-unused-vars
	const { NodeSound } = require('node-sound');
	player = NodeSound.getDefaultPlayer();
} catch (e) {
	logger.info('No audio players found. Audio notifications might not work.');
}

const certificateModule = require('./certificate');
const notificationModule = require('./notification');
const gotTheLock = app.requestSingleInstanceLock();
const mainAppWindow = require('./mainAppWindow');

if (config.proxyServer) app.commandLine.appendSwitch('proxy-server', config.proxyServer);
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('enable-ntlm-v2', config.ntlmV2enabled);
app.commandLine.appendSwitch('try-supported-channel-layouts');

if (process.env.XDG_SESSION_TYPE === 'wayland') {
	logger.info('Running under Wayland, switching to PipeWire...');

	const features = app.commandLine.hasSwitch('enable-features') ? app.commandLine.getSwitchValue('enable-features').split(',') : [];
	if (!features.includes('WebRTCPipeWireCapturer'))
		features.push('WebRTCPipeWireCapturer');

	app.commandLine.appendSwitch('enable-features', features.join(','));
	app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// Register protocol handlers
const protocols = ['msoutlook', 'mailto'];
protocols.forEach(protocol => {
	if (!app.isDefaultProtocolClient(protocol, process.execPath)) {
		app.setAsDefaultProtocolClient(protocol, process.execPath);
		logger.info(`Registered as default protocol handler for: ${protocol}`);
	}
});

app.allowRendererProcessReuse = false;

if (!gotTheLock) {
	logger.info('App already running');
	app.quit();
} else {
	app.on('second-instance', mainAppWindow.onAppSecondInstance);
	app.on('open-url', (event, url) => {
		event.preventDefault();
		logger.info('open-url event received:', url);
		mainAppWindow.onAppSecondInstance(event, [url]);
	});
	app.on('ready', handleAppReady);
	app.on('quit', () => logger.debug('quit'));
	app.on('render-process-gone', onRenderProcessGone);
	app.on('will-quit', () => logger.debug('will-quit'));
	app.on('certificate-error', handleCertificateError);
	ipcMain.handle('getConfig', handleGetConfig);
	ipcMain.handle('getZoomLevel', handleGetZoomLevel);
	ipcMain.handle('saveZoomLevel', handleSaveZoomLevel);
	ipcMain.handle('play-notification-sound', playNotificationSound);
	ipcMain.handle('set-badge-count', setBadgeCountHandler);
	ipcMain.handle('showEmailNotification', handleShowEmailNotification);
	ipcMain.handle('showReminderNotification', handleShowReminderNotification);
	ipcMain.handle('updateUnreadCount', handleUpdateUnreadCount);
	ipcMain.handle('updateReminderCount', handleUpdateReminderCount);
}

// eslint-disable-next-line no-unused-vars
async function playNotificationSound(event, options) {
	logger.debug(`Notificaion => Type: ${options.type}, Audio: ${options.audio}, Title: ${options.title}, Body: ${options.body}`);
	// Player failed to load or notification sound disabled in config
	if (!player || config.disableNotificationSound) {
		logger.debug('Notification sounds are disabled');
		return;
	}
	
	const sound = notificationSounds.filter(ns => {
		return ns.type === options.type;
	})[0];

	if (sound) {
		logger.debug(`Playing file: ${sound.file}`);
		await player.play(sound.file);
		return;
	}

	logger.debug('No notification sound played', player, options);
}

function onRenderProcessGone() {
	logger.debug('render-process-gone');
	app.quit();
}

function onAppTerminated(signal) {
	if (signal === 'SIGTERM') {
		process.abort();
	} else {
		app.quit();
	}
}

function handleAppReady() {
	process.on('SIGTRAP', onAppTerminated);
	process.on('SIGINT', onAppTerminated);
	process.on('SIGTERM', onAppTerminated);
	//Just catch the error
	process.stdout.on('error', () => { });
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
	return appConfig.settingsStore.get('app.partitions') || [];
}

function getPartition(name) {
	const partitions = getPartitions();
	return partitions.filter(p => {
		return p.name === name;
	})[0];
}

function savePartition(arg) {
	const partitions = getPartitions();
	const partitionIndex = partitions.findIndex(p => {
		return p.name === arg.name;
	});

	if (partitionIndex >= 0) {
		partitions[partitionIndex] = arg;
	} else {
		partitions.push(arg);
	}
	appConfig.settingsStore.set('app.partitions', partitions);
}

function handleCertificateError() {
	const arg = {
		event: arguments[0],
		webContents: arguments[1],
		url: arguments[2],
		error: arguments[3],
		certificate: arguments[4],
		callback: arguments[5],
		config: config
	};
	certificateModule.onAppCertificateError(arg, logger);
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
	console.log(`[Main] Email notification: ${notification.address} - ${notification.subject}`);
	notificationModule.showEmailNotification(notification);
}

/**
 * Handle reminder notification from preload script
 *
 * @param {*} event
 * @param {{text: string, time: string}} notification
 */
async function handleShowReminderNotification(event, notification) {
	console.log(`[Main] Reminder notification: ${notification.text} (${notification.time})`);
	notificationModule.showReminderNotification(notification);
}

/**
 * Handle unread count update from preload script
 *
 * @param {*} event
 * @param {number} count
 */
async function handleUpdateUnreadCount(event, count) {
	console.log(`[Main] Unread count updated: ${count}`);
	notificationModule.updateBadgeFromUnreadCount(count);
}

/**
 * @param {*} event
 * @param {number} count
 */
async function handleUpdateReminderCount(event, count) {
	console.log(`[Main] Reminder count updated: ${count}`);
	console.log('[Main] Calling notificationModule.updateBadgeFromReminderCount...');
	notificationModule.updateBadgeFromReminderCount(count);
	console.log('[Main] Called notificationModule.updateBadgeFromReminderCount');
}