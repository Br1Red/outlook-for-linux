
exports.onAppCertificateError = function onAppCertificateError(arg, logger) {
	if (arg.error === 'net::ERR_CERT_AUTHORITY_INVALID') {
		let unknownIssuerCert = getCertIssuer(arg.certificate);
		if (arg.config.customCACertsFingerprints.includes(unknownIssuerCert.fingerprint)) {
			arg.event.preventDefault();
			arg.callback(true);
		} else {
			logger.error('Unknown cert issuer for url: ' + arg.url);
			logger.error('Issuer Name: ' + unknownIssuerCert.issuerName);
			logger.error('The unknown certificate fingerprint is: ' + unknownIssuerCert.fingerprint);
			arg.callback(false);
		}
	} else {
		logger.error('An unexpected SSL error has occurred: ' + arg.error);
		arg.callback(false);
	}
};

exports.selectClientCertificate = function selectClientCertificate(arg) {
	const { list, configuredSubject, dialog, logger } = arg;
	if (!Array.isArray(list) || list.length === 0) {
		logger.warn('No client certificates available');
		return null;
	}

	if (configuredSubject) {
		const configuredCertificate = list.find((certificate) =>
			certificate.subjectName === configuredSubject,
		);
		if (configuredCertificate) return configuredCertificate;
		logger.warn(`Configured client certificate was not found: ${configuredSubject}`);
	}

	if (list.length === 1 || !dialog) return list[0];

	const result = dialog.showMessageBoxSync({
		type: 'question',
		buttons: list.map((certificate) => certificate.subjectName || certificate.issuerName),
		cancelId: -1,
		defaultId: 0,
		title: 'Select client certificate',
		message: 'Choose the certificate Outlook should use for this connection.',
		noLink: true,
	});

	return result >= 0 ? list[result] : null;
};

function getCertIssuer(cert) {
	if ('issuerCert' in cert && cert.issuerCert !== cert) {
		return getCertIssuer(cert.issuerCert);
	}
	return cert;
}
