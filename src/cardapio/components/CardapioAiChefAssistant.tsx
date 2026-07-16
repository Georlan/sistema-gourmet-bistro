/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Sparkles, Send, X, Bot, Loader2, ArrowRight } from "lucide-react";
import { BrandConfig } from "../CardapioTypes";
import { API_BASE_URL } from "../../config/api";

interface CardapioAiChefAssistantProps {
  activeBrand: BrandConfig;
}

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export default function CardapioAiChefAssistant({ activeBrand }: CardapioAiChefAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initial welcome message from the Chef AI
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: "model",
          text: `Olá! Sou o Chef & Garçom Virtual da **${activeBrand.name}**. 🍳\n\nEstou aqui para tirar suas dúvidas, sugerir pratos deliciosos e te ajudar a escolher o melhor pedido! O que gostaria de experimentar hoje?`
        }
      ]);
    }
  }, [activeBrand, messages]);

  // Scroll to bottom whenever messages list updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isLoading) return;

    // Add user message to state
    const updatedMessages = [...messages, { role: "user" as const, text: trimmed }];
    setMessages(updatedMessages);
    setInputMessage("");
    setIsLoading(true);

    try {
      // Send chat request to our server-side API route (keeping keys hidden!)
      const response = await fetch(`${API_BASE_URL}/api/chat-waiter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          brandName: activeBrand.name,
          slogan: activeBrand.slogan,
          menuItems: activeBrand.products,
          history: updatedMessages.slice(1, -1), // skip first welcome message and user's current message for history mapping
          message: trimmed
        })
      });

      if (!response.ok) {
        throw new Error("Erro na comunicação com o servidor.");
      }

      const data = await response.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "model", text: data.reply }]);
      } else {
        throw new Error("Resposta inválida recebida da IA.");
      }
    } catch (err) {
      console.error("Erro no chat com IA:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: "Desculpe, tive um probleminha de conexão e não consegui responder agora. Que tal darmos uma olhada no cardápio juntos?"
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    "Quais as opções mais vendidas?",
    "Me recomende um combo!",
    "Tem opções vegetarianas?",
    "Quais os preços das sobremesas?"
  ];

  return (
    <>
      {/* Floating Sparkles Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
        id="ai-chef-assistant-trigger"
        title="Falar com o Chef Virtual"
      >
        <Sparkles className="h-6 w-6 animate-pulse" />
      </button>

      {/* AI Assistant Drawer Sidebar overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex justify-end bg-black/60 animate-fade-in" 
          id="ai-assistant-overlay"
          onClick={() => setIsOpen(false)}
        >
          {/* Drawer Body container */}
          <div 
            className="flex h-full w-full max-w-md flex-col bg-card-app border-l border-slate-500/10 shadow-2xl animate-slide-left" 
            id="ai-assistant-drawer"
            onClick={(e) => e.stopPropagation()} // Prevent close on clicking drawer itself
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-500/10 p-4 shrink-0 bg-slate-500/5">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-extrabold text-text-app">Chef & Garçom Virtual</h2>
                  <p className="text-[10px] text-primary font-bold uppercase tracking-wider">Atendimento Inteligente</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-500/10 text-text-app/50 transition cursor-pointer"
                id="btn-close-ai"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Chat Messages Log Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-slate-500/[0.02]">
              {messages.map((msg, index) => {
                const isModel = msg.role === "model";
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-2.5 max-w-[85%] ${isModel ? "mr-auto" : "ml-auto flex-row-reverse"}`}
                  >
                    {isModel && (
                      <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`rounded-2xl p-3.5 text-xs leading-relaxed border ${
                        isModel
                          ? "bg-slate-500/5 border-slate-500/10 text-text-app/90"
                          : "bg-primary border-primary text-white"
                      }`}
                    >
                      {/* Very simple markdown format parser for bold (**text**) and linebreaks */}
                      {msg.text.split("\n").map((paragraph, pIdx) => {
                        // Match **bold**
                        const parts = paragraph.split(/\*\*([^*]+)\*\*/);
                        return (
                          <p key={pIdx} className={pIdx > 0 ? "mt-2" : ""}>
                            {parts.map((part, partIdx) => 
                              partIdx % 2 === 1 ? <strong key={partIdx} className="font-bold">{part}</strong> : part
                            )}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-2.5 max-w-[85%] mr-auto">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl p-3.5 text-xs text-text-app/50 bg-slate-500/5 border border-slate-500/10 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span>O Chef está elaborando a resposta...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Sticky Prompt suggestions & input bar */}
            <div className="border-t border-slate-500/10 bg-card-app p-4 shrink-0 space-y-3">
              {/* Quick Prompt suggestions list (Only when not loading) */}
              {messages.length <= 2 && !isLoading && (
                <div className="flex flex-wrap gap-1.5" id="ai-quick-prompts">
                  {quickPrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(prompt)}
                      className="text-[10px] font-semibold text-text-app/60 hover:text-primary bg-slate-500/5 hover:bg-slate-500/10 border border-slate-500/10 rounded-full px-3 py-1 transition cursor-pointer flex items-center gap-1"
                    >
                      <span>{prompt}</span>
                      <ArrowRight className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                </div>
              )}

              {/* Chat Send input box form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage(inputMessage);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  placeholder="Pergunte ao nosso Chef Virtual..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 rounded-xl border border-slate-500/10 bg-slate-500/5 p-3 text-xs text-text-app outline-hidden focus:border-primary transition"
                  id="ai-chat-input"
                />
                <button
                  type="submit"
                  disabled={isLoading || !inputMessage.trim()}
                  className="rounded-xl bg-primary px-4 text-white hover:opacity-90 active:scale-95 transition disabled:opacity-50 flex items-center justify-center cursor-pointer"
                  id="btn-send-ai-message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
