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
	 */
	async updateBadge(count) {
		if (count > 0 && this.window && this.window.webContents) {
			// Render badge in the renderer process (has access to Canvas API)
			try {
				const dataURL = await this.window.webContents.executeJavaScript(`
					(function() {
						const canvas = document.createElement('canvas');
						canvas.width = 140;
						canvas.height = 140;
						const ctx = canvas.getContext('2d');

						// Load base icon
						const image = new Image();
						image.src = '${nativeImage.createFromPath(this.iconPath).toDataURL()}';

						return new Promise((resolve) => {
							image.onload = () => {
								// Draw base icon
								ctx.drawImage(image, 0, 0, 140, 140);

								// Draw red badge circle
								ctx.fillStyle = 'red';
								ctx.beginPath();
								ctx.ellipse(105, 35, 35, 35, 35, 0, 2 * Math.PI);
								ctx.fill();

								// Draw count text
								ctx.textAlign = 'center';
								ctx.fillStyle = 'white';
								ctx.font = 'bold 70px "Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif';
								ctx.fillText(${count} > 9 ? '9+' : '${count}', 105, 60);

								resolve(canvas.toDataURL());
							};
						});
					})()
				`);

				const image = nativeImage.createFromDataURL(dataURL);
				this.tray.setImage(image);
				this.tray.setToolTip(`Microsoft Outlook - ${count} unread email${count > 1 ? 's' : ''}`);
			} catch (err) {
				console.error('[Tray] Failed to render badge:', err);
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