// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import mongoose from "mongoose";
import { createClient } from "redis";

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

// ---------------- MONGODB CONNECTION ----------------
// Optimized for Vercel Serverless - minimal pooling
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // Serverless-friendly: no pooling, single connection per instance
      maxPoolSize: 1,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    // Retry connection after 5 seconds
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err);
});

connectDB();

// Helper to check DB connection
const checkDBConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: 'Database unavailable', 
      message: 'MongoDB is not connected. Please try again.' 
    });
  }
  next();
};

// ---------------- REDIS CONNECTION ----------------
const redisClient = createClient({
  username: 'default',
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT)
  }
});

redisClient.on('error', (err) => console.error('❌ Redis error:', err));
redisClient.on('connect', () => console.log('✅ Redis connected'));

await redisClient.connect();

// ---------------- MONGODB SCHEMA ----------------
const conversationSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, unique: true, index: true },
  messages: [{
    type: { type: String, enum: ['user', 'bot'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  history: [{
    type: { type: String, enum: ['human', 'ai'], required: true },
    text: { type: String, required: true }
  }],
  lastCity: { type: String, default: null },
  title: { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// ---------------- CONVERSATION STORAGE ----------------
// In-memory cache for active conversations (for quick access)
const conversationCache = new Map();

// EventEmitter for broadcasting to multiple clients
const conversationEvents = new EventEmitter();
conversationEvents.setMaxListeners(100); // Support many concurrent connections

// Track SSE clients per conversation
const conversationClients = new Map(); // conversationId -> Set of response objects

// ---------------- LLM SETUP ----------------
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.4,
  maxTokens: 1024,
  configuration: {
    apiKey: process.env.OPENROUTER_API_KEY ,
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
    const apiKey = process.env.OPEN_WEATHER_API_KEY;

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
You are a helpful and knowledgeable AI assistant with weather capabilities.

RULES:
1. Use the get_weather tool to look up weather information when the user asks about current weather or forecasts.
2. If the user asks for a forecast, use the "forecast" type parameter.
3. You can answer ANY question on ANY topic - weather, stories, facts, advice, explanations, creative writing, etc.
4. ALWAYS provide direct, complete answers. NEVER ask clarifying questions like "What topic would you like?" or "Do you have a preference?"
5. If asked for a story, creative content, or open-ended request, immediately generate engaging, detailed content without hesitation.
6. Be conversational, helpful, and comprehensive in your responses.
7. For creative requests (stories, poems, etc.), make them long, detailed, and engaging.
`;

// ---------------- CREATE NEW CONVERSATION ----------------
app.post("/api/conversations", checkDBConnection, async (req, res) => {
  try {
    const conversationId = randomUUID();
    const newConversation = new Conversation({
      conversationId,
      messages: [],
      history: [],
      lastCity: null,
      title: "New Chat",
      createdAt: new Date(),
      lastActivity: new Date()
    });
    
    await newConversation.save();
    console.log('✅ Created conversation:', conversationId);
    res.json({ conversationId });
  } catch (error) {
    console.error('❌ Error creating conversation:', error);
    res.status(500).json({ 
      error: 'Failed to create conversation',
      message: error.message 
    });
  }
});

// ---------------- GET CONVERSATION ----------------
app.get("/api/conversations/:id", checkDBConnection, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ conversationId: req.params.id }).lean();
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.json({
      id: conversation.conversationId,
      messages: conversation.messages,
      history: conversation.history,
      lastCity: conversation.lastCity,
      title: conversation.title,
      createdAt: conversation.createdAt,
      lastActivity: conversation.lastActivity
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// ---------------- LIST CONVERSATIONS ----------------
app.get("/api/conversations", checkDBConnection, async (req, res) => {
  try {
    const allConversations = await Conversation.find()
      .sort({ lastActivity: -1 })
      .select('conversationId title lastActivity messages')
      .lean();
    
    res.json(allConversations.map(c => ({
      id: c.conversationId,
      title: c.title,
      lastActivity: c.lastActivity,
      messageCount: c.messages?.length || 0
    })));
  } catch (error) {
    console.error('Error listing conversations:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// ---------------- STREAM CONVERSATION UPDATES (SSE) ----------------
app.get("/api/stream/:conversationId", async (req, res) => {
  const conversationId = req.params.conversationId;
  const lastEventId = req.headers['last-event-id'];

  console.log(`📡 SSE: ${conversationId} | Last-Event-ID: ${lastEventId || 'new'}`);

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Add this client to the conversation's client list
  if (!conversationClients.has(conversationId)) {
    conversationClients.set(conversationId, new Set());
  }
  conversationClients.get(conversationId).add(res);

  // Handle reconnection - replay missed events from Redis
  const streamKey = `stream:${conversationId}`;
  
  if (lastEventId) {
    try {
      console.log(`🔄 Reconnect: replaying from ${lastEventId}`);
      const events = await redisClient.xRange(streamKey, `(${lastEventId}`, '+');
      
      if (events?.length > 0) {
        console.log(`✅ Replaying ${events.length} events`);
        for (const event of events) {
          const data = JSON.parse(event.message.data);
          res.write(`id: ${event.id}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      }
    } catch (err) {
      console.error('❌ Replay error:', err);
    }
  } else {
    // New connection - send connected event
    try {
      const eventData = { type: "connected", conversationId };
      const eventId = await redisClient.xAdd(streamKey, '*', {
        data: JSON.stringify(eventData)
      });
      res.write(`id: ${eventId}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch (err) {
      console.error('❌ Redis error:', err);
      const fallbackId = Date.now().toString();
      res.write(`id: ${fallbackId}\ndata: ${JSON.stringify({ type: "connected", conversationId })}\n\n`);
    }
  }

  // Set up event listeners for this conversation
  const messageHandler = async (data) => {
    try {
      const eventData = { type: "message", message: data.message };
      const eventId = await redisClient.xAdd(streamKey, '*', {
        data: JSON.stringify(eventData)
      });
      res.write(`id: ${eventId}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch (err) {
      console.error("❌ Message handler error:", err);
    }
  };

  const tokenHandler = async (data) => {
    try {
      const eventData = { type: "token", content: data.content, messageId: data.messageId };
      const eventId = await redisClient.xAdd(streamKey, '*', {
        data: JSON.stringify(eventData)
      });
      res.write(`id: ${eventId}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch (err) {
      console.error("❌ Token handler error:", err);
    }
  };

  const statusHandler = async (data) => {
    try {
      const eventData = { type: "status", content: data.content };
      const eventId = await redisClient.xAdd(streamKey, '*', {
        data: JSON.stringify(eventData)
      });
      res.write(`id: ${eventId}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch (err) {
      console.error("❌ Status handler error:", err);
    }
  };

  const doneHandler = async (data) => {
    try {
      const eventData = { type: "done", messageId: data.messageId };
      const eventId = await redisClient.xAdd(streamKey, '*', {
        data: JSON.stringify(eventData)
      });
      res.write(`id: ${eventId}\ndata: ${JSON.stringify(eventData)}\n\n`);
      
      // Expire stream after 1 hour
      await redisClient.expire(streamKey, 3600);
    } catch (err) {
      console.error("❌ Done handler error:", err);
    }
  };

  conversationEvents.on(`${conversationId}:message`, messageHandler);
  conversationEvents.on(`${conversationId}:token`, tokenHandler);
  conversationEvents.on(`${conversationId}:status`, statusHandler);
  conversationEvents.on(`${conversationId}:done`, doneHandler);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    conversationEvents.off(`${conversationId}:message`, messageHandler);
    conversationEvents.off(`${conversationId}:token`, tokenHandler);
    conversationEvents.off(`${conversationId}:status`, statusHandler);
    conversationEvents.off(`${conversationId}:done`, doneHandler);
    
    const clients = conversationClients.get(conversationId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        conversationClients.delete(conversationId);
      }
    }
  });
});

// ---------------- CHAT ENDPOINT (JSON POST) ----------------
app.post("/api/chat/:conversationId", checkDBConnection, async (req, res) => {
  const conversationId = req.params.conversationId;
  
  try {
    const userMessage = String(req.body?.message || "").trim();

    if (!userMessage) {
      return res.status(400).json({ error: "message required" });
    }

    // Get or create conversation from MongoDB
    let conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      conversation = new Conversation({
        conversationId,
        messages: [],
        history: [],
        lastCity: null,
        title: userMessage.substring(0, 50),
        createdAt: new Date(),
        lastActivity: new Date()
      });
    }

    conversation.lastActivity = new Date();

    // Add user message to DB
    const userMsgId = Date.now();
    const userMsg = { type: "user", text: userMessage, timestamp: new Date() };
    conversation.messages.push(userMsg);
    await conversation.save();

    // Broadcast user message to all connected clients IMMEDIATELY
    conversationEvents.emit(`${conversationId}:message`, {
      message: { type: "user", text: userMessage, id: userMsgId }
    });

    // Broadcast processing status immediately
    conversationEvents.emit(`${conversationId}:status`, {
      content: "processing"
    });

    // Send immediate response to poster
    res.json({ success: true, conversationId, messageId: userMsgId });

    // Process AI response in background (non-blocking)
    setImmediate(async () => {
      try {
        // Build LangChain messages
        const messages = [new SystemMessage(SYSTEM_PROMPT)];

        for (const m of conversation.history) {
          if (m.type === "human") messages.push(new HumanMessage(m.text));
          if (m.type === "ai") messages.push(new AIMessage(m.text));
        }

        messages.push(new HumanMessage(userMessage));

        // STEP 1: TOOL DECISION (NO STREAMING)
        let aiMessage = await llmWithTools.invoke(messages);
        messages.push(aiMessage);

        // STEP 2: HANDLE TOOL CALLS
        if (aiMessage.tool_calls?.length) {
          for (const call of aiMessage.tool_calls) {
            if (call.name === "get_weather") {
              conversation.lastCity = call.args.city;

              // Broadcast status to all connected clients
              conversationEvents.emit(`${conversationId}:status`, {
                content: "Fetching weather data...",
              });

              const toolResult = await getWeatherTool.invoke(call.args);

              messages.push(
                new ToolMessage({
                  tool_call_id: call.id,
                  content: toolResult,
                })
              );
            }
          }
        }

        // Broadcast that streaming is starting
        conversationEvents.emit(`${conversationId}:status`, {
          content: "generating"
        });

        // STEP 3: STREAM FINAL RESPONSE
        const messageId = Date.now();
        const finalStream = await llm.stream(messages);
        let fullReply = "";

        for await (const chunk of finalStream) {
          if (!chunk.content) continue;

          const text =
            typeof chunk.content === "string"
              ? chunk.content
              : chunk.content.map((c) => c.text || "").join("");

          if (text) {
            fullReply += text;
            
            // Broadcast token to all connected clients
            conversationEvents.emit(`${conversationId}:token`, {
              content: text,
              messageId
            });
          }
        }

        // Safety fallback
        if (!fullReply.trim()) {
          fullReply = "Here's the weather information you requested 🌦";
        }

        // Update conversation in DB
        conversation.messages.push({ type: "bot", text: fullReply, timestamp: new Date() });
        conversation.history.push({ type: "human", text: userMessage });
        conversation.history.push({ type: "ai", text: fullReply });
        await conversation.save();

        // Broadcast completion to all connected clients
        conversationEvents.emit(`${conversationId}:done`, {
          messageId
        });

      } catch (error) {
        console.error("AI processing error:", error);
        conversationEvents.emit(`${conversationId}:message`, {
          message: { type: "bot", text: "Sorry, an error occurred.", id: Date.now() }
        });
        conversationEvents.emit(`${conversationId}:done`, {
          messageId: Date.now()
        });
      }
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}); 


// ---------------- WEATHER CARD API ----------------
app.get("/api/weather", async (req, res) => {
  const city = req.query.city;
  if (!city) return res.status(400).json({ error: "City required" });

  try {
    const apiKey = process.env.OPEN_WEATHER_API_KEY;
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", city);
    url.searchParams.set("appid", apiKey);
    url.searchParams.set("units", "metric");

    const response = await fetch(url.toString());
    const data = await response.json();

    // Handle invalid response (city not found / quota exceeded / bad key)
    if (!response.ok || !data.main) {
      return res.status(404).json({
        error: data.message || `Could not find weather for "${city}"`,
      });
    }

    return res.json({
      city: data.name,
      temp: data.main.temp,
      humidity: data.main.humidity,
      wind: data.wind.speed,
      condition: data.weather?.[0]?.description || "Unknown",
    });
  } catch (error) {
    console.error("Weather API error:", error);
    return res.status(500).json({ error: "Unable to fetch weather" });
  }
});

// ---------------- SERVER START ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
