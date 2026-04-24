const keytar = require('keytar');

/**
 * Ask KeePassXC (via Secret Service) for credentials matching a site.
 * KeePassXC will prompt the user if needed.
 *
 * @param {string} hostname
 * @returns {Promise<Array<{ account: string, password: string }>>}
 */
async function getCredentialsForSite(hostname) {
    return keytar.findCredentials(hostname);
}

module.exports = {
    getCredentialsForSite
};
