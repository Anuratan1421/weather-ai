"use client"
import { useState, useEffect } from "react"
import "./WeatherCard.css"

function WeatherCard({ city, data, onCityChange, cities, selectedCity }) {
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem("tempUnit") || "C"
    } catch (e) {
      return "C"
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem("tempUnit", unit)
    } catch (e) {}
  }, [unit])

  const displayTemp = () => {
    if (data == null || data.temp == null) return "--"
    const c = Number(data.temp)
    if (Number.isNaN(c)) return "--"
    if (unit === "C") return Math.round(c)
    return Math.round((c * 9) / 5 + 32)
  }
 

  return (
    <div className="weather-card">
      <div className="weather-header">
        <h2 className="weather-city">{city}</h2>

        <div className="weather-temp-row">
          <p className="weather-temp">{displayTemp()}°{unit}</p>

          <div className="unit-toggle" role="group" aria-label="Temperature unit">            <button
              className={`unit-btn ${unit === "C" ? "active" : ""}`}
              onClick={() => setUnit("C")}
              aria-pressed={unit === "C"}
            >
              °C
            </button>
            <button
              className={`unit-btn ${unit === "F" ? "active" : ""}`}
              onClick={() => setUnit("F")}
              aria-pressed={unit === "F"}
            >
              °F
            </button>
          </div>
        </div>
      </div>



      <p className="weather-condition">{data.condition}</p>

      <div className="weather-details">
        <div className="detail-item">
          <span className="detail-label">Humidity</span>
          <span className="detail-value">{data.humidity}%</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Wind</span>
          <span className="detail-value">{data.wind} mph</span>
        </div>
      </div>

      <div className="city-buttons">
        {cities.map((cityName) => (
          <button
            key={cityName}
            className={`city-btn ${selectedCity === cityName ? "active" : ""}`}
            onClick={() => onCityChange(cityName)}
          >
            {cityName}
          </button>
        ))}
      </div>
    </div>
  )
}

export default WeatherCard
