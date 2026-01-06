"use client"
import { useState, useEffect, useMemo } from "react"
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

  // Build an hourly temps array for a small sparkline. Use data.hourly if available,
  // otherwise synthesize a short trend around the current temperature.
  const hourlyTemps = useMemo(() => {
    try {
      if (data && Array.isArray(data.hourly) && data.hourly.length > 0) {
        return data.hourly.slice(0, 8).map((h) => Number(h.temp))
      }
      const base = Number(data?.temp)
      const center = Number.isNaN(base) ? 20 : base
      const arr = []
      for (let i = 0; i < 8; i++) {
        const jitter = Math.round(Math.sin(i / 2) * 3 + (Math.random() * 2 - 1))
        arr.push(Math.round(center + jitter))
      }
      return arr
    } catch (e) {
      return []
    }
  }, [data])

  const Sparkline = ({ points = [] }) => {
    if (!points || points.length === 0) return null
    const width = 220
    const height = 56
    const min = Math.min(...points)
    const max = Math.max(...points)
    const range = max - min || 1
    const step = width / (points.length - 1)

    const coords = points.map((p, i) => {
      const x = i * step
      const y = height - ((p - min) / range) * (height - 6) - 3
      return [x, y]
    })

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(2)} ${c[1].toFixed(2)}`).join(' ')
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

    return (
      <div className="sparkline">
        <svg className="sparkline-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height="56">
          <defs>
            <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#6fc874" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#6fc874" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#areaGrad)" stroke="none" />
          <path d={linePath} fill="none" className="sparkline-line" strokeWidth="2" />
        </svg>
        <div className="sparkline-labels">
          <span className="sparkline-start">{points[0]}°</span>
          <span className="sparkline-end">{points[points.length - 1]}°</span>
        </div>
      </div>
    )
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
