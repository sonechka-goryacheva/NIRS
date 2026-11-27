print("Запуск теста OCR...")

try:
    from app.ocr import extract_text_from_file
    print("Модуль импортирован успешно.")
    
    result = extract_text_from_file("test.png")
    
    if result:
        print(f"УСПЕХ! Распознанный текст:\n{result}")
    else:
        print("Текст не распознан")
        
except Exception as e:
    print(f"Ошибка: {e}")