"""
app/ocr.py - OCR module using EasyOCR.
Supports Russian and English text recognition from images.
"""

import io
import numpy as np
from PIL import Image
import easyocr

_reader = None

def _get_reader():
    global _reader
    if _reader is None:
        # ru + en для поддержки смешанного текста
        _reader = easyocr.Reader(['ru', 'en'], gpu=False)
    return _reader

def extract_text_from_image(image_bytes: bytes) -> str:
    try:
        # Открываем изображение через PIL
        image = Image.open(io.BytesIO(image_bytes))
        
        # Конвертируем в RGB (убираем прозрачность и прочее)
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Превращаем в numpy array - это самый надежный формат для EasyOCR
        image_array = np.array(image)
        
        reader = _get_reader()
        # Передаем массив напрямую
        results = reader.readtext(image_array)
        
        # Собираем текст
        texts = [res[1] for res in results]
        return ' '.join(texts).strip()
        
    except Exception as e:
        print(f"OCR error details: {e}")
        return ""

def extract_text_from_file(file_path: str) -> str:
    try:
        with open(file_path, 'rb') as f:
            image_bytes = f.read()
        return extract_text_from_image(image_bytes)
    except Exception as e:
        print(f"OCR file error: {e}")
        return ""