"use client"

import { useState, useRef, useEffect } from "react"
import "./ChatCard.css"

function ChatCard() {
  const [messages, setMessages] = useState([
    { id: 1, type: "bot", text: `Hi! I'm your weather assistant. Ask me about any city!` },
  ])

  const [history, setHistory] = useState([])   // conversation memory
  const [lastCity, setLastCity] = useState(null) // last mentioned city

  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim()) return

    const userText = input
    const userMessage = { id: messages.length + 1, type: "user", text: userText }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsTyping(true)

    try {
      const res = await fetch("https://sanch-ai.vercel.app/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history,
          lastCity,
        }),
      })

      const data = await res.json()

      setHistory(data.history)     // updated memory from backend
      setLastCity(data.lastCity)   // updated last city tracking

      setMessages((prev) => [
        ...prev,
        { id: prev.length + 1, type: "bot", text: data.reply },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: prev.length + 1, type: "bot", text: "Error connecting to server" },
      ])
    }

    setIsTyping(false)
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
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.type}`}>
            <div className="message-content">{msg.text}</div>
          </div>
        ))}

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
