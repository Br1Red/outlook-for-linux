# Intune SSO

Outlook for Linux can use the Microsoft Identity Broker installed on a managed
Linux workstation. The integration communicates with the broker over the user
session D-Bus and adds the broker-issued PRT SSO credential to Microsoft login
requests.

## Configuration

Enable it in `~/.config/outlook-for-linux/config.json`:

```json
{
  "auth": {
    "intune": {
      "enabled": true,
      "user": "user@example.com"
    }
  }
}
```

`user` is optional. When omitted, the first account returned by the Identity
Broker is used. The Microsoft Identity Broker service must already be enrolled
and running for the desktop user. If it is unavailable, the app logs a warning
and continues with the normal Outlook web sign-in flow.

Intune SSO is disabled by default. Tabbed mode is disabled for the session when
Intune SSO is enabled because the broker account is shared by the app process.