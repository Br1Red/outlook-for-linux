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
 * Extract sender name from address (handles "Name" or "Name (email@domain.com)")
 * @param {string} address
 * @returns {string}
 */
function getSenderName(address) {
    // If format is "Name (email)", extract just "Name"
    const match = address.match(/^([^(]+)\s*\(/);
    return match ? match[1].trim() : address;
}

/**
 * Show email notification for all current emails
 * @param {EmailNotification} notification
 */
function showEmailNotification(notification) {
    console.log('[Notification Module] showEmailNotification called:', notification);
    if (!notification) return;

    // Check if same notification already exists (compare by sender name + subject)
    const senderName = getSenderName(notification.address);
    if (!emails.find(e => getSenderName(e.address) === senderName && e.subject === notification.subject)) {
        emails.push(notification);
    }

    let title;
    let body;

    if (emails.length === 1) {
        // Single email: show full details
        title = 'New Email';
        body = `From: ${emails[0].address}\nSubject: ${emails[0].subject}\n\nMessage: ${emails[0].body}`;
    } else {
        // Multiple emails: check if all from same sender (compare by name only)
        const senderNames = [...new Set(emails.map(e => getSenderName(e.address)))];

        if (senderNames.length === 1) {
            // All from same sender: group by sender
            title = `${emails.length} new emails from ${senderNames[0]}`;
            body = emails.map(e => `• Subject: ${e.subject}`).join('\n');
        } else {
            // Different senders: show sender + subject (no message body)
            title = `${emails.length} New Emails`;
            body = emails.map(e => `${getSenderName(e.address)}\n• Subject: ${e.subject}`).join('\n\n');
        }
    }

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
