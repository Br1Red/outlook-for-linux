const { execSync } = require('child_process');

/**
 * Detect system Do Not Disturb status on Linux
 */
class DNDManager {
	constructor() {
		/** @type {boolean} */
		this.manualDND = false; // User-controlled DND toggle
		/** @type {NodeJS.Timeout|null} */
		this.cacheTimeout = null;
		/** @type {boolean|null} */
		this.cachedSystemDND = null;
	}

	/**
	 * Check if notifications should be suppressed (DND is active)
	 * @returns {boolean}
	 */
	isDNDActive() {
		// Manual DND takes priority
		if (this.manualDND) {
			return true;
		}

		// Check system DND
		return this.checkSystemDND();
	}

	/**
	 * Toggle manual DND mode
	 * @returns {boolean} New DND state
	 */
	toggleManualDND() {
		this.manualDND = !this.manualDND;
		console.log('[DND] Manual DND toggled to:', this.manualDND);
		return this.manualDND;
	}

	/**
	 * Set manual DND state
	 * @param {boolean} state
	 */
	setManualDND(state) {
		this.manualDND = state;
		console.log('[DND] Manual DND set to:', state);
	}

	/**
	 * Check system DND status (with caching for performance)
	 * @returns {boolean}
	 */
	checkSystemDND() {
		// Use cached value if available and fresh (< 5 seconds old)
		if (this.cachedSystemDND !== null) {
			return this.cachedSystemDND;
		}

		const result = this.detectSystemDND();

		// Cache for 5 seconds
		this.cachedSystemDND = result;
		if (this.cacheTimeout) {
			clearTimeout(this.cacheTimeout);
		}
		this.cacheTimeout = setTimeout(() => {
			this.cachedSystemDND = null;
		}, 5000);

		return result;
	}

	/**
	 * Detect system DND from various desktop environments
	 * @returns {boolean}
	 */
	detectSystemDND() {
		try {
			// GNOME: Check notification settings
			if (this.isGNOME()) {
				return this.checkGNOMEDND();
			}

			// KDE: Check notification settings
			if (this.isKDE()) {
				return this.checkKDEDND();
			}

			// Check for common DND indicators (session inhibitors, etc.)
			return this.checkGenericDND();
		} catch (err) {
			console.error('[DND] Error detecting system DND:', err.message);
			return false;
		}
	}

	/**
	 * Check if running on GNOME
	 * @returns {boolean}
	 */
	isGNOME() {
		try {
			const desktop = process.env.DESKTOP_SESSION || process.env.XDG_CURRENT_DESKTOP || '';
			return desktop.toLowerCase().includes('gnome');
		} catch {
			return false;
		}
	}

	/**
	 * Check if running on KDE
	 * @returns {boolean}
	 */
	isKDE() {
		try {
			const desktop = process.env.DESKTOP_SESSION || process.env.XDG_CURRENT_DESKTOP || '';
			return desktop.toLowerCase().includes('kde') || desktop.toLowerCase().includes('plasma');
		} catch {
			return false;
		}
	}

	/**
	 * Check GNOME DND status
	 * @returns {boolean}
	 */
	checkGNOMEDND() {
		try {
			// Check if notifications are enabled
			const result = execSync('gsettings get org.gnome.desktop.notifications show-banners', {
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();

			// "false" means DND is active
			return result === 'false';
		} catch (err) {
			// gsettings not available or command failed
			return false;
		}
	}

	/**
	 * Check KDE DND status
	 * @returns {boolean}
	 */
	checkKDEDND() {
		try {
			// KDE stores notification settings in config files
			// Check for "Do not disturb" mode
			const result = execSync('qdbus org.freedesktop.Notifications /org/freedesktop/Notifications org.freedesktop.Notifications.Valid 2>/dev/null || echo "ok"', {
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();

			// If D-Bus call fails, notifications might be disabled
			return result !== 'ok';
		} catch (err) {
			return false;
		}
	}

	/**
	 * Check generic DND indicators
	 * @returns {boolean}
	 */
	checkGenericDND() {
		// Check for systemd session inhibitors
		try {
			const result = execSync('systemd-inhibit --list --no-legend 2>/dev/null | grep -i "idle" || echo "no-inhibitor"', {
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();

			return result !== 'no-inhibitor';
		} catch {
			return false;
		}
	}
}

// Singleton instance
const dndManager = new DNDManager();

module.exports = dndManager;
