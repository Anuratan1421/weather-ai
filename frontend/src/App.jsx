"use client"

import { useState, useEffect } from "react"
import { Routes, Route, useNavigate, useParams } from "react-router-dom"
import "./App.css"
import Header from "../components/Header"
import WeatherCard from "../components/WeatherCard"
import ChatCard from "../components/ChatCard"

function ChatPage() {
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
      const res = await fetch(`http://localhost:3000/api/weather?city=${city}`);
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
      const res = await fetch("http://localhost:3000/api/conversations", {
        method: "POST"
      });
      const data = await res.json();
      navigate(`/c/${data.conversationId}`);
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
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
          />
        </div>
      </main>
    </div>
  );
}

function App() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect root to new conversation
    if (window.location.pathname === "/") {
      const createInitialConversation = async () => {
        try {
          const res = await fetch("http://localhost:3000/api/conversations", {
            method: "POST"
          });
          const data = await res.json();
          navigate(`/c/${data.conversationId}`, { replace: true });
        } catch (error) {
          console.error("Error creating conversation:", error);
        }
      };
      createInitialConversation();
    }
  }, [navigate]);

  return (
    <Routes>
      <Route path="/c/:conversationId" element={<ChatPage />} />
      <Route path="/" element={<div>Loading...</div>} />
    </Routes>
  );
}

export default App