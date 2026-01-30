// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import mongoose from "mongoose";
import { createClient } from "redis";
import { StreamManager } from "./lib/stream-manager.js";
import { SSEConnectionManager } from "./lib/sse-handler.js";

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

// Production CORS configuration - allow multiple origins
const allowedOrigins = [
  'https://sanchweatherai.vercel.app',
  'https://sanch-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(null, true); // Allow all origins in production for now
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID', 'Cache-Control'],
  exposedHeaders: ['Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static("public"));

// ---------------- MONGODB CONNECTION ----------------
// Production-ready connection with auto-reconnect and health checks
let isConnecting = false;

const connectDB = async () => {
  if (isConnecting) return;
  isConnecting = true;
  
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      minPoolSize: 5,
      maxPoolSize: 20,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true,
    });
    console.log('✅ MongoDB connected successfully');
    isConnecting = false;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    isConnecting = false;
    // Retry with exponential backoff
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connection established');
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected. Reconnecting...');
  if (!isConnecting) {
    connectDB();
  }
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err.message);
  if (!isConnecting && mongoose.connection.readyState === 0) {
    connectDB();
  }
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
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
    port: parseInt(process.env.REDIS_PORT),
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('❌ Redis max reconnection attempts reached');
        return new Error('Max reconnection attempts reached');
      }
      const delay = Math.min(retries * 100, 3000);
      console.log(`🔄 Redis reconnecting in ${delay}ms...`);
      return delay;
    }
  }
});

redisClient.on('error', (err) => console.error('❌ Redis error:', err));
redisClient.on('connect', () => console.log('✅ Redis connected'));

await redisClient.connect();

// Initialize stream manager and SSE handler
const streamManager = new StreamManager(redisClient);
const sseManager = new SSEConnectionManager();

// Cleanup old streams every 30 minutes
setInterval(() => streamManager.cleanup(), 30 * 60 * 1000);

