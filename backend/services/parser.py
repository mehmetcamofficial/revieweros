import os
import fitz
import docx


def extract_text_from_pdf(file_path: str) -> str:
    text = ""

    with fitz.open(file_path) as document:
        for page in document:
            text += page.get_text()

    return text


def extract_text_from_docx(file_path: str) -> str:
    document = docx.Document(file_path)
    paragraphs = []

    for paragraph in document.paragraphs:
        clean_text = paragraph.text.strip()
        if clean_text:
            paragraphs.append(clean_text)

    return "\n".join(paragraphs)


def extract_text_from_txt(file_path: str) -> str:
    with open(file_path, "r", encoding="utf-8") as file:
        return file.read()


def extract_text_from_file(file_path: str) -> str:
    extension = os.path.splitext(file_path)[1].lower()

    if extension == ".pdf":
        return extract_text_from_pdf(file_path)

    if extension == ".docx":
        return extract_text_from_docx(file_path)

    if extension == ".txt":
        return extract_text_from_txt(file_path)

    raise ValueError(f"Unsupported file type: {extension}")