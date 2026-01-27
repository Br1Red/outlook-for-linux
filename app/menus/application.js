exports = module.exports = (Menus) => ({
	label: 'Application',
	submenu: [
		{
			label: 'About',
			click: () => Menus.about(),
		},
		{
			type: 'separator',
		},
		{
			label: 'Open',
			accelerator: 'ctrl+O',
			click: () => Menus.open(),
		},
		{
			label: 'Refresh',
			accelerator: 'ctrl+R',
			click: () => Menus.reload(),
		},
		{
			label: 'Hide',
			accelerator: 'ctrl+H',
			click: () => Menus.hide(),
		},
		{
			label: 'Debug',
			accelerator: 'ctrl+D',
			click: () => Menus.debug(),
		},
		{
			label: 'Test Notification',
			accelerator: 'ctrl+T',
			click: () => Menus.testNotification(),
		},
		{
			type: 'separator',
		},
		getNotificationsMenu(Menus),
		{
			type: 'separator',
		},
		getSettingsMenu(Menus)
		,
		{
			type: 'separator',
		},
		getQuitMenu(Menus)
	],
});

function getSettingsMenu(Menus) {
	return {
		label: 'Settings',
		submenu: [
			{
				label: 'Save',
				click: () => Menus.saveSettings()
			},
			{
				label: 'Restore',
				click: () => Menus.restoreSettings()
			}
		]
	};
}

function getNotificationsMenu(Menus) {
	return {
		label: 'Notifications',
		submenu: [
			{
				label: 'Auto-dismiss on click',
				type: 'checkbox',
				checked: Menus.notificationAutoDismiss || false,
				click: (menuItem) => Menus.toggleNotificationAutoDismiss(menuItem.checked)
			}
		]
	};
}

function getQuitMenu(Menus) {
	return {
		label: 'Quit',
		submenu: [
			{
				label: 'Normally',
				accelerator: 'ctrl+Q',
				click: () => Menus.quit()
			},
			{
				label: 'Clear Storage',
				click: () => Menus.quit(true)
			}
		]
	};
}