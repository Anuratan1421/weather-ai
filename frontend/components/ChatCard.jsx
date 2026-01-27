"use client"

import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import "./ChatCard.css"

function ChatCard({ conversationId }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    { id: 1, type: "bot", text: `Hi! I'm your weather assistant. Ask me about any city!` },
  ])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const messagesEndRef = useRef(null)
  const eventSourceRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Load conversation when conversationId changes
  useEffect(() => {
    if (!conversationId) return;

    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`http://localhost:3000/api/conversations/${conversationId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages.map((msg, idx) => ({
              id: idx + 1,
              type: msg.type,
              text: msg.text
            })));
          } else {
            setMessages([
              { id: 1, type: "bot", text: `Hi! I'm your weather assistant. Ask me about any city!` }
            ]);
          }
        }
      } catch (error) {
        console.error("Error loading conversation:", error);
      }
      setIsLoading(false);
    };

    loadConversation();
  }, [conversationId]);

  // Set up SSE connection for real-time updates
  useEffect(() => {
    if (!conversationId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Create new EventSource connection
    const eventSource = new EventSource(`http://localhost:3000/api/stream/${conversationId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "message") {
          // New message from any client (deduplicate based on text and type)
          setMessages((prev) => {
            const exists = prev.some(m => 
              m.text === data.message.text && 
              m.type === data.message.type &&
              Math.abs((m.id || 0) - (data.message.id || 0)) < 2000 // within 2 seconds
            );
            if (exists) return prev;
            
            return [...prev, {
              id: data.message.id || Date.now(),
              type: data.message.type,
              text: data.message.text
            }];
          });
        } else if (data.type === "status") {
          // Handle different status types
          if (data.content === "processing" || data.content === "generating") {
            setIsTyping(true);
          } else if (data.content === "Fetching weather data...") {
            console.log("Status:", data.content);
            setIsTyping(true);
          }
        } else if (data.type === "token") {
          // Handle streaming tokens
          setIsTyping(false);
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            // If last message is bot and has same messageId, update it
            if (lastMsg && lastMsg.type === "bot" && lastMsg.id === data.messageId) {
              return prev.map((msg, idx) =>
                idx === prev.length - 1 ? { ...msg, text: msg.text + data.content } : msg
              );
            } else {
              // Create new bot message
              return [...prev, {
                id: data.messageId,
                type: "bot",
                text: data.content
              }];
            }
          });
        } else if (data.type === "done") {
          setIsTyping(false);
        } else if (data.type === "connected") {
          console.log("✅ SSE connected:", data.conversationId);
        }
      } catch (e) {
        console.error("Error parsing SSE data:", e);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE error:", error);
      eventSource.close();
      // Attempt reconnect after 3 seconds
      setTimeout(() => {
        if (conversationId) {
          window.location.reload();
        }
      }, 3000);
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, [conversationId]);

  const handleSend = async () => {
    if (!input.trim() || !conversationId) return

    const userText = input
    const tempId = Date.now()
    
    // Optimistic UI - show user message immediately
    setMessages((prev) => [...prev, {
      id: tempId,
      type: "user",
      text: userText
    }])
    
    setInput("")
    setIsTyping(true)

    try {
      // Simple JSON POST - user message will also be broadcast via SSE
      const res = await fetch(`http://localhost:3000/api/chat/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
        }),
      })

      if (!res.ok) {
        throw new Error("Network response was not ok")
      }

      const result = await res.json();
      console.log("Message sent:", result);
      
    } catch (err) {
      console.error("Send error:", err)
      setIsTyping(false)
      // Remove optimistic message and show error
      setMessages((prev) => prev.filter(m => m.id !== tempId))
      setMessages((prev) => [...prev, { 
        id: Date.now(), 
        type: "bot", 
        text: "Error connecting to server. Please try again." 
      }])
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

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
          disabled={isTyping || isLoading}
        />
        <button onClick={handleSend} className="send-btn" disabled={isTyping || !input.trim() || isLoading}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default ChatCard
