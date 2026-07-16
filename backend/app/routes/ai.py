import os
import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

router = APIRouter(
    tags=["AI Assistant"]
)

class ChatMessage(BaseModel):
    role: str  # "user" | "model"
    text: str

class ChatWaiterRequest(BaseModel):
    brandName: str
    slogan: str
    menuItems: List[Dict[str, Any]]
    history: List[ChatMessage]
    message: str

@router.post("/chat-waiter")
async def chat_waiter(payload: ChatWaiterRequest):
    api_key = os.getenv("GEMINI_API_KEY", "")
    
    # 1. Fallback / Mock Response Helper
    def get_mock_reply(msg: str) -> str:
        lower = msg.lower()
        if "pastel" in lower:
            return "Temos pastéis tradicionais incríveis (carne, queijo, frango) a partir de R$ 12.00 e pastel doce de Nutella com Morango! Qual sabor gostaria?"
        elif "burger" in lower or "hambur" in lower or "carne" in lower:
            return f"Nosso carro-chefe na {payload.brandName} é o Hambúrguer Kôma, com blend artesanal de 150g, muito queijo derretido e molho especial no pão brioche! Deseja um?"
        elif "bebida" in lower or "refrigerante" in lower or "coca" in lower:
            return "Temos Coca-Cola, Guaraná, Sucos Naturais geladinhos e Cerveja Heineken em lata! Qual vai acompanhar?"
        elif "oi" in lower or "olá" in lower or "bom dia" in lower:
            return f"Olá! Sou o Chef & Garçom Virtual da {payload.brandName}. Como posso te ajudar a escolher a delícia de hoje?"
        else:
            return "Temos deliciosos hambúrgueres gourmet, pastéis fritos na hora, bebidas e sobremesas em nosso cardápio! Gostaria de uma recomendação?"

    # If key is empty or placeholder, use fallback immediately
    if not api_key or api_key == "sua-chave-gemini-api":
        return {"reply": get_mock_reply(payload.message)}
        
    # 2. Build Gemini payload
    menu_items_str = ""
    for item in payload.menuItems:
        nome = item.get("nome", "")
        categoria = item.get("categoria", "")
        preco = item.get("preco", 0.0)
        descricao = item.get("descricao", "")
        menu_items_str += f"- [{categoria}] {nome} - R$ {preco:.2f} ({descricao})\n"
        
    system_instruction = f"""Você é o Chef & Garçom Virtual da {payload.brandName}.
Slogan: {payload.slogan}
Aqui está o nosso cardápio atual com categorias, nomes, preços e descrições dos pratos:
{menu_items_str}

Instruções importantes:
1. Responda sempre de forma educada, prestativa e convidativa.
2. Seu objetivo é ajudar o cliente a escolher e sugerir pratos ou bebidas do nosso cardápio.
3. Se o cliente perguntar o que comer, recomende opções do cardápio acima de forma entusiasmada.
4. Se o cliente pedir algo que não está no cardápio, informe gentilmente que não oferecemos esse item e sugira uma alternativa próxima do nosso cardápio.
5. Seja conciso e evite respostas excessivamente longas."""

    contents = []
    for msg in payload.history:
        role = "user" if msg.role == "user" else "model"
        contents.append({
            "role": role,
            "parts": [{"text": msg.text}]
        })
        
    contents.append({
        "role": "user",
        "parts": [{"text": payload.message}]
    })
    
    gemini_payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        }
    }
    
    # 3. Call Gemini API
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=gemini_payload, timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                reply = data["candidates"][0]["content"]["parts"][0]["text"]
                return {"reply": reply}
            else:
                return {"reply": get_mock_reply(payload.message)}
        except Exception:
            return {"reply": get_mock_reply(payload.message)}
