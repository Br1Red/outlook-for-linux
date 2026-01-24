const { Notification, BrowserWindow } = require('electron');
const path = require('path');

/**
 * @typedef {Object} ReminderNotification
 * @property {string} time
 * @property {string} text
 */

/**
 * @typedef {Object} EmailNotification
 * @property {string} address
 * @property {string} subject
 */

let reminders = [];
let emails = [];
let reminderNotificationHandle = null;
let emailNotificationHandle = null;
let mainWindow = null;
let iconPath = null;

/**
 * Initialize the notification module
 * @param {BrowserWindow} window - The main application window
 * @param {string} icon - Path to the notification icon
 */
function init(window, icon) {
	mainWindow = window;
	iconPath = icon;
	console.log('[Notification Module] Initialized with icon:', icon);
	console.log('[Notification Module] Notification.isSupported():', Notification.isSupported());
}

/**
 * Reset current email and reminder notifications
 */
function reset() {
	reminders = [];
	emails = [];
	if (reminderNotificationHandle) {
		reminderNotificationHandle.close();
		reminderNotificationHandle = null;
	}
	if (emailNotificationHandle) {
		emailNotificationHandle.close();
		emailNotificationHandle = null;
	}
}

/**
 * Show reminder notification for all current reminders
 * @param {ReminderNotification} notification
 */
function showReminderNotification(notification) {
	if (!notification) return;

	// Check if same notification already exists
	if (!reminders.find(r => r.text === notification.text && r.time === notification.time)) {
		reminders.push(notification);
	}

	const body = reminders.map(r => {
		return `${r.text} (${r.time})`;
	}).join('\n');

	const title = reminders.length === 1 ? 'New Reminder' : `${reminders.length} New Reminders`;

	if (!reminderNotificationHandle) {
		reminderNotificationHandle = new Notification({
			title,
			body,
			icon: iconPath,
			urgency: 'normal',
		});

		reminderNotificationHandle.on('click', () => {
			reminders = [];
			if (mainWindow) {
				mainWindow.show();
				mainWindow.focus();
			}
			if (reminderNotificationHandle) {
				reminderNotificationHandle.close();
				reminderNotificationHandle = null;
			}
		});

		reminderNotificationHandle.on('close', () => {
			reminders = [];
			reminderNotificationHandle = null;
		});
	} else {
		// Update existing notification - need to recreate since Electron doesn't support updating
		reminderNotificationHandle.close();
		reminderNotificationHandle = new Notification({
			title,
			body,
			icon: iconPath,
			urgency: 'normal',
		});

		reminderNotificationHandle.on('click', () => {
			reminders = [];
			if (mainWindow) {
				mainWindow.show();
				mainWindow.focus();
			}
			if (reminderNotificationHandle) {
				reminderNotificationHandle.close();
				reminderNotificationHandle = null;
			}
		});

		reminderNotificationHandle.on('close', () => {
			reminders = [];
			reminderNotificationHandle = null;
		});
	}

	reminderNotificationHandle.show();
}

/**
 * Show email notification for all current emails
 * @param {EmailNotification} notification
 */
function showEmailNotification(notification) {
    console.log('[Notification Module] showEmailNotification called:', notification);
    if (!notification) return;

    // Check if same notification already exists
    if (!emails.find(e => e.address === notification.address && e.subject === notification.subject)) {
        emails.push(notification);
    }

    const body = emails.map(e => {
        return `Sender: ${e.address}\nSubject: ${e.subject}\r\n\r\nMessage: ${e.body}`;
    }).join('\n');

    const title = emails.length === 1 ? 'New Email' : `${emails.length} New Emails`;

    if (!emailNotificationHandle) {
        emailNotificationHandle = new Notification({
            title,
            body,
            icon: iconPath,
            urgency: 'normal',
        });

        emailNotificationHandle.on('click', () => {
            emails = [];
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
            if (emailNotificationHandle) {
                emailNotificationHandle.close();
                emailNotificationHandle = null;
            }
        });

        emailNotificationHandle.on('close', () => {
            emails = [];
            emailNotificationHandle = null;
        });
    } else {
        // Update existing notification - need to recreate since Electron doesn't support updating
        emailNotificationHandle.close();
        emailNotificationHandle = new Notification({
            title,
            body,
            icon: iconPath,
            urgency: 'normal',
        });

        emailNotificationHandle.on('click', () => {
            emails = [];
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
            if (emailNotificationHandle) {
                emailNotificationHandle.close();
                emailNotificationHandle = null;
            }
        });

        emailNotificationHandle.on('close', () => {
            emails = [];
            emailNotificationHandle = null;
        });
    }

    console.log('[Notification Module] Showing email notification...');
    emailNotificationHandle.show();
}

module.exports = {
	init,
	reset,
	showReminderNotification,
	showEmailNotification
};
