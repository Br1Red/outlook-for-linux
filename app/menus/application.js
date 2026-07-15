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
			label: 'New Message',
			accelerator: 'ctrl+N',
			click: () => Menus.openQuickCompose ? Menus.openQuickCompose() : null,
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
		getAccountsMenu(Menus),
		{
			type: 'separator',
		},
		getSettingsMenu(Menus),
		{
			type: 'separator',
		},
		getQuitMenu(Menus)
	],
});

function getAccountsMenu(Menus) {
	return {
		label: 'Accounts',
		submenu: Menus.getAccountsMenuItems ? Menus.getAccountsMenuItems() : [
			{
				label: 'Add Account',
				click: () => Menus.createAccount()
			}
		]
	};
}

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