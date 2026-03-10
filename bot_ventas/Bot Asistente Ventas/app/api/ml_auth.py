from urllib.parse import urlencode

import requests
from fastapi import APIRouter, HTTPException, Query

from ..config import settings


router = APIRouter(prefix="/api/ml", tags=["Mercado Libre"])


@router.get("/auth/url")
def get_auth_url():
    if not settings.meli_client_id or not settings.meli_redirect_uri:
        raise HTTPException(status_code=500, detail="Configura MELI_CLIENT_ID y MELI_REDIRECT_URI en el .env")
    params = {
        "response_type": "code",
        "client_id": settings.meli_client_id,
        "redirect_uri": settings.meli_redirect_uri,
    }
    url = f"https://auth.mercadolibre.com.ar/authorization?{urlencode(params)}"
    return {"auth_url": url, "site_id": settings.meli_site_id}


@router.get("/search-images")
def search_images(q: str = Query(..., min_length=2)):
    site_id = settings.meli_site_id or "MLA"
    try:
        resp = requests.get(
            f"https://api.mercadolibre.com/sites/{site_id}/search",
            params={"q": q, "limit": 8},
            timeout=5,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Error consultando Mercado Libre")
    data = resp.json()
    results = []
    for item in data.get("results", []):
        results.append(
            {
                "id": item.get("id"),
                "title": item.get("title"),
                "price": item.get("price"),
                "thumbnail": item.get("thumbnail"),
                "permalink": item.get("permalink"),
            }
        )
    return {"query": q, "site_id": site_id, "items": results}


@router.get("/competition")
def competition(q: str = Query(..., min_length=2)):
    site_id = settings.meli_site_id or "MLA"
    try:
        resp = requests.get(
            f"https://api.mercadolibre.com/sites/{site_id}/search",
            params={"q": q, "limit": 20},
            timeout=5,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Error consultando Mercado Libre")

    data = resp.json()
    items = []
    for rank, item in enumerate(data.get("results", []), start=1):
        items.append(
            {
                "rank": rank,
                "id": item.get("id"),
                "title": item.get("title"),
                "price": item.get("price"),
                "thumbnail": item.get("thumbnail"),
                "permalink": item.get("permalink"),
                "sold_quantity": item.get("sold_quantity"),
            }
        )

    return {"query": q, "site_id": site_id, "items": items}
