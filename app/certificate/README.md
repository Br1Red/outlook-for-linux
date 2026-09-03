# Certificates

This folder contains the certificate handlers used by Electron.

## Client certificates

Outlook Web can request a client certificate through Chromium. The application
uses certificates already available to Electron and asks which one to use when
more than one certificate is offered. Set `clientCertSubject` to select one
without a prompt:

```json
{
    "clientCertSubject": "CN=alice@example.com"
}
```

Electron does not implement the Native Messaging APIs required by the official
Microsoft S/MIME extension. Therefore `OWA-SMIME4Linux` cannot run inside this
application. Use it with Chromium or Chrome instead, following the
[upstream installation instructions](https://github.com/schorschii/OWA-SMIME4Linux).

You can define the valid certificates by prodiving the customCACertsFingerprints config option.

Further information about config options can be found in the [config README.md file](../config/README.md).

## Getting custom CA Certs fingerprints

The expected fingerprints are of the form `sha256/<base64 encoded sha256sum>`. Tools like openssl usually deliver the sha256sum
 encoded in hexadecimal format. If you have access to the nodejs console, the fingerprint of the CA that cannot be validated
 will be printed out. You can then start outlook-for-linux again with

```bash
outlook-for-linux --customCACertsFingerprints sha256//L/iiGIG9ysnWTyLBwKX4S12ntEO15MHBagJjv/BTRc= [--customCACertsFingerprints otherfingerprint]`
```

If you already have the certificate in a file locally, you can calculate the expected fingerprint with the following command:

```bash
echo sha256/$(openssl x509 -in /path/to/certificate -noout -fingerprint -sha256 | sed -e "s/^.*=//g" -e "s/://g" | xxd -r -p | base64)
```

To have your custom certs recognized on every run, add them to your `~/.config/outlook-for-linux/config.json`

```json
{
    "customCACertsFingerprints": [
        "sha256//L/iiGIG9ysnWTyLBwKX4S12ntEO15MHBagJjv/BTRc=",
        "sha256/QNUEPU40JDSrRcW9CSWsPKJ5llVjGcc1AnsIkCF9KV4="
    ]
}
```
