# app.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# MODELS 
class Message(BaseModel):
    type: str
    text: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[Message]] = []
    lastCity: Optional[str] = None

class ChatResponse(BaseModel):
    reply: str
    history: List[Message]
    lastCity: Optional[str]

class WeatherResponse(BaseModel):
    city: str
    temp: float
    humidity: int
    wind: float
    condition: str

# CONFIGURATION 
OPENROUTER_KEY = os.getenv("OPENROUTER_KEY")
OPENWEATHER_API_KEY = os.getenv("OPEN_WEATHER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """
You are a smart Weather AI inside a chat system.

RULES:
- When user asks for forecast or future weather, call tool with type="forecast".
- When user asks for current weather, call tool with type="current".
- Answer based only on weather context.
- You may give simple weather-related lifestyle suggestions if and only if user asks for them.
- Do NOT ask the user to ask something else or say things like "just ask".
- Do NOT ask unnecessary clarification questions unless no city has been mentioned at all.
- Remember the last city unless the user changes it.
- Keep responses short and direct.
- Do NOT talk about anything unrelated to weather.
"""

# TOOL DEFINITIONS
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather information for a city, current or forecast",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name"
                    },
                    "type": {
                        "type": "string",
                        "enum": ["current", "forecast"],
                        "description": "Type of weather data to retrieve",
                        "default": "current"
                    }
                },
                "required": ["city"]
            }
        }
    }
]

# WEATHER TOOL IMPLEMENTATION
async def get_weather_tool(city: str, weather_type: str = "current") -> str:
    """Fetch weather data from OpenWeatherMap API"""
    async with httpx.AsyncClient() as client:
        try:
            if weather_type == "forecast":
                url = "https://api.openweathermap.org/data/2.5/forecast"
                params = {
                    "q": city,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "metric"
                }
                
                response = await client.get(url, params=params)
                if response.status_code != 200:
                    return f'Could not get forecast for "{city}".'
                
                data = response.json()
                
                # Group forecasts by date, pick 12:00
                daily = {}
                for item in data["list"]:
                    date = item["dt_txt"].split(" ")[0]
                    if date not in daily and "12:00:00" in item["dt_txt"]:
                        daily[date] = item
                
                forecast_list = []
                for f in list(daily.values())[:5]:
                    forecast_list.append(
                        f"📅 {f['dt_txt'].split(' ')[0]}\n"
                        f"🌡 Temp: {f['main']['temp']}°C (feels {f['main']['feels_like']}°C)\n"
                        f"☁️ {f['weather'][0]['description']}\n"
                        f"💨 Wind: {f['wind']['speed']} m/s\n"
                    )
                
                return f"🌦 5-Day Forecast for **{data['city']['name']}**:\n\n" + "\n".join(forecast_list)
            
            # ---------- CURRENT WEATHER ----------
            url = "https://api.openweathermap.org/data/2.5/weather"
            params = {
                "q": city,
                "appid": OPENWEATHER_API_KEY,
                "units": "metric"
            }
            
            response = await client.get(url, params=params)
            if response.status_code != 200:
                return f'Could not get weather for "{city}". Please try another city.'
            
            data = response.json()
            
            return (
                f"Current weather in {data['name']}:\n"
                f"🌡 Temp: {data['main']['temp']}°C (feels like {data['main']['feels_like']}°C)\n"
                f"☁️ {data['weather'][0]['description']}\n"
                f"💧 Humidity: {data['main']['humidity']}%\n"
                f"💨 Wind: {data['wind']['speed']} m/s"
            )
            
        except Exception as err:
            print(f"Weather tool error: {err}")
            return f'Error looking up weather for "{city}".'

#  LLM CALL 
async def call_llm(messages: List[dict]) -> dict:
    """Call OpenRouter API with tool support"""
    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"Bearer {OPENROUTER_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("APP_URL", "http://localhost:3000"),
            "X-Title": os.getenv("APP_TITLE", "Weather Chatbot"),
        }
        
        payload = {
            "model": "gpt-4o-mini",
            "messages": messages,
            "tools": TOOLS,
            "temperature": 0.4,
            "max_tokens": 1024,
        }
        
        response = await client.post(OPENROUTER_URL, json=payload, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json()


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        user_message = request.message.strip()
        if not user_message:
            raise HTTPException(status_code=400, detail="message required")
        
        history = request.history or []
        last_city = request.lastCity
        
        # Build message history
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        
        for msg in history:
            role = "user" if msg.type == "human" else "assistant"
            messages.append({"role": role, "content": msg.text})
        
        messages.append({"role": "user", "content": user_message})
        
        # Call LLM with tool support
        max_iterations = 5
        iteration = 0
        
        while iteration < max_iterations:
            response = await call_llm(messages)
            assistant_message = response["choices"][0]["message"]
            
            # Check for tool calls
            if assistant_message.get("tool_calls"):
                messages.append(assistant_message)
                
                for tool_call in assistant_message["tool_calls"]:
                    if tool_call["function"]["name"] == "get_weather":
                        import json
                        args = json.loads(tool_call["function"]["arguments"])
                        city = args.get("city")
                        weather_type = args.get("type", "current")
                        
                        if city:
                            last_city = city
                        
                        tool_result = await get_weather_tool(city, weather_type)
                        
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call["id"],
                            "content": tool_result
                        })
                
                iteration += 1
            else:
                # No more tool calls, we have the final response
                reply = assistant_message.get("content", "")
                break
        else:
            reply = "I apologize, but I'm having trouble processing your request."
        
        # Update history
        new_history = history + [
            Message(type="human", text=user_message),
            Message(type="ai", text=reply)
        ]
        
        return ChatResponse(
            reply=reply,
            history=new_history,
            lastCity=last_city
        )
        
    except Exception as error:
        print(f"Chat error: {error}")
        raise HTTPException(status_code=500, detail="Internal error")


@app.get("/api/weather", response_model=WeatherResponse)
async def get_weather(city: str):
    if not city:
        raise HTTPException(status_code=400, detail="City required")
    
    try:
        async with httpx.AsyncClient() as client:
            url = "https://api.openweathermap.org/data/2.5/weather"
            params = {
                "q": city,
                "appid": OPENWEATHER_API_KEY,
                "units": "metric"
            }
            
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            return WeatherResponse(
                city=data["name"],
                temp=data["main"]["temp"],
                humidity=data["main"]["humidity"],
                wind=data["wind"]["speed"],
                condition=data["weather"][0]["description"]
            )
            
    except Exception as error:
        print(f"Weather API error: {error}")
        raise HTTPException(status_code=500, detail="Unable to fetch weather")



# RUN SERVER 
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 3000))
    uvicorn.run(app, host="0.0.0.0", port=port)
