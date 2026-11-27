import requests

# 1. Логинимся
login_url = "http://localhost:8000/api/auth/login"
login_data = {"login": "admin", "password": "admin123"} # или admin/admin123

session = requests.Session()
response = session.post(login_url, json=login_data)

if response.status_code == 200:
    print("✅ Авторизация успешна")
    
    # 2. Получаем список чатов и берем первый ID
    chats_url = "http://localhost:8000/api/chats"
    response = session.get(chats_url)
    
    if response.status_code == 200 and response.json():
        chat_id = response.json()[0]["id"]
        print(f"📋 Используем чат: {chat_id}")
        
        # 3. Загружаем картинку
        url = f"http://localhost:8000/api/chats/{chat_id}/upload-image"
        
        with open("test.png", "rb") as f:
            files = {"file": ("test.png", f, "image/png")}
            response = session.post(url, files=files)
            
        print(f"Status: {response.status_code}")
        print(response.json())
    else:
        print("❌ Нет доступных чатов.")
else:
    print(f"❌ Ошибка входа: {response.status_code}")