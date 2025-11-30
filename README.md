# HavaAI  

#live link
# https://sanchweatherai.vercel.app/

A smart AI-powered weather assistant web application where users can ask natural-language queries such as:

“What is the weather in Pune?”
“Give me a 5-day forecast for Bangalore”

The application uses LangChain + OpenRouter LLM to interpret queries and OpenWeather API to fetch real weather data.
Built with React + Vite frontend and FastAPI / Node Express backend.

<img width="1782" height="831" alt="image" src="https://github.com/user-attachments/assets/8f5a8ecf-f985-4683-b043-a8560b20d0d2" />

<img width="689" height="676" alt="image" src="https://github.com/user-attachments/assets/ca7bb148-37f2-4473-b0e4-6435209b3037" />

<img width="681" height="659" alt="image" src="https://github.com/user-attachments/assets/2caf4a3b-00da-46db-a11e-d36724091eb9" />

✨ Features

⚡ Ask weather questions through chat

🌤 Real-time current weather data

📅 Five-day forecast grouped by day at 12:00 PM

🧠 Remembers last city queried

🤖 AI understanding of natural language

🌍 Supports lifestyle suggestions when asked

🛠 REST API support for weather card components

🏗 Tech Stack
Category	Tech
Frontend	React + Vite
Backend	FastAPI / Express.js
AI	LangChain + OpenRouter (GPT-4o Mini)
Weather API	OpenWeather Map
Deploy	Vercel 
Data Format	JSON REST APIs
📂 Project Structure
weather-ai/
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── components/
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── Backend
    ├── index.js (Node Version) or app.py (FastAPI version)
    ├── .env
    ├── package.json / requirements.txt

🔑 Environment Variables

Create a .env file inside backend folder:

OPENROUTER_KEY=your_openrouter_api_key
OPEN_WEATHER_API_KEY=your_openweather_api_key
APP_TITLE="Weather Chatbot"
PORT=3000


🔐 Get API Keys:

OpenRouter: https://openrouter.ai

OpenWeather: https://openweathermap.org/api

⚙ Backend Setup
A) Node.js Version
cd backend
npm install
node index.js


Server:

http://localhost:3000

B) FastAPI (Python) Version
pip install fastapi uvicorn requests python-dotenv langchain-openai

uvicorn app:app --reload

💻 Frontend Setup (React + Vite)
cd frontend
npm install
npm run dev


🤝 Contributing

Fork this repository

Create feature branch: git checkout -b feature-name

Commit changes: git commit -m "Add feature"

Push: git push origin feature-name

Submit Pull Request

📜 License

MIT License © 2025 — Free for personal and academic use

👤 Author

Anuratan B.
🔗 GitHub: https://github.com/Anuratan1421

✉ Contact/Collaboration welcome!

⭐ Support

If you found this helpful, please star the repo 🌟
