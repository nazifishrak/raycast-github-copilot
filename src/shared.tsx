import {
  Action,
  ActionPanel,
  Icon,
  Toast,
  showToast,
  LocalStorage,
  Detail,
  Clipboard,
  open,
  getPreferenceValues,
} from "@raycast/api";
import { useEffect, useState, useRef } from "react";

const DEFAULT_CLIENT_ID = "01ab8ac9400c4e429b23";
const DEFAULT_GITHUB_URL = "https://github.com";
const DEFAULT_COPILOT_API = "https://api.githubcopilot.com";
export const DEFAULT_MODEL_KEY = "default_model";

type GitHubPreferences = { githubUrl?: string; clientId?: string };

export function getEndpoints() {
  const prefs = getPreferenceValues<GitHubPreferences>();
  const raw = (prefs.githubUrl || DEFAULT_GITHUB_URL).trim();
  const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  const host = url.hostname.toLowerCase();
  const webBase = `${url.protocol}//${url.host}`;

  let apiBase: string;
  if (host === "github.com") {
    apiBase = "https://api.github.com";
  } else if (host.endsWith(".ghe.com")) {
    apiBase = `${url.protocol}//api.${url.host}`;
  } else {
    apiBase = `${webBase}/api/v3`;
  }

  return {
    host,
    webBase,
    apiBase,
    clientId: prefs.clientId?.trim() || DEFAULT_CLIENT_ID,
  };
}

function tokenKey() {
  const { host } = getEndpoints();
  return host === "github.com" ? "gho_token" : `gho_token:${host}`;
}

let copilotTokenCache: {
  token: string;
  expiresAt: number;
  apiBase: string;
  ghoToken: string;
  host: string;
} | null = null;

async function getCopilotSession(
  ghoToken: string,
): Promise<{ token: string; apiBase: string }> {
  const { apiBase, host } = getEndpoints();
  if (
    copilotTokenCache &&
    copilotTokenCache.expiresAt > Date.now() &&
    copilotTokenCache.ghoToken === ghoToken &&
    copilotTokenCache.host === host
  ) {
    return copilotTokenCache;
  }

  const res = await fetch(`${apiBase}/copilot_internal/v2/token`, {
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

  const data = (await res.json()) as {
    token: string;
    expires_at: number;
    endpoints?: { api?: string };
  };
  copilotTokenCache = {
    token: data.token,
    expiresAt: data.expires_at * 1000,
    apiBase: (data.endpoints?.api || DEFAULT_COPILOT_API).replace(/\/+$/, ""),
    ghoToken,
    host,
  };
  return copilotTokenCache;
}

export async function getCopilotToken(ghoToken: string): Promise<string> {
  return (await getCopilotSession(ghoToken)).token;
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

    LocalStorage.getItem<string>(tokenKey()).then((token) => {
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
        const res = await fetch(
          `${getEndpoints().webBase}/login/oauth/access_token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              client_id: getEndpoints().clientId,
              device_code: deviceFlow.device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          },
        );
        const data = (await res.json()) as {
          access_token?: string;
          error?: string;
        };
        if (data.access_token) {
          if (!cancelled) {
            await LocalStorage.setItem(tokenKey(), data.access_token);
            setGhoToken(data.access_token);
            showToast({ style: Toast.Style.Success, title: "Authenticated!" });
          }
        } else if (
          data.error === "authorization_pending" ||
          data.error === "slow_down"
        ) {
          timeoutId = setTimeout(poll, deviceFlow.interval * 1000);
        } else {
          showToast({
            style: Toast.Style.Failure,
            title: "Auth Error",
            message: data.error,
          });
        }
      } catch (e) {
        timeoutId = setTimeout(poll, deviceFlow.interval * 1000);
      }
    };

    if (deviceFlow && !ghoToken) {
      timeoutId = setTimeout(poll, deviceFlow.interval * 1000);
    }
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [deviceFlow, ghoToken]);

  const logout = async () => {
    await LocalStorage.removeItem(tokenKey());
    setGhoToken(null);
    startedRef.current = false;
    startDeviceFlow(setDeviceFlow);
  };

  return { ghoToken, deviceFlow, logout };
}

async function startDeviceFlow(setDeviceFlow: (d: DeviceFlowResponse) => void) {
  try {
    const res = await fetch(`${getEndpoints().webBase}/login/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: getEndpoints().clientId,
        scope: "read:user",
      }),
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
      return (
        <Detail isLoading={true} markdown="Initializing authentication..." />
      );
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
                showToast({
                  style: Toast.Style.Success,
                  title: "Copied code to clipboard",
                });
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
  const { token: copilotToken, apiBase } = await getCopilotSession(ghoToken);
  const res = await fetch(`${apiBase}/models`, {
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
  data.data.forEach((m) => {
    if (!uniqueModels.has(m.id)) {
      uniqueModels.set(m.id, { id: m.id, name: m.name || m.id });
    }
  });
  return Array.from(uniqueModels.values());
}
export type Message = {
  role: "system" | "user" | "assistant";
  content:
  | string
  | {
    type: "text" | "image_url";
    text?: string;
    image_url?: { url: string };
  }[];
};

export async function streamChat(
  ghoToken: string,
  messages: string | Message[],
  onDelta: (content: string) => void,
  onDone: () => void,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
  modelOverride?: string,
) {
  try {
    const modelToUse =
      modelOverride ||
      (await LocalStorage.getItem<string>(DEFAULT_MODEL_KEY)) ||
      "gpt-4.1";
    const { token: copilotToken, apiBase } = await getCopilotSession(ghoToken);

    const formattedMessages =
      typeof messages === "string"
        ? [{ role: "user", content: messages }]
        : messages;

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        "Editor-Version": "vscode/1.83.1",
        "Editor-Plugin-Version": "copilot-chat/0.8.0",
        "User-Agent": "GitHubCopilotChat/0.8.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: formattedMessages,
        stream: true,
        model: modelToUse,
        intent: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = `API returned ${response.status}: ${text}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error?.message) {
          errorMessage = `API Error: ${parsed.error.message}`;
        } else if (parsed.message) {
          errorMessage = `API Error: ${parsed.message}`;
        } else if (parsed.error) {
          errorMessage = `API Error: ${typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error)}`;
        }
      } catch (e) {
        // use raw text
      }
      throw new Error(errorMessage);
    }

    if (!response.body)
      throw new Error("No response body received from the API");

    const decoder = new TextDecoder("utf-8");
    let content = "";
    let buffer = "";

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      if (signal?.aborted) break;
      buffer +=
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              content += delta;
              onDelta(content);
            }
          } catch {
            /* skip */
          }
        }
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      onError(error);
    }
  }
}
