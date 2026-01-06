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
  
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const temp = displayTemp()
    const condition = data?.condition || "(no data)"
    const humidity = data?.humidity != null ? `${data.humidity}%` : "--"
    const wind = data?.wind != null ? `${data.wind} mph` : "--"

    const text = `${city}: ${temp}°${unit} — ${condition}. Humidity: ${humidity}. Wind: ${wind}.`

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }

      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      console.error('Copy failed', e)
    }
  }

  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("favCities") || "[]")
    } catch (e) {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem("favCities", JSON.stringify(favorites))
    } catch (e) {}
  }, [favorites])

  const isFavorite = favorites.includes(city)

  const toggleFavorite = () => {
    if (isFavorite) setFavorites((prev) => prev.filter((c) => c !== city))
    else setFavorites((prev) => [city, ...prev])
  }
 

  return (
    <div className="weather-card">
      <div className="weather-header">
        <h2 className="weather-city">{city}</h2>

        <div className="weather-temp-row">
          <p className="weather-temp">{displayTemp()}°{unit}</p>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="unit-toggle" role="group" aria-label="Temperature unit">
              <button
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

            <button className="copy-btn" onClick={handleCopy} aria-label="Copy weather summary">
              Share
            </button>

            <button className={`fav-btn ${isFavorite ? 'fav-active' : ''}`} onClick={toggleFavorite} aria-pressed={isFavorite} aria-label="Toggle favorite">
              {isFavorite ? '★' : '☆'}
            </button>

            {copied && <span className="copied-badge">Copied!</span>}
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

      {favorites.length > 0 && (
        <div className="favorites-list">
          <h4 className="favorites-title">Favorites</h4>
          <div className="favorites-items">
            {favorites.map((fav) => (
              <button key={fav} className="fav-item" onClick={() => onCityChange(fav)}>
                {fav}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default WeatherCard
