import React, { useState, useCallback } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { SkillExtractor } from "./components/SkillExtractor";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { useChat } from "./hooks/useChat";

export function App() {
  const {
    messages,
    isStreaming,
    conversationId,
    conversationTitle,
    sendMessage,
    startNewConversation,
    loadExistingConversation,
    deleteConversation,
    stopStreaming,
  } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extractorOpen, setExtractorOpen] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [allowAdditional, setAllowAdditional] = useState(true);

  const hasSubstance =
    !!conversationId && messages.filter((m) => m.role === "assistant").length >= 1;

  const handleNewConversation = useCallback(() => {
    startNewConversation();
    setSelectedSkills([]);
    setAllowAdditional(true);
  }, [startNewConversation]);

  const handleLoadConversation = useCallback((id: string) => {
    loadExistingConversation(id);
    setSelectedSkills([]);
    setAllowAdditional(true);
  }, [loadExistingConversation]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    await deleteConversation(id);
    setSelectedSkills([]);
    setAllowAdditional(true);
  }, [deleteConversation]);

  const sendWithSkills = useCallback(
    (message: string) => {
      if (selectedSkills.length > 0) {
        sendMessage(message, { skills: selectedSkills, strict: !allowAdditional });
      } else {
        sendMessage(message);
      }
    },
    [sendMessage, selectedSkills, allowAdditional]
  );

  return (
    <div className="flex flex-col h-screen bg-surface-0">
      <Header
        onClear={handleNewConversation}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        onDistillSkill={() => setExtractorOpen(true)}
        canDistill={hasSubstance && !isStreaming}
        conversationTitle={conversationTitle}
        conversationId={conversationId}
        canExport={hasSubstance && !isStreaming}
      />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeConversationId={conversationId}
        onSelect={handleLoadConversation}
        onDelete={handleDeleteConversation}
        onNew={handleNewConversation}
      />
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SkillExtractor
        isOpen={extractorOpen}
        onClose={() => setExtractorOpen(false)}
        conversationId={conversationId}
        conversationTitle={conversationTitle}
      />
      <ChatView messages={messages} isStreaming={isStreaming} onSend={sendWithSkills} />
      <InputBar
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        selectedSkills={selectedSkills}
        onSelectedSkillsChange={setSelectedSkills}
        allowAdditional={allowAdditional}
        onAllowAdditionalChange={setAllowAdditional}
      />
    </div>
  );
}
