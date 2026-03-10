import requests
import json

url = "http://localhost:8000/api/ai/analyze"
payload = {
    "platform": "whatsapp",
    "product_name": "Cable HDMI 2 Metros",
    "question": "¿Sirve para 4K?",
    "product_info": "Soporta 4K, 60Hz, mallado, puntas doradas",
    "price": 10.5,
    "stock": 50
}

try:
    print(f"Enviando request a {url}...")
    response = requests.post(url, json=payload)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        print("Response JSON:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    else:
        print("Error Response:")
        print(response.text)
except Exception as e:
    print(f"Error executing request: {e}")
