"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useStreamManager } from "../hooks/useStreamManager"
import "./ChatCard.css"

const API_BASE = "http://localhost:3000";

function ChatCard({ conversationId, onFirstMessage }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Use a message map for robust streaming/refresh
  const [messageMap, setMessageMap] = useState(() => {
    const map = new Map();
    map.set('init', { id: 'init', type: 'bot', text: `Hi! I'm your weather assistant. Ask me about any city!`, order: 0 });
    return map;
  });
  // For rendering
  const getMessagesArray = () => {
    const messages = Array.from(messageMap.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    console.log('📋 Rendering messages:', messages.length, messages);
    return messages;
  };
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const pendingMessageSentRef = useRef(false)
  const sendMessageRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messageMap, scrollToBottom])

  // Load conversation when conversationId changes
  useEffect(() => {
    if (!conversationId) {
      pendingMessageSentRef.current = false;
      setIsLoading(false);
      setMessageMap(new Map([['init', { id: 'init', type: 'bot', text: `Hi! I'm your weather assistant. Ask me about any city!`, order: 0 }]]));
      return;
    }

    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const map = new Map();
        map.set('init', { id: 'init', type: 'bot', text: `Hi! I'm your weather assistant. Ask me about any city!`, order: 0 });
        if (data.messages?.length > 0) {
          data.messages.forEach((msg, idx) => {
            map.set(msg.id, {
              id: msg.id,
              type: msg.type,
              text: msg.text,
              order: idx + 1,
              streaming: msg.streaming,
              timestamp: msg.timestamp || Date.now() + idx
            });
          });
        }
        setMessageMap(map);
      } catch (error) {
        console.error("Error loading conversation:", error);
        setMessageMap(new Map([['init', { id: 'init', type: 'bot', text: `Hi! I'm your weather assistant. Ask me about any city!`, order: 0 }]]));
      } finally {
        setIsLoading(false);
      }
    };
    loadConversation();
  }, [conversationId]);

  // Handle SSE messages
  const handleSSEMessage = useCallback((data) => {
    console.log('📨 SSE received:', data.type, data);
    setMessageMap((prevMap) => {
      const map = new Map(prevMap);
      if (data.type === "sync") {
        // Merge all messages from sync, preserving any streaming message
        data.messages.forEach((msg, idx) => {
          map.set(msg.id, {
            ...map.get(msg.id),
            id: msg.id,
            type: msg.type,
            text: msg.text,
            order: idx + 1,
            streaming: msg.streaming,
            timestamp: msg.timestamp || Date.now() + idx
          });
        });
        // Only remove optimistic user message if a real user message with the same text exists
        for (const [k, v] of map.entries()) {
          if (v.isOptimistic && v.type === 'user') {
            const hasReal = Array.from(map.values()).some(m => m.type === 'user' && m.text === v.text && !m.isOptimistic);
            if (hasReal) map.delete(k);
          }
        }
        return map;
      } else if (data.type === "resume") {
        // Resume streaming message
        if (map.has(data.messageId)) {
          const m = map.get(data.messageId);
          map.set(data.messageId, { ...m, text: data.currentText });
        } else {
          const maxOrder = Math.max(0, ...Array.from(map.values()).map(m => m.order ?? 0));
          map.set(data.messageId, {
            id: data.messageId,
            type: "bot",
            text: data.currentText,
            order: maxOrder + 1,
            streaming: true
          });
        }
        return map;
      } else if (data.type === "message") {
        // Remove optimistic user message only if a real user message with the same text arrives
        if (data.message.type === 'user') {
          for (const [k, v] of map.entries()) {
            if (v.isOptimistic && v.type === 'user' && v.text === data.message.text) {
              map.delete(k);
            }
          }
        }
        // Always show bot messages
        const maxOrder = Math.max(0, ...Array.from(map.values()).map(m => m.order ?? 0));
        map.set(data.message.id, {
          ...data.message,
          order: maxOrder + 1,
          isOptimistic: false
        });
        return map;
      } else if (data.type === "status") {
        if (data.content === "processing" || data.content === "generating") {
          setIsTyping(true);
        }
        return map;
      } else if (data.type === "token") {
        setIsTyping(false);
        // Append token to streaming message
        if (map.has(data.messageId)) {
          const m = map.get(data.messageId);
          map.set(data.messageId, { ...m, text: (m.text || "") + data.content });
        } else {
          const maxOrder = Math.max(0, ...Array.from(map.values()).map(m => m.order ?? 0));
          map.set(data.messageId, {
            id: data.messageId,
            type: "bot",
            text: data.content,
            order: maxOrder + 1,
            streaming: true
          });
        }
        return map;
      } else if (data.type === "done") {
        setIsTyping(false);
        // Mark streaming message as done
        // (optional: could set streaming: false)
        return map;
      } else if (data.type === "connected") {
        console.log('✅ SSE Connected');
        return map;
      } else if (data.type === "error") {
        setIsTyping(false);
        // Show error message to user
        const maxOrder = Math.max(0, ...Array.from(map.values()).map(m => m.order ?? 0));
        map.set(`error-${Date.now()}`, {
          id: `error-${Date.now()}`,
          type: "bot",
          text: data.message || "Connection error. Please refresh the page.",
          order: maxOrder + 1,
          isError: true
        });
        return map;
      }
      return map;
    });
  }, []);

  // Use stream manager hook - connect even on empty conversationId to prepare
  // This ensures we don't miss messages when conversation is created
  useStreamManager(conversationId, handleSSEMessage, true);

  // Handle pending message from navigation state (after creating new conversation)
  useEffect(() => {
    const pendingMessage = location.state?.pendingMessage;
    if (pendingMessage && conversationId && !pendingMessageSentRef.current && sendMessageRef.current) {
      pendingMessageSentRef.current = true;
      // Small delay to ensure SSE connection is established
      setTimeout(() => {
        sendMessageRef.current(pendingMessage);
      }, 300);
    }
    // Reset ref if conversationId changes (new chat)
    if (!pendingMessage && conversationId) {
      pendingMessageSentRef.current = false;
    }
  }, [conversationId, location.state?.pendingMessage]);

  // Extract message sending logic with useCallback for better performance
  const sendMessage = useCallback(async (messageText) => {
    if (!conversationId) {
      console.error("No conversation ID available");
      return;
    }

    // Generate unique temp ID for optimistic update
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Optimistic UI - show user message immediately for instant feedback
      setMessageMap((prevMap) => {
        const map = new Map(prevMap);
        const maxOrder = Math.max(0, ...Array.from(map.values()).map(m => m.order ?? 0));
        map.set(tempId, {
          id: tempId,
          type: "user",
          text: messageText,
          isOptimistic: true,
          order: maxOrder + 1
        });
        return map;
      });
    
    setIsTyping(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${res.status}`);
      }

      const result = await res.json();
      console.log("✅ Message sent:", result.conversationId);
      
    } catch (err) {
      console.error("❌ Send error:", err);
      setIsTyping(false);
      // Remove optimistic message and show error
      setMessageMap((prevMap) => {
        const map = new Map(prevMap);
        for (const [k, v] of map.entries()) {
          if (v.isOptimistic) map.delete(k);
        }
        const maxOrder = Math.max(0, ...Array.from(map.values()).map(m => m.order ?? 0));
        map.set(Date.now().toString(), {
          id: Date.now().toString(),
          type: "bot",
          text: `Error: ${err.message || 'Server unavailable. Please try again.'}`,
          order: maxOrder + 1
        });
        return map;
      });
    }
  }, [conversationId]);

  // Store sendMessage in ref for pending message handler
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return

    const userText = input
    setInput("")

    // If no conversationId exists (first message), create conversation first
    if (!conversationId && onFirstMessage) {
      console.log('🆕 Creating new conversation for first message...');
      try {
        // onFirstMessage will navigate with the message in state
        await onFirstMessage(userText);
        // Message will be sent by the pending message handler
        return;
      } catch (error) {
        console.error("Error creating conversation:", error);
        setInput(userText); // Restore input
        alert('Failed to create conversation. Please try again.');
        return;
      }
    }

    // Send message normally if conversationId exists
    await sendMessage(userText);
  }, [input, conversationId, onFirstMessage, sendMessage]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="chat-card">
      <div className="chat-header">
        <h3 className="chat-title">Weather Chat</h3>
        <p className="chat-subtitle">Ask me anything about any city</p>
      </div>

      <div className="chat-messages">
        {isLoading ? (
          <div className="message bot">
            <div className="message-content">Loading conversation...</div>
          </div>
        ) : (
          getMessagesArray().map((msg) => (
            <div key={msg.id} className={`message ${msg.type}`}>
              <div className="message-content">{msg.text}</div>
            </div>
          ))
        )}

        {isTyping && (
          <div className="message bot">
            <div className="message-content typing">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask about the weather..."
          className="chat-input"
          disabled={isTyping}
        />
        <button onClick={handleSend} className="send-btn" disabled={isTyping || !input.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default ChatCard

