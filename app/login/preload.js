const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('outlookLogin', {
	submit: (data) => {
		if (!data || typeof data.username !== 'string' || typeof data.password !== 'string') {
			return;
		}
		ipcRenderer.send('submitForm', {
			username: data.username,
			password: data.password,
		});
	},
});