// ---------------- MONGODB SCHEMA ----------------
const conversationSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, unique: true, index: true },
  messages: [{
    id: { type: String, default: () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` },
    type: { type: String, enum: ['user', 'bot'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    streaming: { type: Boolean, default: false }
  }],
  history: [{
    type: { type: String, enum: ['human', 'ai'], required: true },
    text: { type: String, required: true }
  }],
  lastCity: { type: String, default: null },
  title: { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now, index: true }
});

// Add compound index for faster queries
conversationSchema.index({ conversationId: 1, lastActivity: -1 });

// Pre-save hook to ensure all messages have IDs (for backward compatibility)
conversationSchema.pre('save', function() {
  if (this.messages && this.messages.length > 0) {
    this.messages.forEach((msg, index) => {
      if (!msg.id) {
        msg.id = `msg-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 6)}`;
      }
    });
  }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// ---------------- CONVERSATION STORAGE ----------------
// In-memory cache for active conversations with TTL
const conversationCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedConversation(id) {
  const cached = conversationCache.get(id);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  conversationCache.delete(id);
  return null;
}

function setCachedConversation(id, data) {
  conversationCache.set(id, {
    data,
    timestamp: Date.now()
  });
}

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

// ---------------- HEALTH CHECK ENDPOINT ----------------
app.get("/api/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      redis: redisClient.isOpen ? "connected" : "disconnected",
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };
  
  const status = health.services.mongodb === "connected" ? 200 : 503;
  res.status(status).json(health);
});

// Simple test endpoint
app.get("/api/test", (req, res) => {
  res.json({ 
    message: "Backend is working!", 
    timestamp: new Date().toISOString(),
    cors: "enabled"
  });
});

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
    setCachedConversation(conversationId, newConversation);
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
    let conversation = getCachedConversation(req.params.id);
    
    if (!conversation) {
      conversation = await Conversation.findOne({ conversationId: req.params.id })
        .select('conversationId messages history lastCity title createdAt lastActivity')
        .lean();
      
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      setCachedConversation(req.params.id, conversation);
    }
    
    // Include all messages, including streaming ones - frontend handles display
    const messages = conversation.messages;
    
    res.json({
      id: conversation.conversationId,
      messages: messages,
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
      .limit(50)
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

  console.log(`📡 SSE: ${conversationId} | Last-Event-ID: ${lastEventId || 'new'} | Clients: ${sseManager.getClientCount(conversationId)}`);

  // Set SSE headers with Vercel-compatible configuration
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Set SSE headers and start heartbeat
  const heartbeat = sseManager.setupSSE(res);
  
  // Add this client to the conversation's client list
  sseManager.addConnection(conversationId, res);

  // Handle reconnection - send current message state
  if (lastEventId) {
    try {
      console.log(`🔄 Reconnect: syncing state from ${lastEventId}`);
      
      // Get current conversation state from DB
      const conversation = await Conversation.findOne({ conversationId }).lean();
      if (conversation && conversation.messages.length > 0) {
        // Send ALL messages including streaming ones with their accumulated text
        const allMessages = conversation.messages.map(m => ({
          id: m.id,
          type: m.type,
          text: m.text,
          streaming: m.streaming || false,
          timestamp: m.timestamp
        }));
        
        const syncData = {
          type: "sync",
          messages: allMessages,
          syncedAt: Date.now()
        };
        const syncEventId = `sync-${Date.now()}`;
        
        sseManager.sendToClient(res, 'message', syncData, syncEventId);
        
        // Check for active streaming messages
        const streamingMsg = allMessages.find(m => m.streaming);
        if (streamingMsg) {
          console.log(`📝 Active stream: ${streamingMsg.id}, length: ${streamingMsg.text?.length || 0}`);
          
          // Try to resume the stream
          const streamId = `stream:${conversationId}:${streamingMsg.id}`;
          const resumeResult = await streamManager.resumeStream(streamId);
          
          if (resumeResult.found && resumeResult.status === 'active') {
            // Update the streaming message text in allMessages with current stream text
            const msgIndex = allMessages.findIndex(m => m.id === streamingMsg.id);
            if (msgIndex !== -1) {
              allMessages[msgIndex].text = resumeResult.text;
            }
            
            sseManager.sendToClient(res, 'message', {
              type: 'resume',
              messageId: streamingMsg.id,
              currentText: resumeResult.text,
              isComplete: false
            });
          }
        }
      }
    } catch (err) {
      console.error('❌ Reconnect error:', err);
    }
  } else {
    // New connection - send connected event
    const eventData = { type: "connected", conversationId, timestamp: Date.now() };
    const eventId = `conn-${Date.now()}`;
    sseManager.sendToClient(res, 'message', eventData, eventId);
  }

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    sseManager.removeConnection(conversationId, res);
    console.log(`🔌 Client disconnected: ${conversationId} | Remaining: ${sseManager.getClientCount(conversationId)}`);
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
    const userMsgId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const userMsg = { 
      id: userMsgId,
      type: "user", 
      text: userMessage, 
      timestamp: new Date(),
      streaming: false
    };
    await Conversation.findOneAndUpdate(
      { conversationId },
      { 
        $push: { messages: userMsg },
        $set: { lastActivity: new Date() }
      }
    );
    
    // Invalidate cache
    conversationCache.delete(conversationId);

    // CRITICAL: Broadcast user message to ALL connected clients
    const clientCount = sseManager.getClientCount(conversationId);
    console.log(`📤 Broadcasting user message to ${clientCount} clients`);
    sseManager.broadcast(conversationId, 'message', {
      type: "message",
      message: { type: "user", text: userMessage, id: userMsgId, timestamp: new Date() }
    });

    // Send immediate response to poster
    res.json({ success: true, conversationId, messageId: userMsgId });

    // Process AI response in background (non-blocking)
    setImmediate(async () => {
      const botMsgId = `bot-${Date.now()}`;
      let fullReply = "";
      let streamId = null;
      
      try {
        // Refetch conversation for latest history
        const latestConversation = await Conversation.findOne({ conversationId });
        if (!latestConversation) {
          console.error('❌ Conversation not found:', conversationId);
          return;
        }
        
        // Broadcast processing status AFTER user message is sent
        console.log(`📤 Broadcasting status to ${sseManager.getClientCount(conversationId)} clients`);
        sseManager.broadcast(conversationId, 'message', {
          type: "status",
          content: "processing"
        });
        
        // Build LangChain messages
        const messages = [new SystemMessage(SYSTEM_PROMPT)];

        for (const m of latestConversation.history) {
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
              // Update lastCity in database
              await Conversation.findOneAndUpdate(
                { conversationId },
                { $set: { lastCity: call.args.city } }
              );

              // Broadcast status to all connected clients
              console.log(`📤 Broadcasting weather status to ${sseManager.getClientCount(conversationId)} clients`);
              sseManager.broadcast(conversationId, 'message', {
                type: "status",
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

        // Create resumable stream
        streamId = await streamManager.createStream(conversationId, botMsgId);

        // Broadcast that streaming is starting
        sseManager.broadcast(conversationId, 'message', {
          type: "status",
          content: "generating"
        });

        // STEP 3: STREAM FINAL RESPONSE
        const finalStream = await llm.stream(messages);

        for await (const chunk of finalStream) {
          if (!chunk.content) continue;

          const text =
            typeof chunk.content === "string"
              ? chunk.content
              : chunk.content.map((c) => c.text || "").join("");

          if (text) {
            fullReply += text;
            
            // Append to resumable stream
            await streamManager.appendToStream(streamId, text);
            
            // Broadcast token to all connected clients
            const clientCount = sseManager.getClientCount(conversationId);
            console.log(`📤 Broadcasting token to ${clientCount} clients:`, text.substring(0, 20));
            sseManager.broadcast(conversationId, 'message', {
              type: "token",
              content: text,
              messageId: botMsgId
            });
            
            // CRITICAL: Persist full accumulated text on EVERY token
            // This ensures database is always authoritative source of truth
            const existingMsg = await Conversation.findOne(
              { conversationId, "messages.id": botMsgId }
            );
            
            if (!existingMsg) {
              // First token - create the message
              await Conversation.findOneAndUpdate(
                { conversationId },
                { $push: { messages: {
                  id: botMsgId,
                  type: "bot",
                  text: fullReply,
                  timestamp: new Date(),
                  streaming: true
                } } }
              );
            } else {
              // Update existing message with full accumulated text
              await Conversation.findOneAndUpdate(
                { conversationId, "messages.id": botMsgId },
                { $set: { "messages.$.text": fullReply } }
              );
            }
          }
        }

        // Safety fallback
        if (!fullReply.trim()) {
          fullReply = "Here's the weather information you requested 🌦";
        }

        // Complete the stream
        if (streamId) {
          await streamManager.completeStream(streamId);
        }

        // Final save with streaming=false
        await Conversation.findOneAndUpdate(
          { conversationId, "messages.id": botMsgId },
          { 
            $set: { 
              "messages.$.text": fullReply, 
              "messages.$.streaming": false 
            },
            $push: { 
              history: { 
                $each: [
                  { type: "human", text: userMessage },
                  { type: "ai", text: fullReply }
                ]
              }
            }
          }
        );
        
        // Invalidate cache
        conversationCache.delete(conversationId);

        // Broadcast completion to all connected clients
        sseManager.broadcast(conversationId, 'message', {
          type: "done",
          messageId: botMsgId
        });

      } catch (error) {
        console.error("AI processing error:", error);
        
        // Remove streaming message on error
        await Conversation.findOneAndUpdate(
          { conversationId },
          { $pull: { messages: { id: botMsgId } } }
        );
        
        sseManager.broadcast(conversationId, 'message', {
          type: "message",
          message: { type: "bot", text: "Sorry, an error occurred.", id: `error-${Date.now()}` }
        });
        sseManager.broadcast(conversationId, 'message', {
          type: "done",
          messageId: botMsgId
        });
      }
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}); 


// ---------------- RESUME STREAM ENDPOINT ----------------
app.get("/api/conversations/:conversationId/resume", checkDBConnection, async (req, res) => {
  const { conversationId } = req.params;
  const { messageId } = req.query;

  try {
    if (!messageId) {
      return res.status(400).json({ error: "messageId required" });
    }

    // Get conversation from DB
    const conversation = await Conversation.findOne({ conversationId }).lean();
    
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Find the message
    const message = conversation.messages.find(m => m.id === messageId);
    
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Try to resume from stream manager
    const streamId = `stream:${conversationId}:${messageId}`;
    const resumeResult = await streamManager.resumeStream(streamId);

    if (resumeResult.found) {
      return res.json({
        success: true,
        messageId,
        text: resumeResult.text,
        status: resumeResult.status,
        isStreaming: message.streaming || false
      });
    }

    // Fallback to database message
    return res.json({
      success: true,
      messageId,
      text: message.text,
      status: message.streaming ? "active" : "completed",
      isStreaming: message.streaming || false
    });

  } catch (error) {
    console.error("Resume stream error:", error);
    res.status(500).json({ error: "Failed to resume stream" });
  }
});

// ---------------- WEATHER CARD API ----------------
app.get("/api/weather", async (req, res) => {
  const city = req.query.city;
  if (!city) return res.status(400).json({ error: "City required" });

  try {
    const apiKey = process.env.OPEN_WEATHER_API_KEY || process.env.WEATHER_API_KEY;
    
    if (!apiKey) {
      console.error('❌ Weather API key not configured');
      return res.status(500).json({ error: "Weather service not configured" });
    }
    
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", city);
    url.searchParams.set("appid", apiKey);
    url.searchParams.set("units", "metric");

    console.log(`🌤️ Fetching weather for: ${city}`);
    const response = await fetch(url.toString());
    const data = await response.json();

    // Handle invalid response (city not found / quota exceeded / bad key)
    if (!response.ok || !data.main) {
      console.error('❌ Weather API error:', data.message || 'Unknown error');
      return res.status(response.status || 404).json({
        error: data.message || `Could not find weather for "${city}"`,
      });
    }

    console.log(`✅ Weather data fetched for ${city}`);
    return res.json({
      city: data.name,
      temp: data.main.temp,
      humidity: data.main.humidity,
      wind: data.wind.speed,
      condition: data.weather?.[0]?.description || "Unknown",
    });
  } catch (error) {
    console.error("❌ Weather API error:", error.message);
    return res.status(500).json({ 
      error: "Unable to fetch weather",
      details: error.message 
    });
  }
});

// ---------------- SERVER START ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));  