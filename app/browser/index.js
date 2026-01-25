console.log('[Preload] Script starting...');

(async function () {
	const {ipcRenderer} = require('electron');

	console.log('[Preload] Inside IIFE, getting config...');

	let config;
	ipcRenderer.invoke('getConfig').then(mainConfig => {
		config = mainConfig;
		console.log('[Preload] Config loaded, disableNotifications:', config.disableNotifications);

		// Initialize notification interception FIRST (before other modules that might fail)
		if (!config.disableNotifications) {
			console.log('[Preload] Calling initNotificationInterception...');
			initNotificationInterception(ipcRenderer);
			console.log('[Preload] initNotificationInterception called');
		}

		// Initialize other modules (wrapped in try-catch as they have issues)
		try {
			initializeModules(config, ipcRenderer);
			console.log('[Preload] Modules initialized');
		} catch (err) {
			console.error('[Preload] Error initializing modules:', err);
		}
	}).catch(err => {
		console.error('[Preload] Config error:', err);
	});

	Object.defineProperty(navigator.serviceWorker, 'register', {
		value: () => {
			return Promise.reject();
		}
	});

	// Keep the CustomNotification class for sound playback
	class CustomNotification {
		constructor(title, options) {
			if (config.disableNotifications) {
				return;
			}
			options = options || {};

			const notifSound = {
				type: options.type ? options.type : 'new-message',
				audio: 'default',
				title: title,
				body: options.body
			};
			ipcRenderer.invoke('play-notification-sound', notifSound);

			// Note: Native notifications are handled by MutationObserver below
		}

		static requestPermission(callback) {
			if (typeof (callback) == 'function') {
				callback('granted');
			}
		}

		static get permission() {
			return 'granted';
		}
	}

	window.Notification = CustomNotification;
}());

/**
 * Initialize MutationObserver to intercept Outlook notification elements
 * @param {Electron.IpcRenderer} ipcRenderer
 */
function initNotificationInterception(ipcRenderer) {
	console.log('[Notification] Initializing notification interception...');

	// Wait for DOM to be ready, then setup observer
	const setupObserver = () => {
		// Look for the notification pane container
		const notificationPane = document.querySelector('[data-app-section="NotificationPane"]');

		if (notificationPane) {
			console.log('[Notification] Found NotificationPane, setting up observer');
			observeNotificationPane(notificationPane, ipcRenderer);
		} else {
			// If not found, observe body and wait for it to appear
			console.log('[Notification] NotificationPane not found, observing body for it');
			observeForNotificationPane(ipcRenderer);
		}
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => setTimeout(setupObserver, 2000));
	} else {
		setTimeout(setupObserver, 2000);
	}
}

/**
 * Observe the body to find when NotificationPane appears
 * @param {Electron.IpcRenderer} ipcRenderer
 */
function observeForNotificationPane(ipcRenderer) {
	const bodyObserver = new MutationObserver((mutations) => {
		const notificationPane = document.querySelector('[data-app-section="NotificationPane"]');
		if (notificationPane) {
			console.log('[Notification] NotificationPane appeared, setting up observer');
			bodyObserver.disconnect();
			observeNotificationPane(notificationPane, ipcRenderer);
		}
	});

	if (document.body) {
		bodyObserver.observe(document.body, { childList: true, subtree: true });
	} else {
		setTimeout(() => observeForNotificationPane(ipcRenderer), 1000);
	}
}

/**
 * Observe the NotificationPane for new notifications
 * @param {Element} notificationPane
 * @param {Electron.IpcRenderer} ipcRenderer
 */
function observeNotificationPane(notificationPane, ipcRenderer) {
	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			mutation.addedNodes.forEach(node => {
				if (node.nodeType === Node.ELEMENT_NODE) {
					processNotificationElement(node, ipcRenderer);
				}
			});
		});
	});

	observer.observe(notificationPane, { childList: true, subtree: true });
	console.log('[Notification] Observer attached to NotificationPane');
}

/**
 * Process a potential notification element
 * @param {Element} element
 * @param {Electron.IpcRenderer} ipcRenderer
 */
function processNotificationElement(element, ipcRenderer) {
	// Look for notification buttons inside the element or check if element itself is one
	const buttons = element.querySelectorAll ?
		[...element.querySelectorAll('button[aria-label]'), ...(element.matches?.('button[aria-label]') ? [element] : [])] :
		[];

	// Also check the element itself if it's a button
	if (element.tagName === 'BUTTON' && element.hasAttribute('aria-label')) {
		buttons.push(element);
	}

	buttons.forEach(button => {
		const ariaLabel = button.getAttribute('aria-label') || '';

		// Check if this is an email notification by DOM structure
		if (isEmailNotification(button)) {
			const emailData = extractEmailData(button, ariaLabel);
			if (emailData) {
				console.log('[Notification] Email notification detected:', emailData);
				ipcRenderer.invoke('showEmailNotification', emailData);
			}
		}
		// Check for reminder/calendar notifications
		else if (isReminderNotification(button)) {
			const reminderData = extractReminderData(button, ariaLabel);
			if (reminderData) {
				console.log('[Notification] Reminder notification detected:', reminderData);
				ipcRenderer.invoke('showReminderNotification', reminderData);
			}
		}
	});
}

