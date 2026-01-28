"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import "./ChatCard.css"

const API_BASE = "https://sanch-ai.vercel.app";

function ChatCard({ conversationId, onFirstMessage }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState([
    { id: 1, type: "bot", text: `Hi! I'm your weather assistant. Ask me about any city!` },
  ])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const eventSourceRef = useRef(null)
  const pendingMessageSentRef = useRef(false)
  const reconnectTimeoutRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load conversation when conversationId changes
  useEffect(() => {
    if (!conversationId) {
      pendingMessageSentRef.current = false;
      setIsLoading(false);
      return;
    }

    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        
        const data = await res.json();
        
        if (data.messages?.length > 0) {
          setMessages(data.messages.map((msg, idx) => ({
            id: msg.id || idx + 1,
            type: msg.type,
            text: msg.text
          })));
        } else {
          setMessages([
            { id: 1, type: "bot", text: `Hi! I'm your weather assistant. Ask me about any city!` }
          ]);
        }
      } catch (error) {
        console.error("Error loading conversation:", error);
        setMessages([
          { id: 1, type: "bot", text: `Hi! I'm your weather assistant. Ask me about any city!` }
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    loadConversation();
  }, [conversationId]); // Only reload when conversationId changes

  // Handle pending message separately
  useEffect(() => {
    const pendingMessage = location.state?.pendingMessage;
    if (pendingMessage && conversationId && !pendingMessageSentRef.current) {
      pendingMessageSentRef.current = true;
      // Use inline function to avoid dependency on sendMessage
      setTimeout(() => {
        const send = async () => {
          const tempId = Date.now();
          setMessages((prev) => [...prev, { id: tempId, type: "user", text: pendingMessage }]);
          setIsTyping(true);
          
          try {
            const res = await fetch(`${API_BASE}/api/chat/${conversationId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: pendingMessage }),
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();
            console.log('✅ Pending message sent:', result.conversationId);
          } catch (err) {
            console.error('❌ Send error:', err);
            setIsTyping(false);
            setMessages((prev) => prev.filter(m => m.id !== tempId));
            setMessages((prev) => [...prev, { 
              id: Date.now(), type: "bot", 
              text: `Error: ${err.message || 'Server unavailable'}` 
            }]);
          }
        };
        send();
      }, 100);
    }
  }, [conversationId, location.state?.pendingMessage]);

  // Set up SSE connection for real-time updates
  useEffect(() => {
    if (!conversationId) return;

    let eventSource;
    let isCleanedUp = false;

    const setupSSE = () => {
      if (isCleanedUp) return;

      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      console.log('🔗 Connecting SSE:', conversationId);
      eventSource = new EventSource(`${API_BASE}/api/stream/${conversationId}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('✅ SSE Connected');
        // Clear any pending reconnect
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "message") {
            setMessages((prev) => {
              const exists = prev.some(m => 
                m.text === data.message.text && 
                m.type === data.message.type &&
                Math.abs((m.id || 0) - (data.message.id || 0)) < 2000
              );
              if (exists) return prev;
              
              return [...prev, {
                id: data.message.id || Date.now(),
                type: data.message.type,
                text: data.message.text
              }];
            });
          } else if (data.type === "status") {
            if (data.content === "processing" || data.content === "generating") {
              setIsTyping(true);
            }
          } else if (data.type === "token") {
            setIsTyping(false);
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg?.type === "bot" && lastMsg.id === data.messageId) {
                return prev.map((msg, idx) =>
                  idx === prev.length - 1 ? { ...msg, text: msg.text + data.content } : msg
                );
              }
              return [...prev, {
                id: data.messageId,
                type: "bot",
                text: data.content
              }];
            });
          } else if (data.type === "done") {
            setIsTyping(false);
          } else if (data.type === "connected") {
            console.log('✅ SSE session established:', data.conversationId);
          }
        } catch (e) {
          console.error('❌ SSE parse error:', e);
        }
      };

      eventSource.onerror = (error) => {
        console.error('❌ SSE error:', error);
        eventSource.close();
        
        // Attempt reconnect after 3 seconds if not cleaned up
        if (!isCleanedUp) {
          console.log('🔄 Reconnecting in 3s...');
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isCleanedUp) setupSSE();
          }, 3000);
        }
      };
    };

    setupSSE();

    // Cleanup on unmount
    return () => {
      isCleanedUp = true;
      if (eventSource) eventSource.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [conversationId]);

  // Extract message sending logic with useCallback for better performance
  const sendMessage = useCallback(async (messageText) => {
    if (!conversationId) {
      console.error("No conversation ID available");
      return;
    }

    const tempId = Date.now();
    
    // Optimistic UI - show user message immediately
    setMessages((prev) => [...prev, {
      id: tempId,
      type: "user",
      text: messageText
    }]);
    
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
      setMessages((prev) => prev.filter(m => m.id !== tempId));
      setMessages((prev) => [...prev, { 
        id: Date.now(), 
        type: "bot", 
        text: `Error: ${err.message || 'Server unavailable. Please try again.'}` 
      }]);
    }
  }, [conversationId]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return

    const userText = input
    setInput("")

    // If no conversationId exists (first message), create one
    if (!conversationId && onFirstMessage) {
      try {
        await onFirstMessage(userText);
        return;
      } catch (error) {
        console.error("Error creating conversation:", error);
        setInput(userText); // Restore input
        setMessages((prev) => [...prev, { 
          id: Date.now(), 
          type: "bot", 
          text: "Failed to create conversation. Please try again." 
        }]);
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
          messages.map((msg) => (
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
