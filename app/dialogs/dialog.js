const api = window.outlookDialog;
const root = document.getElementById('dialog-root');

function element(tagName, options = {}) {
	const node = document.createElement(tagName);
	if (options.className) node.className = options.className;
	if (options.id) node.id = options.id;
	if (options.text) node.textContent = options.text;
	if (options.type) node.type = options.type;
	if (options.value !== undefined) node.value = options.value;
	if (options.placeholder) node.placeholder = options.placeholder;
	if (options.checked !== undefined) node.checked = options.checked;
	if (options.dataset) {
		Object.entries(options.dataset).forEach(([key, value]) => {
			node.dataset[key] = value;
		});
	}
	return node;
}

function closeDialog() {
	window.close();
}

function renderFrame(title, subtitle) {
	const heading = element('h2', { text: title });
	const description = element('p', { text: subtitle });
	root.append(heading, description);
	return element('div', { className: 'dialog-content' });
}

function renderButtons(buttons) {
	const container = element('div', { className: 'buttons' });
	buttons.forEach((button) => container.appendChild(button));
	return container;
}

function renderRename() {
	const data = api.data || {};
	const content = renderFrame('Rename Account', 'Choose a display name for this account.');
	const current = element('p', { className: 'current-name' });
	current.append('Current: ');
	current.appendChild(element('strong', { text: data.currentName || '' }));
	content.appendChild(current);

	if (data.hasManualName) {
		content.appendChild(
			element('p', {
				className: 'info-text',
				text: `Leave empty to revert to auto-detection (${data.email || 'detected email'})`,
			}),
		);
	}

	const input = element('input', {
		id: 'name-input',
		type: 'text',
		value: data.inputValue || '',
		placeholder: data.placeholder || '',
	});
	input.autofocus = true;
	content.appendChild(input);

	const cancel = element('button', { id: 'cancel', text: 'Cancel' });
	const rename = element('button', { id: 'confirm', text: 'Rename' });
	const submit = () => {
		api.submitRename(input.value);
		closeDialog();
	};
	cancel.addEventListener('click', closeDialog);
	rename.addEventListener('click', submit);
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') submit();
		if (event.key === 'Escape') closeDialog();
	});
	content.appendChild(renderButtons([cancel, rename]));
	root.appendChild(content);
	input.select();
}

function renderAccountButton(account, onClick) {
	const button = element('button', {
		className: 'account-button',
		text: account.displayName || 'Account',
	});
	button.addEventListener('click', () => onClick(account.id));
	return button;
}

function renderMailtoAccount() {
	const content = renderFrame('Select Account', 'Which account would you like to use?');
	const list = element('div', { className: 'account-list' });
	(api.data.accounts || []).forEach((account) => {
		list.appendChild(
			renderAccountButton(account, (accountId) => {
				api.selectMailtoAccount(accountId);
				closeDialog();
			}),
		);
	});
	content.appendChild(list);
	root.appendChild(content);
}

function renderTrayAccount() {
	const content = renderFrame('Select Account', 'Which account window would you like to open?');
	const list = element('div', { className: 'account-list' });
	const showAll = element('button', {
		className: 'account-button show-all',
		text: 'Show All Windows',
	});
	showAll.addEventListener('click', () => {
		api.selectTrayAccount({ action: 'show-all' });
		closeDialog();
	});
	list.appendChild(showAll);
	(api.data.accounts || []).forEach((account) => {
		list.appendChild(
			renderAccountButton(account, (accountId) => {
				api.selectTrayAccount({ action: 'focus', accountId });
				closeDialog();
			}),
		);
	});
	content.appendChild(list);
	root.appendChild(content);
}

function renderStartupAccounts() {
	const content = renderFrame(
		'Select Accounts to Open',
		'Choose which accounts to open on startup:',
	);
	const list = element('div', { className: 'account-list startup-list' });
	(api.data.accounts || []).forEach((account) => {
		const label = element('label', { className: 'account-item' });
		const checkbox = element('input', {
			type: 'checkbox',
			checked: account.autoRestore !== false,
			dataset: { accountId: account.id },
		});
		const name = element('span', { text: account.displayName || 'Account' });
		label.append(checkbox, name);
		label.addEventListener('click', (event) => {
			if (event.target !== checkbox) checkbox.checked = !checkbox.checked;
		});
		list.appendChild(label);
	});
	content.appendChild(list);

	const open = element('button', { id: 'confirm', text: 'Open Selected' });
	open.addEventListener('click', () => {
		const accountIds = Array.from(list.querySelectorAll('input:checked')).map(
			(checkbox) => checkbox.dataset.accountId,
		);
		api.selectStartupAccounts(accountIds);
		closeDialog();
	});
	content.appendChild(renderButtons([open]));
	root.appendChild(content);
}

switch (api.type) {
case 'rename':
	renderRename();
	break;
case 'mailto-account':
	renderMailtoAccount();
	break;
case 'tray-account':
	renderTrayAccount();
	break;
case 'startup-account':
	renderStartupAccounts();
	break;
default:
	root.appendChild(element('p', { text: 'Dialog unavailable.' }));
}
