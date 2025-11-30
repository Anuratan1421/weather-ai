"use client"
import "./WeatherCard.css"

function WeatherCard({ city, data, onCityChange, cities, selectedCity }) {
 

  return (
    <div className="weather-card">
      <div className="weather-header">
        <h2 className="weather-city">{city}</h2>
        <p className="weather-temp">{data.temp}°C</p>
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
