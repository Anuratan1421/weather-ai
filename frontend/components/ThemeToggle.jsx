import { useEffect, useState, useRef } from "react"
import "./ThemeToggle.css"

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "dark"
    } catch (e) {
      return "dark"
    }
  })
  
  const isInitialMount = useRef(true)

  useEffect(() => {
    // Skip on initial mount since the inline script already applied the theme
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    
    // Apply or remove light-theme class based on current theme
    if (theme === "light") {
      document.body.classList.add("light-theme")
    } else {
      document.body.classList.remove("light-theme")
    }
    
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
