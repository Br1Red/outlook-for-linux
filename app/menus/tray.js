const { Tray, Menu, nativeImage } = require('electron');

class ApplicationTray {
	constructor(window, appMenu, iconPath, config) {
		this.window = window;
		this.iconPath = iconPath;
		this.appMenu = appMenu;
		this.config = config;
		this.addTray();
	}

	addTray() {
		this.tray = new Tray(this.iconPath);
		this.tray.setToolTip('Microsoft Outlook');
		this.tray.on('click', () => this.showAndFocusWindow());
		this.tray.setContextMenu(Menu.buildFromTemplate(this.appMenu));
	}

	/**
	 * Update the tray icon with a badge count
	 * @param {number} count - Number to display on the badge
	 * @param {string} type - 'email' or 'reminder' (default: 'email')
	 */
	async updateBadge(count, type = 'email') {
		if (count > 0 && this.window && this.window.webContents) {
			// Determine badge color based on type
			const badgeColor = type === 'reminder' ? '#FF6600' : '#FF0000'; // Orange for reminders, red for emails
			const tooltipText = type === 'reminder'
				? `Microsoft Outlook - ${count} active reminder${count > 1 ? 's' : ''}`
				: `Microsoft Outlook - ${count} unread email${count > 1 ? 's' : ''}`;

			// Get icon data URL first
			const iconDataURL = nativeImage.createFromPath(this.iconPath).toDataURL();

			// Render badge in the renderer process (has access to Canvas API)
			try {
				const dataURL = await this.window.webContents.executeJavaScript(
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
		this.window.show();
		this.window.focus();
	}

	close() {
		this.tray.destroy();
	}
}
exports = module.exports = ApplicationTray;