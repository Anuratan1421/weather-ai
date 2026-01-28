"use client"

import { useState, useEffect } from "react"
import { Routes, Route, useNavigate, useParams } from "react-router-dom"
import "./App.css"
import Header from "../components/Header"
import WeatherCard from "../components/WeatherCard"
import ChatCard from "../components/ChatCard"

function ChatInterface() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const cities = ["Pune", "Mumbai", "Nagpur", "Delhi"];
  const [selectedCity, setSelectedCity] = useState("Pune");
  const [weatherData, setWeatherData] = useState({});
  const [loading, setLoading] = useState(false);
  const [chatOnlyMode, setChatOnlyMode] = useState(false);

  const fetchWeather = async (city) => {
    setLoading(true);
    try {
      const res = await fetch(`https://sanch-ai.vercel.app/api/weather?city=${city}`);
      const data = await res.json();
      setWeatherData(data);
    } catch (error) {
      console.error("Weather API Error:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWeather(selectedCity);
  }, [selectedCity]);

  const handleNewChat = async () => {
    try {
      const res = await fetch("https://sanch-ai.vercel.app/api/conversations", {
        method: "POST"
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (!data.conversationId) {
        throw new Error("No conversation ID returned from server");
      }
      
      navigate(`/c/${data.conversationId}`);
    } catch (error) {
      console.error("Error creating conversation:", error);
      alert("Failed to create new chat. Please check if the backend is running.");
    }
  };

  // Handler for first message - creates conversation, navigates, and sends message
  const handleFirstMessage = async (message) => {
    if (!conversationId) {
      try {
        const res = await fetch("https://sanch-ai.vercel.app/api/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          }
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error("Server response:", errorText);
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const data = await res.json();
        
        if (!data.conversationId) {
          console.error("Invalid response:", data);
          throw new Error("No conversation ID returned from server");
        }
        
        const newConversationId = data.conversationId;
        
        // Navigate to new conversation
        navigate(`/c/${newConversationId}`, { replace: true });
        
        // Send the message after navigation
        setTimeout(async () => {
          try {
            await fetch(`https://sanch-ai.vercel.app/api/chat/${newConversationId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message }),
            });
          } catch (err) {
            console.error('Failed to send first message:', err);
          }
        }, 500);
        
        return newConversationId;
      } catch (error) {
        console.error("Error creating conversation:", error);
        alert("Failed to create conversation. Backend server may be experiencing issues. Please try again.");
        return null;
      }
    }
    return conversationId;
  };

  return (
    <div className="app-container">
      <Header 
        onNewChat={handleNewChat}
        chatOnlyMode={chatOnlyMode}
        onToggleChatMode={() => setChatOnlyMode(!chatOnlyMode)}
      /> 
      <main className="main-content">
        <div className={`content-wrapper ${chatOnlyMode ? 'chat-only' : ''}`}>
          {!chatOnlyMode && (
            <WeatherCard
              city={selectedCity}
              data={weatherData}
              onCityChange={setSelectedCity}
              cities={cities}
              selectedCity={selectedCity}
              loading={loading}
            />
          )}

          <ChatCard 
            conversationId={conversationId}
            city={selectedCity} 
            weatherData={weatherData}
            fullWidth={chatOnlyMode}
            onFirstMessage={handleFirstMessage}
          />
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/c/:conversationId" element={<ChatInterface />} />
      <Route path="/" element={<ChatInterface />} />
    </Routes>
  );
}

export default App