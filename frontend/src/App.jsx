"use client"

import { useState, useEffect } from "react"
import "./App.css"
import Header from "../components/Header"
import WeatherCard from "../components/WeatherCard"
import ChatCard from "../components/ChatCard"

function App() {
  const cities = ["Pune", "Mumbai", "Nagpur", "Delhi"]
  const [selectedCity, setSelectedCity] = useState("Pune")
  const [weatherData, setWeatherData] = useState({})
  const [loading, setLoading] = useState(false)

  const fetchWeather = async (city) => {
    setLoading(true)
    try {
      const res = await fetch(`http://127.0.0.1:3000/api/weather?city=${city}`)
      const data = await res.json()
      setWeatherData(data)
    } catch (error) {
      console.error("Weather API Error:", error)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchWeather(selectedCity)
  }, [selectedCity])

  return (
  
     
      <div className="app-container">
        <Header /> 
        <main className="main-content">
          <div className="content-wrapper">
            <WeatherCard
              city={selectedCity}
              data={weatherData}
              onCityChange={setSelectedCity}
              cities={cities}
              selectedCity={selectedCity}
              loading={loading}
            />

            <ChatCard city={selectedCity} weatherData={weatherData} />
          </div>
        </main>
      </div>
 
  )
}

export default App