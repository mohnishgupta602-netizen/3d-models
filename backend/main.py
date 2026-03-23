import os
from typing import Optional
from dotenv import load_dotenv
load_dotenv()

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from intent import IntentAnalyzer
from search import ModelSearchEngine

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

app = FastAPI(title="3D Model Generation API")

# Setup CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

intent_analyzer = IntentAnalyzer()
search_engine = ModelSearchEngine()

class QueryRequest(BaseModel):
    query: str

@app.post("/api/intent")
async def analyze_intent(request: QueryRequest):
    """
    Expands the user prompt into primary keywords, structural components, and context.
    Provides fallback capabilities using Gemini if configured.
    """
    try:
        result = intent_analyzer.parse(request.query)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/search")
async def search_models(request: QueryRequest):
    """
    Takes the parsed intent and queries external APIs to find the best 3D models.
    """
    try:
        # First, analyze intent (or expect the frontend to pass the intent)
        intent = intent_analyzer.parse(request.query)
        
        # Search using the intent keywords
        results = search_engine.search(intent)
        
        if not results:
            # Fallback 1: Procedural generation metadata
            return {
                "status": "fallback",
                "message": "No specific models found, using procedural generation.",
                "data": {
                    "type": "procedural",
                    "components": intent.get("structural_components", ["sphere", "box"])
                }
            }
        
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChatRequest(BaseModel):
    message: str
    model_context: Optional[str] = None

@app.post("/api/chat")
async def chat_with_ai(request: ChatRequest):
    """
    Handles user questions about the current model using Groq API.
    """
    try:
        completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": f"You are a helpful AI 3D design assistant. The user is currently viewing a 3D model: {request.model_context or 'Unknown'}. Answer their questions concisely."
                },
                {
                    "role": "user",
                    "content": request.message,
                }
            ],
            model="llama-3.3-70b-versatile",
        )
        return {"status": "success", "message": completion.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
