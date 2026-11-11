# Copilot Chat for Raycast

Chat with GitHub Copilot directly from Raycast.

Use your GitHub Copilot subscription to access powerful AI models. Students get GitHub Copilot pro for free, which gives you free access to top-tier AI in your Raycast!

## Features

- **Chat interface**: A full chat experience with message history.
- **Explain Selection**: Select code in any app and ask Copilot to explain it.
- **Proofread Selection**: Improve grammar and clarity of selected text.
- **Quick Ask**: Ask questions directly from the Raycast command bar.
- **Model Selection**: Switch between different Copilot models from your own github copilot account.

![alt text](<./assets/screenshot-1.png>)
![alt text](<./assets/screenshot-2.png>)
![alt text](<./assets/screenshot-3.png>)
![alt text](<./assets/screenshot-4.png>)

## Setup

1. Open any command (e.g., `Copilot Chat`).
2. Follow the instructions to authenticate with your GitHub account.
3. You will be provided with a device code. Copy it and paste it into the GitHub authorization page.
4. Once authenticated, you can start chatting!

## GitHub Enterprise

The extension works with GitHub.com, GitHub Enterprise Cloud with data residency (`*.ghe.com`) and GitHub Enterprise Server.

### Configuration

Open the extension preferences in Raycast (Raycast Settings → Extensions → Copilot Chat) and set:

| Preference | Description | Example |
| --- | --- | --- |
| **GitHub URL** | Base URL of your GitHub instance. Defaults to `https://github.com`. | `https://<org>.ghe.com`, `https://github.example.com` |
| **OAuth Client ID** | Optional. OAuth app client ID used for the device login. Leave empty to use the default. | `Ov23li...` |

The API endpoints are derived from the GitHub URL:

| Instance | Login (device flow) | GitHub API |
| --- | --- | --- |
| GitHub.com | `https://github.com` | `https://api.github.com` |
| GHE.com (data residency) | `https://<org>.ghe.com` | `https://api.<org>.ghe.com` |
| GitHub Enterprise Server | `https://<host>` | `https://<host>/api/v3` |

The Copilot API endpoint (models and chat) is taken from the Copilot token response, so it automatically points to the correct host for your instance. If none is returned, `https://api.githubcopilot.com` is used.

Logins are stored per host. Switching the GitHub URL asks you to authenticate against the new instance, and switching back reuses the previous login.

### OAuth Client ID

By default the extension uses the public client ID of GitHub's Copilot app for VS Code (`01ab8ac9400c4e429b23`). Client IDs are not secrets, but this app is not intended for third-party tools:

- Your enterprise may restrict OAuth app access, in which case the login fails.
- Using it may conflict with GitHub's terms or your company's compliance policies. Check with your GitHub administrators before rolling the extension out to others.

To use your own app instead, ask an administrator to register an OAuth app in your organization or enterprise with **Enable Device Flow** turned on, then enter its client ID in the **OAuth Client ID** preference. Note that the internal Copilot token endpoint may only issue tokens to GitHub's own apps, so this is not guaranteed to work.

### Troubleshooting

- **Login fails / app not allowed**: OAuth app restrictions are blocking the client ID. Use an approved client ID (see above).
- **`Failed to exchange Copilot token`**: Your account on this instance has no Copilot seat, or the OAuth app is not permitted to obtain Copilot tokens.
- **Wrong instance after changing the URL**: Run the logout action in the chat to authenticate again.

## Technical Details

This extension uses internal GitHub's Copilot API. So you need to have an active GitHub account with copilot enabled.
