import {
    Action,
    ActionPanel,
    List,
    Icon,
    Toast,
    showToast,
    LocalStorage,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { useAuth, AuthGate, fetchModels, getCopilotToken, DEFAULT_MODEL_KEY, CopilotModel } from "./shared";

type Message = {
    role: "system" | "user" | "assistant";
    content: string;
};

type Chat = {
    id: string;
    title: string;
    updatedAt: string;
    messages: Message[];
};

const MODEL_SESSION_KEY = "selected_model";
const CHATS_SESSION_KEY = "saved_chats";

export default function Command() {
    const [searchText, setSearchText] = useState("");
    const [chats, setChats] = useState<Chat[]>([]);
    const [activeChatId, setActiveChatId] = useState<string>("new");
    const [isLoading, setIsLoading] = useState(false);
    const { ghoToken, deviceFlow, logout } = useAuth();

    const [models, setModels] = useState<CopilotModel[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("gpt-4o");

    // Load saved model preference and chat history on startup
    useEffect(() => {
        const loadState = async () => {
            const sessionModel = await LocalStorage.getItem<string>(MODEL_SESSION_KEY);
            const defaultModel = await LocalStorage.getItem<string>(DEFAULT_MODEL_KEY);
            setSelectedModel(sessionModel || defaultModel || "gpt-4o");

            const savedChatsJson = await LocalStorage.getItem<string>(CHATS_SESSION_KEY);
            if (savedChatsJson) {
                try {
                    const parsed = JSON.parse(savedChatsJson) as Chat[];
                    setChats(parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
                } catch (e) {
                    console.error("Failed to parse chats", e);
                }
            }
        };
        loadState();
    }, []);

    // Fetch available models
    useEffect(() => {
        if (!ghoToken) return;
        fetchModels(ghoToken)
            .then(setModels)
            .catch((err) => console.error("Failed to load models", err));
    }, [ghoToken]);

    const onModelChange = (newValue: string) => {
        setSelectedModel(newValue);
        LocalStorage.setItem(MODEL_SESSION_KEY, newValue);
    };

    const activeChat = chats.find(c => c.id === activeChatId);
    const messages = activeChatId === "new" || !activeChat ? [] : activeChat.messages;

    const saveChats = async (newChats: Chat[]) => {
        setChats(newChats);
        await LocalStorage.setItem(CHATS_SESSION_KEY, JSON.stringify(newChats));
    };

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text.trim() || !ghoToken) return;

            const newMessages: Message[] = [...messages, { role: "user", content: text }];

            // Determine chat to update or create new
            let chatId = activeChatId;
            let currentChats = [...chats];

            if (!chatId || chatId === "new") {
                chatId = Date.now().toString();
                const newChat: Chat = {
                    id: chatId,
                    title: text.substring(0, 40) + (text.length > 40 ? "..." : ""),
                    updatedAt: new Date().toISOString(),
                    messages: newMessages,
                };
                currentChats = [newChat, ...currentChats];
                setActiveChatId(chatId);
            } else {
                const idx = currentChats.findIndex(c => c.id === chatId);
                if (idx !== -1) {
                    currentChats[idx] = {
                        ...currentChats[idx],
                        updatedAt: new Date().toISOString(),
                        messages: newMessages,
                    };
                    // Move to top
                    const [chat] = currentChats.splice(idx, 1);
                    currentChats = [chat, ...currentChats];
                }
            }

            saveChats(currentChats);
            setSearchText("");
            setIsLoading(true);

            try {
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
                        messages: newMessages,
                        stream: true,
                        model: selectedModel,
                        intent: true,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`API returned ${response.status}: ${await response.text()}`);
                }
                if (!response.body) throw new Error("No response body");

                const decoder = new TextDecoder("utf-8");
                let assistantContent = "";

                // Helper to update the last assistant message in the active chat
                const updateAssistantMessage = (content: string) => {
                    setChats(prev => {
                        return prev.map(chat => {
                            if (chat.id === chatId) {
                                // Add assistant message if it doesn't exist yet
                                const msgs = [...chat.messages];
                                if (msgs[msgs.length - 1].role === "user") {
                                    msgs.push({ role: "assistant", content: "" });
                                }
                                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
                                return { ...chat, messages: msgs, updatedAt: new Date().toISOString() };
                            }
                            return chat;
                        });
                    });
                };

                let buffer = "";
                for await (const chunk of response.body as any) {
                    const decodedChunk = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
                    buffer += decodedChunk;

                    let newlineIndex;
                    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
                        const line = buffer.slice(0, newlineIndex).trim();
                        buffer = buffer.slice(newlineIndex + 1);
                        if (line.startsWith("data: ")) {
                            const data = line.slice(6);
                            if (data === "[DONE]") break;
                            try {
                                const parsed = JSON.parse(data);
                                const delta = parsed.choices?.[0]?.delta?.content;
                                if (delta) {
                                    assistantContent += delta;
                                    updateAssistantMessage(assistantContent);
                                }
                            } catch (e) { /* skip incomplete JSON */ }
                        }
                    }
                }
            } catch (error) {
                showToast({ style: Toast.Style.Failure, title: "Failed to send message", message: String(error) });
            } finally {
                setIsLoading(false);
                // Also persist chats when streaming is done
                setChats(prev => {
                    LocalStorage.setItem(CHATS_SESSION_KEY, JSON.stringify(prev));
                    return prev;
                });
            }
        },
        [messages, ghoToken, selectedModel, chats, activeChatId]
    );

    const compiledMarkdown =
        messages.length === 0
            ? "##Type your message below and press `Enter`."
            : [...messages]
                .reverse()
                .map((msg) =>
                    msg.role === "user" ? `---\n**You:**\n\n${msg.content}\n` : `**${Icon.Rocket}:**\n\n${msg.content}\n`
                )
                .join("\n");

    const deleteChat = async (id: string) => {
        const newChats = chats.filter(c => c.id !== id);
        if (activeChatId === id) setActiveChatId("new");
        await saveChats(newChats);
    };

    const clearAllChats = async () => {
        await saveChats([]);
        setActiveChatId("new");
    };

    return (
        <AuthGate ghoToken={ghoToken} deviceFlow={deviceFlow}>
            <List
                isLoading={isLoading}
                searchBarPlaceholder="Ask Copilot..."
                searchText={searchText}
                onSearchTextChange={setSearchText}
                selectedItemId={activeChatId}
                onSelectionChange={(id) => {
                    if (id) setActiveChatId(id);
                }}
                isShowingDetail={true}
                filtering={false}
                searchBarAccessory={
                    models.length > 0 ? (
                        <List.Dropdown tooltip="Select Model" value={selectedModel} onChange={onModelChange}>
                            {models.map((model) => (
                                <List.Dropdown.Item key={model.id} title={model.name} value={model.id} />
                            ))}
                        </List.Dropdown>
                    ) : null
                }
            >
                {activeChatId === "new" && (
                    <List.Section title="Current">
                        <List.Item
                            id="new"
                            title="New Chat"
                            icon={Icon.PlusCircle}
                            detail={<List.Item.Detail markdown={"## Start chatting with Copilot\n\nType your message below and press `Enter`."} />}
                            actions={
                                <ActionPanel>
                                    {searchText.trim().length > 0 && (
                                        <Action title="Send Message" icon={Icon.Message} onAction={() => sendMessage(searchText)} />
                                    )}
                                    <Action title="Logout" icon={Icon.Logout} onAction={logout} shortcut={{ modifiers: ["cmd", "shift"], key: "l" }} />
                                </ActionPanel>
                            }
                        />
                    </List.Section>
                )}

                {chats.length > 0 && (
                    <List.Section title="History">
                        {chats.map((chat) => {
                            const isActive = activeChatId === chat.id;
                            const chatMarkdown = [...chat.messages]
                                .reverse()
                                .map((msg) =>
                                    msg.role === "user" ? `---\n 👨‍💻:\n\n${msg.content}\n` : `⚡:\n\n${msg.content}\n`
                                )
                                .join("\n");
                            return (
                                <List.Item
                                    key={chat.id}
                                    id={chat.id}
                                    title={chat.title}
                                    icon={isActive ? Icon.SpeechBubbleActive : Icon.Message}
                                    detail={<List.Item.Detail markdown={chatMarkdown} />}
                                    actions={
                                        <ActionPanel>
                                            {searchText.trim().length > 0 && (
                                                <Action title="Send Message" icon={Icon.Message} onAction={() => sendMessage(searchText)} />
                                            )}
                                            <Action title="Start New Chat" icon={Icon.PlusCircle} shortcut={{ modifiers: ["cmd"], key: "n" }} onAction={() => {
                                                setActiveChatId("new");
                                                setSearchText("");
                                            }} />
                                            <Action title="Delete Chat" icon={Icon.Trash} shortcut={{ modifiers: ["ctrl"], key: "x" }} onAction={() => deleteChat(chat.id)} style={Action.Style.Destructive} />
                                            <Action title="Clear All History" icon={Icon.DeleteDocument} shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }} onAction={clearAllChats} style={Action.Style.Destructive} />
                                            <Action.CopyToClipboard title="Copy Chat" content={chat.messages.map(m => `**${m.role}:** ${m.content}`).join("\n")} />
                                            <Action title="Logout" icon={Icon.Logout} onAction={logout} shortcut={{ modifiers: ["cmd", "shift"], key: "l" }} />
                                        </ActionPanel>
                                    }
                                />
                            );
                        })}
                    </List.Section>
                )}
            </List>
        </AuthGate>
    );
}
