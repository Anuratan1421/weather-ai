"use client"

import React from "react"
import "./WeatherBackground.css"

function WeatherBackground({ condition = "Clear" }) {
  const cond = (condition || "").toLowerCase()

  const state = cond.includes("rain")
    ? "rain"
    : cond.includes("storm") || cond.includes("thunder")
    ? "storm"
    : cond.includes("cloud") || cond.includes("overcast")
    ? "clouds"
    : "sun"

  return (
    <div className={`weather-bg weather-bg--${state}`} aria-hidden>
      <div className="weather-bg__layer weather-bg__sky" />

      {state === "sun" && (
        <div className="sun">
          <div className="sun-core" />
          <div className="sun-rays" />
        </div>
      )}

      {state === "clouds" && (
        <div className="clouds">
          <div className="cloud c1" />
          <div className="cloud c2" />
          <div className="cloud c3" />
        </div>
      )}

      {state === "rain" && (
        <div className="rain">
          <div className="cloud c1" />
          <div className="drops">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className={`drop d${i % 6}`} />
            ))}
          </div>
        </div>
      )}

      {state === "storm" && (
        <div className="storm">
          <div className="cloud c1" />
          <div className="strike" />
        </div>
      )}
    </div>
  )
}

export default WeatherBackground
