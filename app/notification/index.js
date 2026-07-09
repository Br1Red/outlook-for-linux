const { Notification, app } = require("electron");
const dndManager = require("../utils/dnd");

/**
 * @typedef {Object} ReminderNotification
 * @property {string} subject
 * @property {string} [location]
 * @property {string} timeUntil
 * @property {string} [startTime]
 * @property {string} [reminderType]
 */

/**
 * @typedef {Object} EmailNotification
 * @property {string} address
 * @property {string} subject
 * @property {string} [body]
 */

let mainWindow = null;
let iconPath = null;
let menusInstance = null;

// Badge count tracking
let currentEmailCount = 0;
let currentReminderCount = 0;
let alternatingInterval = null;

// Per-item notifications
/** @type {Map<string, Electron.Notification>} */
let emailNotifications = new Map();
/** @type {Map<string, Electron.Notification>} */
let reminderNotifications = new Map();

/**
 * Initialize the notification module
 * @param {BrowserWindow} window - The main application window
 * @param {string} icon - Path to the notification icon
 * @param {object} menus - The Menus instance for updating tray badge
 */
function init(window, icon, menus) {
	mainWindow = window;
	iconPath = icon;
	menusInstance = menus;
	console.log("[Notification Module] Initialized with icon:", icon);
	console.log(
		"[Notification Module] Notification.isSupported():",
		Notification.isSupported(),
	);
}

/**
 * Update badge based on Outlook's unread count
 * @param {number} count - Unread email count from Outlook
 */
function updateBadgeFromUnreadCount(count) {
	console.log(
		"[Notification Module] updateBadgeFromUnreadCount called with count:",
		count,
	);
	currentEmailCount = count;
	updateAlternatingBadge();
}

/**
 * Update badge based on active reminder count
 * @param {number} count - Active reminder count
 */
function updateBadgeFromReminderCount(count) {
	console.log(
		"[Notification Module] updateBadgeFromReminderCount called with count:",
		count,
	);
	currentReminderCount = count;
	updateAlternatingBadge();
}

/**
 * Update badge with alternating logic
 */
function updateAlternatingBadge() {
	console.log(
		"[Notification Module] updateAlternatingBadge called - emails:",
		currentEmailCount,
		"reminders:",
		currentReminderCount,
	);

	// Stop any existing alternating interval
	if (alternatingInterval) {
		clearInterval(alternatingInterval);
		alternatingInterval = null;
	}

	// If both counts exist, alternate between them
	if (currentEmailCount > 0 && currentReminderCount > 0) {
		console.log("[Notification Module] Both counts > 0, starting alternation");
		let showEmail = true;

		// Initial display
		updateTrayBadge(
			showEmail ? currentEmailCount : currentReminderCount,
			showEmail ? "email" : "reminder",
		);

		// Alternate every 3 seconds
		alternatingInterval = setInterval(() => {
			showEmail = !showEmail;
			console.log(
				"[Notification Module] Alternating to:",
				showEmail ? "email" : "reminder",
			);
			updateTrayBadge(
				showEmail ? currentEmailCount : currentReminderCount,
				showEmail ? "email" : "reminder",
			);
		}, 3000);
	}
	// Only emails
	else if (currentEmailCount > 0) {
		console.log("[Notification Module] Only emails, showing email badge");
		updateTrayBadge(currentEmailCount, "email");
	}
	// Only reminders
	else if (currentReminderCount > 0) {
		console.log("[Notification Module] Only reminders, showing reminder badge");
		updateTrayBadge(currentReminderCount, "reminder");
	}
	// No badges
	else {
		console.log("[Notification Module] No badges to show");
		updateTrayBadge(0, "email");
	}
}

/**
 * Update tray badge with count and type
 * @param {number} count
 * @param {string} type - 'email' or 'reminder'
 */
function updateTrayBadge(count, type) {
	console.log(
		"[Notification Module] updateTrayBadge called - count:",
		count,
		"type:",
		type,
	);
	app.setBadgeCount(count);
	if (menusInstance) {
		menusInstance.updateTrayBadge(count, type);
	}
}

/**
 * Reset current email and reminder notifications
 */
function reset() {
	emailNotifications.forEach((notification) => notification.close());
	reminderNotifications.forEach((notification) => notification.close());
	emailNotifications.clear();
	reminderNotifications.clear();
}

/**
 * Show all account windows (or the stored main window)
 */
function showApp() {
	if (menusInstance) {
		menusInstance.open();
	} else if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.show();
		mainWindow.focus();
	}
}

/**
 * Generate a stable key for a notification
 * @param {string} type
 * @param {Object} data
 * @returns {string}
 */
function makeKey(type, data) {
	if (type === "email") {
		return `email:${data.address || ""}:${data.subject || ""}`;
	}
	return `reminder:${data.subject || ""}:${data.timeUntil || ""}`;
}

/**
 * Show reminder notification for a single reminder
 * @param {ReminderNotification} notification
 */
function showReminderNotification(notification) {
	if (!notification) return;

	// Check DND before showing notification
	if (dndManager.isDNDActive()) {
		console.log(
			"[Notification] DND active - suppressing reminder notification",
		);
		return;
	}

	const key = makeKey("reminder", notification);
	if (reminderNotifications.has(key)) {
		console.log("[Notification] Reminder notification already showing:", key);
		return;
	}

	const title = `${notification.reminderType || "Reminder"}: ${notification.subject}`;
	const details = [];
	if (notification.timeUntil) details.push(`Time: ${notification.timeUntil}`);
	if (notification.startTime) details.push(`Start: ${notification.startTime}`);
	if (notification.location) details.push(`Location: ${notification.location}`);
	const body = details.join("\n");

	const notif = new Notification({
		title,
		body,
		icon: iconPath,
		urgency: "normal",
	});

	notif.on("click", () => {
		console.log("[Notification] Reminder clicked:", key);
		notif.close();
		reminderNotifications.delete(key);
		showApp();
	});

	notif.on("close", () => {
		reminderNotifications.delete(key);
	});

	reminderNotifications.set(key, notif);
	notif.show();
}

/**
 * Show email notification for a single email
 * @param {EmailNotification} notification
 */
function showEmailNotification(notification) {
	console.log(
		"[Notification Module] showEmailNotification called:",
		notification,
	);
	if (!notification) return;

	// Check DND before showing notification
	if (dndManager.isDNDActive()) {
		console.log("[Notification] DND active - suppressing email notification");
		return;
	}

	const key = makeKey("email", notification);
	if (emailNotifications.has(key)) {
		console.log("[Notification] Email notification already showing:", key);
		return;
	}

	const title = "New Email";
	const body = `From: ${notification.address}\nSubject: ${notification.subject}${notification.body ? "\n\n" + notification.body : ""}`;

	const notif = new Notification({
		title,
		body,
		icon: iconPath,
		urgency: "normal",
	});

	notif.on("click", () => {
		console.log("[Notification] Email clicked:", key);
		notif.close();
		emailNotifications.delete(key);
		showApp();
	});

	notif.on("close", () => {
		emailNotifications.delete(key);
	});

	emailNotifications.set(key, notif);
	console.log("[Notification Module] Showing email notification...");
	notif.show();
}

module.exports = {
	init,
	reset,
	showReminderNotification,
	showEmailNotification,
	updateBadgeFromUnreadCount,
	updateBadgeFromReminderCount,
};
