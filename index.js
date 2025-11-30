// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import { z } from "zod";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  AIMessage,
} from "@langchain/core/messages";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serve frontend

// ---------------- LLM SETUP ----------------
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.4,
  maxTokens: 1024,
  configuration: {
    apiKey: process.env.OPENROUTER_KEY ,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer":  "http://localhost:3000",
      "X-Title": process.env.APP_TITLE || "Weather Chatbot",
    },
  },
});

// -------------- TOOL SCHEMA --------------
const weatherSchema = z.object({
  city: z.string().describe("City name"),
  type: z.enum(["current", "forecast"]).default("current")
});

// ------------- TOOL IMPLEMENTATION -------------
const getWeatherTool = tool(
  async ({ city, type }) => {
    const apiKey = process.env.OPEN_WEATHER;

    try {
      if (type === "forecast") {
        const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
        url.searchParams.set("q", city);
        url.searchParams.set("appid", apiKey);
        url.searchParams.set("units", "metric");

        const res = await fetch(url.toString());
        if (!res.ok) return `Could not get forecast for "${city}".`;

        const data = await res.json();

        // Group forecasts by date, pick 12:00
        const daily = {};
        for (const item of data.list) {
          const date = item.dt_txt.split(" ")[0];
          if (!daily[date] && item.dt_txt.includes("12:00:00")) {
            daily[date] = item;
          }
        }

        const forecastList = Object.values(daily)
          .slice(0, 5)
          .map((f) => `📅 ${f.dt_txt.split(" ")[0]}
🌡 Temp: ${f.main.temp}°C (feels ${f.main.feels_like}°C)
☁️ ${f.weather[0].description}
💨 Wind: ${f.wind.speed} m/s
`)
          .join("\n");

        return `🌦 5-Day Forecast for **${data.city.name}**:\n\n${forecastList}`;
      }

      // ---------- CURRENT WEATHER ----------
      const url = new URL("https://api.openweathermap.org/data/2.5/weather");
      url.searchParams.set("q", city);
      url.searchParams.set("appid", apiKey);
      url.searchParams.set("units", "metric");

      const response = await fetch(url.toString());
      if (!response.ok) {
        return `Could not get weather for "${city}". Please try another city.`;
      }

      const data = await response.json();

      return `Current weather in ${data.name}:
🌡 Temp: ${data.main.temp}°C (feels like ${data.main.feels_like}°C)
☁️ ${data.weather[0].description}
💧 Humidity: ${data.main.humidity}%
💨 Wind: ${data.wind.speed} m/s`;
    } catch (err) {
      console.error("Weather tool error:", err);
      return `Error looking up weather for "${city}".`;
    }
  },
  {
    name: "get_weather",
    description: "Get weather information for a city, current or forecast",
    schema: weatherSchema,
  }
);


const llmWithTools = llm.bindTools([getWeatherTool]);

// ---------------- SYSTEM PROMPT ----------------
const SYSTEM_PROMPT = `
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
`;

// ---------------- CHAT ENDPOINT ----------------
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = (req.body?.message || "").toString().trim();
    const history = req.body?.history || [];
    let lastCity = req.body?.lastCity || null;

    if (!userMessage) return res.status(400).json({ error: "message required" });

    // Rebuild previous messages
    const messages = [new SystemMessage(SYSTEM_PROMPT), ...history.map((m) =>
      m.type === "human"
        ? new HumanMessage(m.text)
        : new AIMessage(m.text)
    )];

    messages.push(new HumanMessage(userMessage));

    let aiMessage = await llmWithTools.invoke(messages);
    messages.push(aiMessage);

    while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      for (const toolCall of aiMessage.tool_calls) {
        if (toolCall.name === "get_weather") {
          lastCity = toolCall.args.city;
          const toolResult = await getWeatherTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCall.id,
              content: toolResult,
            })
          );
        }
      }
      aiMessage = await llmWithTools.invoke(messages);
      messages.push(aiMessage);
    }

    const reply =
      typeof aiMessage.content === "string"
        ? aiMessage.content
        : aiMessage.content.map((c) => c.text || "").join(" ");

    const newHistory = [
      ...history,
      { type: "human", text: userMessage },
      { type: "ai", text: reply },
    ];

    return res.json({
      reply,
      history: newHistory,
      lastCity,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------- WEATHER CARD API ----------------
app.get("/api/weather", async (req, res) => {
  const city = req.query.city;
  if (!city) return res.status(400).json({ error: "City required" });

  try {
    const apiKey = process.env.OPEN_WEATHER ;
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", city);
    url.searchParams.set("appid", apiKey);
    url.searchParams.set("units", "metric");

    const response = await fetch(url.toString());
    const data = await response.json();

    return res.json({
      city: data.name,
      temp: data.main.temp,
      humidity: data.main.humidity,
      wind: data.wind.speed,
      condition: data.weather[0].description,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Unable to fetch weather" });
  }
});

// ---------------- SERVER START ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
