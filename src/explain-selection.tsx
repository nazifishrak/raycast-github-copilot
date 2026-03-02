import {
    Action,
    ActionPanel,
    Icon,
    Toast,
    showToast,
    LocalStorage,
    Detail,
    getSelectedText,
    getPreferenceValues,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { useAuth, AuthGate, getCopilotToken, DEFAULT_MODEL_KEY } from "./shared";

export default function ExplainSelection() {
    const [markdown, setMarkdown] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const { ghoToken, deviceFlow } = useAuth();

    useEffect(() => {
        if (!ghoToken) return;

        let cancelled = false;

        const processSelection = async () => {
            try {
                const selectedText = await getSelectedText();
                if (!selectedText || selectedText.trim() === "") {
                    setMarkdown("**No text selected.** Please highlight some text in an application first, then run this command.");
                    setIsLoading(false);
                    return;
                }

                const preferences = getPreferenceValues<{ customPrompt: string }>();
                const fullPrompt = `${preferences.customPrompt}\n\n\`\`\`\n${selectedText}\n\`\`\``;

                // Use default model saved via "Set Default Copilot Model" command
                const modelToUse = (await LocalStorage.getItem<string>(DEFAULT_MODEL_KEY)) || "gpt-4o";

                const copilotToken = await getCopilotToken(ghoToken);

                const response = await fetch("https://api.githubcopilot.com/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${copilotToken}`,
                        "Editor-Version": "vscode/1.83.1",
                        "Editor-Plugin-Version": "copilot-chat/0.8.0",
                        "User-Agent": "GitHubCopilotChat/0.8.0",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        messages: [{ role: "user", content: fullPrompt }],
                        stream: true,
                        model: modelToUse,
                        intent: true,
                    }),
                });

                if (!response.ok) throw new Error(`API returned ${response.status}: ${await response.text()}`);
                if (!response.body) throw new Error("No response body");

                const decoder = new TextDecoder("utf-8");
                let content = "";
                let buffer = "";

                for await (const chunk of response.body as any) {
                    if (cancelled) break;
                    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });

                    let newlineIndex;
                    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
                        const line = buffer.slice(0, newlineIndex).trim();
                        buffer = buffer.slice(newlineIndex + 1);
                        if (line.startsWith("data: ")) {
                            const data = line.slice(6);
                            if (data === "[DONE]") { setIsLoading(false); break; }
                            try {
                                const parsed = JSON.parse(data);
                                const delta = parsed.choices?.[0]?.delta?.content;
                                if (delta) { content += delta; setMarkdown(content); }
                            } catch { /* skip */ }
                        }
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    setMarkdown(`**Error**: ${String(error)}`);
                    setIsLoading(false);
                }
            }
        };

        processSelection();
        return () => { cancelled = true; };
    }, [ghoToken]);

    return (
        <AuthGate ghoToken={ghoToken} deviceFlow={deviceFlow}>
            <Detail
                isLoading={isLoading}
                markdown={markdown || (isLoading ? "⚡️ Analyzing selection..." : "")}
                actions={
                    <ActionPanel>
                        {markdown && <Action.CopyToClipboard title="Copy Result" content={markdown} />}
                    </ActionPanel>
                }
            />
        </AuthGate>
    );
}
