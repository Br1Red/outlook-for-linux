const { contextBridge, ipcRenderer } = require('electron');

function readArgument(name) {
	const prefix = `--${name}=`;
	const argument = process.argv.find((value) => value.startsWith(prefix));
	return argument ? argument.slice(prefix.length) : '';
}

const type = readArgument('dialog-type');
let data = {};

try {
	const encodedData = readArgument('dialog-data');
	data = encodedData ? JSON.parse(decodeURIComponent(encodedData)) : {};
} catch (error) {
	console.error('[Dialog] Invalid dialog data:', error);
}

document.addEventListener('DOMContentLoaded', () => {
	document.documentElement.dataset.theme = data.isDarkMode ? 'dark' : 'light';
});

contextBridge.exposeInMainWorld('outlookDialog', {
	type,
	data,
	submitRename: (name) => ipcRenderer.send('rename-account-result', name),
	selectMailtoAccount: (accountId) =>
		ipcRenderer.send('mailto-account-selected', accountId),
	selectTrayAccount: (result) =>
		ipcRenderer.send('tray-account-selection', result),
	selectStartupAccounts: (accountIds) =>
		ipcRenderer.send('startup-account-selection', accountIds),
});
