import {
    Action,
    ActionPanel,
    List,
    Icon,
    Toast,
    showToast,
    LocalStorage,
    Detail,
    Clipboard,
    open,
} from "@raycast/api";
import { useEffect, useState, useRef } from "react";

const clientId = "01ab8ac9400c4e429b23";
const GHO_TOKEN_KEY = "gho_token";
export const DEFAULT_MODEL_KEY = "default_model";

let copilotTokenCache: { token: string; expiresAt: number } | null = null;

export async function getCopilotToken(ghoToken: string): Promise<string> {
    if (copilotTokenCache && copilotTokenCache.expiresAt > Date.now()) {
        return copilotTokenCache.token;
    }

    const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
        headers: {
            Authorization: `token ${ghoToken}`,
            Accept: "application/json",
            "User-Agent": "VSCode/1.80",
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to exchange Copilot token: ${text}`);
    }

    const data = (await res.json()) as { token: string; expires_at: number };
    copilotTokenCache = {
        token: data.token,
        expiresAt: data.expires_at * 1000,
    };
    return data.token;
}

export type CopilotModel = {
    id: string;
    name: string;
};

export type DeviceFlowResponse = {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
};

export function useAuth() {
    const [ghoToken, setGhoToken] = useState<string | null>(null);
    const [deviceFlow, setDeviceFlow] = useState<DeviceFlowResponse | null>(null);
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        LocalStorage.getItem<string>(GHO_TOKEN_KEY).then((token) => {
            if (token) {
                setGhoToken(token);
            } else {
                startDeviceFlow(setDeviceFlow);
            }
        });
    }, []);

    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        let cancelled = false;

        const poll = async () => {
            if (!deviceFlow || cancelled) return;
            try {
                const res = await fetch("https://github.com/login/oauth/access_token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({
                        client_id: clientId,
                        device_code: deviceFlow.device_code,
                        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    }),
                });
                const data = await res.json() as any;
                if (data.access_token) {
                    if (!cancelled) {
                        await LocalStorage.setItem(GHO_TOKEN_KEY, data.access_token);
                        setGhoToken(data.access_token);
                        showToast({ style: Toast.Style.Success, title: "Authenticated!" });
                    }
                } else if (data.error === "authorization_pending" || data.error === "slow_down") {
                    timeoutId = setTimeout(poll, deviceFlow.interval * 1000);
                } else {
                    showToast({ style: Toast.Style.Failure, title: "Auth Error", message: data.error });
                }
            } catch (e) {
                timeoutId = setTimeout(poll, deviceFlow.interval * 1000);
            }
        };

        if (deviceFlow && !ghoToken) {
            timeoutId = setTimeout(poll, deviceFlow.interval * 1000);
        }
        return () => { cancelled = true; if (timeoutId) clearTimeout(timeoutId); };
    }, [deviceFlow, ghoToken]);

    const logout = async () => {
        await LocalStorage.removeItem(GHO_TOKEN_KEY);
        setGhoToken(null);
        startedRef.current = false;
        startDeviceFlow(setDeviceFlow);
    };

    return { ghoToken, deviceFlow, logout };
}

async function startDeviceFlow(setDeviceFlow: (d: DeviceFlowResponse) => void) {
    try {
        const res = await fetch("https://github.com/login/device/code", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ client_id: clientId, scope: "read:user" }),
        });
        const data = (await res.json()) as DeviceFlowResponse;
        setDeviceFlow(data);
    } catch (e) {
        showToast({ style: Toast.Style.Failure, title: "Failed to start auth" });
    }
}

export function AuthGate({
    ghoToken,
    deviceFlow,
    children,
}: {
    ghoToken: string | null;
    deviceFlow: DeviceFlowResponse | null;
    children: React.ReactNode;
}) {
    if (!ghoToken) {
        if (!deviceFlow) {
            return <Detail isLoading={true} markdown="Initializing authentication..." />;
        }
        const markdown = `
# Authenticate with GitHub Copilot

1. Copy your verification code: **\`${deviceFlow.user_code}\`**
2. Open the [GitHub Device Authentication](${deviceFlow.verification_uri}) window.
3. Paste the code and authorize the application.

Waiting for you to authorize...
`;
        return (
            <Detail
                markdown={markdown}
                actions={
                    <ActionPanel>
                        <Action
                            title="Copy Code & Open Browser"
                            icon={Icon.Link}
                            onAction={async () => {
                                await Clipboard.copy(deviceFlow.user_code);
                                showToast({ style: Toast.Style.Success, title: "Copied code to clipboard" });
                                await open(deviceFlow.verification_uri);
                            }}
                        />
                    </ActionPanel>
                }
            />
        );
    }
    return <>{children}</>;
}

export async function fetchModels(ghoToken: string): Promise<CopilotModel[]> {
    const copilotToken = await getCopilotToken(ghoToken);
    const res = await fetch("https://api.githubcopilot.com/models", {
        headers: {
            Authorization: `Bearer ${copilotToken}`,
            "Editor-Version": "vscode/1.83.1",
            "Editor-Plugin-Version": "copilot-chat/0.8.0",
            "User-Agent": "GitHubCopilotChat/0.8.0",
        },
    });
    if (!res.ok) throw new Error(`Models API returned ${res.status}`);
    const data = (await res.json()) as { data: { id: string; name?: string }[] };
    const uniqueModels = new Map<string, CopilotModel>();
    data.data.forEach(m => {
        if (!uniqueModels.has(m.id)) {
            uniqueModels.set(m.id, { id: m.id, name: m.name || m.id });
        }
    });
    return Array.from(uniqueModels.values());
}