/**
 * Check if button is an email notification by DOM structure
 * Email notifications have: .ZJg8d (sender), .KTZ84 (subject), .mrxI1 (body)
 * @param {Element} button
 * @returns {boolean}
 */
function isEmailNotification(button) {
	// Check for email notification structure
	const hasSender = button.querySelector('.ZJg8d');
	const hasSubject = button.querySelector('.KTZ84');
	const hasBody = button.querySelector('.mrxI1');

	return !!(hasSender && hasSubject && hasBody);
}

/**
 * Check if button is a reminder notification by DOM structure
 * This is a fallback - identifies notifications that aren't emails
 * @param {Element} button
 * @returns {boolean}
 */
function isReminderNotification(button) {
	// If it has notification structure but is not an email, assume it's a reminder
	// Reminders typically have similar structure but different content
	const hasNotificationStructure = button.querySelector('.ZJg8d') || button.querySelector('.KTZ84');
	const isEmail = isEmailNotification(button);

	return hasNotificationStructure && !isEmail;
}

/**
 * Extract email data from notification button
 * @param {Element} button
 * @param {string} ariaLabel
 * @returns {{address: string, subject: string} | null}
 */
function extractEmailData(button, ariaLabel) {
    // 1. Get Sender Name
    const senderElement = button.querySelector('.ZJg8d > div:first-child');
    const senderName = senderElement?.textContent?.trim();

    // 2. Get Subject
    const subjectElement = button.querySelector('.KTZ84');
    const subject = subjectElement?.textContent?.trim();

    // 3. Extract Body and Email
    const bodyElement = button.querySelector('.mrxI1');
    let senderEmail = null;
    let messageBody = '';

    if (bodyElement) {
        const fullText = bodyElement.textContent;
        
        // Extract Email: Look for <email@address.com>
        const emailMatch = fullText.match(/<([^>]+)>/);
        if (emailMatch && emailMatch[1]) {
            senderEmail = emailMatch[1];
        }

        // Process lines to clean up the body
        const lines = fullText.split('\n');
        const cleanLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Stop if we hit the Hungarian "wrote" phrase
            if (line.includes(' ezt írta')) break;

            // Stop if we hit a line that looks like "Name <email>" (common footer in replies)
            // We assume a footer doesn't contain a colon (like "Subject:") and ends with an email in brackets
            if (/<[^>]+>$/.test(line) && !line.includes(':')) break;

            // Add line if it's not empty and we haven't reached 3 lines yet
            if (line && cleanLines.length < 3) {
                cleanLines.push(line);
            } else if (cleanLines.length >= 3) {
                break;
            }
        }

        messageBody = cleanLines.join('\n');
    }

    // 4. Format Address as "Name (email)"
    let formattedAddress = '';
    if (senderName && senderEmail) {
        formattedAddress = `${senderName} (${senderEmail})`;
    } else if (senderName) {
        formattedAddress = senderName;
    } else if (senderEmail) {
        formattedAddress = senderEmail;
    } else {
        // Fallback logic using aria-label
        const colonIndex = ariaLabel.indexOf(':');
        formattedAddress = colonIndex > -1 ? ariaLabel.substring(colonIndex + 1).trim() : 'Unknown';
    }

    return {
        address: formattedAddress,
        subject: subject || 'New message',
        body: messageBody
    };
}

/**
 * Extract reminder data from notification button
 * @param {Element} button
 * @param {string} ariaLabel
 * @returns {{text: string, time: string} | null}
 */
function extractReminderData(button, ariaLabel) {
	// Try to get reminder text from the DOM
	const textElement = button.querySelector('.KTZ84') || button.querySelector('.ZJg8d > div:first-child');
	const text = textElement?.textContent?.trim() || ariaLabel;

	// Try to find time element
	const timeElement = button.querySelector('[class*="time"]');
	const time = timeElement?.textContent?.trim() || 'Now';

	return {
		text: text || 'Reminder',
		time: time
	};
}

/**
 * @param {object} config
 * @param {Electron.IpcRenderer} ipcRenderer
 */
function initializeModules(config, ipcRenderer) {
	require('./tools/zoom').init(config);
	require('./tools/shortcuts').init(config);
	require('./tools/settings').init(config, ipcRenderer);
}
