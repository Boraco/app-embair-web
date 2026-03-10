
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import OpenAI
from ..config import settings

# Setup Router
router = APIRouter(prefix="/api/ai", tags=["ai"])

# Pydantic Model for Request
class AIRequest(BaseModel):
    platform: str
    product_name: str
    question: str
    product_info: Optional[str] = None # Technical info from Excel
    price: Optional[float] = None
    stock: Optional[int] = None
    api_key: Optional[str] = None # Optional user-provided key

# Pydantic Model for Response
class AIResponse(BaseModel):
    type: str # 'STOCK', 'INFO', 'UNKNOWN'
    reply: Optional[str] = None
    confidence: float = 0.0

@router.post("/analyze", response_model=AIResponse)
async def analyze_question(req: AIRequest):
    """
    Analyzes a question to determine if it's about stock/price (Standard Logic)
    or technical details (AI Logic).
    """
    if not req.question:
        raise HTTPException(status_code=400, detail="Question is required")
        
    question_lower = req.question.lower()

    # 1. Deterministic Rule-Based Check (Fast & Cheap)
    # Keywords for Stock/Price/Availability
    stock_keywords = [
        "precio", "costo", "vale", "cuesta", "$", 
        "stock", "disponible", "tienes", "queda", "hay", 
        "entrega", "envio", "llegar", "cuanto", "medidas", "talla", "color"
    ]
    
    # Check if question contains stock keywords
    is_stock = any(kw in question_lower for kw in stock_keywords)
    
    # Tech Keywords (Intent Detection)
    tech_keywords = [
        "ficha", "tecnica", "sirve", "compatible", "funciona", "diferencia", 
        "instalar", "uso", "garantia", "marca", "modelo", "caracteristica", 
        "especificacion", "voltaje", "amperaje", "material", "peso", "dimensiones",
        "medida exacta", "largo", "ancho", "alto"
    ]

    is_tech = any(kw in question_lower for kw in tech_keywords)

    # Priority: If it has technical keywords, treat as INFO even if it says "tienes"
    if is_tech:
        # Check if we have product_info (Local Knowledge Base)
        if req.product_info and len(req.product_info) > 5:
            
            # Use OpenAI to generate a natural response
            api_key = req.api_key or settings.openai_api_key
            
            if api_key:
                try:
                    client = OpenAI(api_key=api_key)
                    
                    system_prompt = f"""
                    Eres un vendedor experto en Mercado Libre. Tu objetivo es cerrar ventas.
                    Responde a la pregunta del cliente de forma CORTA, AMABLE y CONVINCENTE.
                    Usa SOLO la siguiente información técnica del producto:
                    "{req.product_info}"
                    
                    Producto: {req.product_name}
                    Precio: ${req.price}
                    
                    Reglas:
                    1. Si la información no permite responder, di solo "NO_INFO".
                    2. No inventes datos.
                    3. Máximo 2 frases.
                    4. Termina invitando a la compra sutilmente.
                    """
                    
                    response = client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": req.question}
                        ],
                        max_tokens=100,
                        temperature=0.7
                    )
                    
                    text = response.choices[0].message.content.strip()
                    
                    if "NO_INFO" in text:
                         return AIResponse(type="UNKNOWN", reply=None, confidence=0.0)
                         
                    return AIResponse(type="INFO", reply=text, confidence=0.95)
                    
                except Exception as e:
                    print(f"OpenAI Error: {e}")
                    # Fallback to simple return
                    return AIResponse(type="INFO", reply=f"Hola! {req.product_info}. Esperamos tu compra!", confidence=0.8)
            
            else:
                # Simple Fallback without AI Key
                return AIResponse(type="INFO", reply=f"Hola! {req.product_info}. Esperamos tu compra!", confidence=0.8)
        
        else:
            # Tech question but NO info in Excel
            return AIResponse(type="UNKNOWN", reply=None, confidence=0.0)

    elif is_stock:
        # Standard stock logic (handled by caller)
        return AIResponse(type="STOCK", reply=None, confidence=1.0)

    else:
        # Ambiguous. Default to UNKNOWN to trigger human alert.
        return AIResponse(type="UNKNOWN", reply=None, confidence=0.0)
