import { useEffect, useState } from "react"
import "./ThemeToggle.css"

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "dark"
    } catch (e) {
      return "dark"
    }
  })

  useEffect(() => {
    document.body.classList.toggle("light-theme", theme === "light")
    try {
      localStorage.setItem("theme", theme)
    } catch (e) {}
  }, [theme])

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"))

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
      {theme === "light" ? (
        <span className="icon">🌤️</span>
      ) : (
        <span className="icon">🌙</span>
      )}
      <span className="label">{theme === "light" ? "Light" : "Dark"}</span>
    </button>
  )
}

export default ThemeToggle
