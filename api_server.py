from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import os
import glob
from pypdf import PdfReader
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Key from environment variable (set in Render dashboard)
api_key = os.environ.get("GEMINI_API_KEY", "AIzaSyD5qSlQURuVciEuVT6o-JRYX3eJs-S2IWQ")
genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-1.5-flash')

# PDFs in the ./normativas/ folder (relative to this file)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
pdf_dir = os.path.join(BASE_DIR, "normativas")
context_text = ""

try:
    pdf_files = glob.glob(os.path.join(pdf_dir, "*.pdf"))
    if pdf_files:
        for file in pdf_files:
            try:
                reader = PdfReader(file)
                text = ""
                for page in reader.pages[:10]:  # Limit to 10 pages per doc
                    extracted = page.extract_text()
                    if extracted:
                        text += extracted + "\n"
                context_text += f"\n--- Documento: {os.path.basename(file)} ---\n{text}\n"
            except Exception as file_e:
                print(f"Error procesando {file}: {file_e}")
        print(f"[OK] Cargados {len(pdf_files)} PDFs de normativas. Contexto: {len(context_text)} caracteres.")
    else:
        print(f"[INFO] No se encontraron PDFs en {pdf_dir}. La IA usará conocimiento general.")
except Exception as e:
    print(f"Error leyendo el directorio {pdf_dir}: {e}")


@app.get("/")
def health_check():
    return {
        "status": "ok",
        "pdfs_loaded": context_text != "",
        "context_chars": len(context_text)
    }


class AnalyzeRequest(BaseModel):
    address: str
    zone: str


@app.post("/analyze")
def analyze_plot(req: AnalyzeRequest):
    if context_text:
        context_section = f"""
A continuación, se adjunta un extracto de los reglamentos de construcción oficiales:
<reglamentos>
{context_text[:60000]}
</reglamentos>
"""
    else:
        context_section = """
(No se han cargado reglamentos locales. Usa tu conocimiento experto general sobre normativas urbanísticas en Rosario y Funes, Argentina.)
"""

    prompt = f"""
    Eres un experto arquitecto y analista urbanístico de Rosario y Funes.
    {context_section}
    
    Dirección consultada: {req.address}
    Zona general u opción elegida en la interfaz: {req.zone}
    
    Basado EXCLUSIVAMENTE en tu experto conocimiento en normativas urbanísticas (usando los reglamentos previstos como referencia, o tu conocimiento general de normativas argentinas/Rosario/Funes si la dirección no aparece), determina los valores urbanísticos para ese lote.
    
    Devuelve ÚNICAMENTE un JSON válido con la siguiente estructura, sin formato markdown, sin comillas triples, estrictamente parseable. Si no encuentras el dato exacto, da una aproximación basada en la zona (ej. Macrocentro = FOT 3, Funes = FOS 0.2):
    {{
      "fot": 2.5,
      "fos": 0.7,
      "retiroFrente": 3,
      "retiroLateral": 0,
      "retiroFondo": 4,
      "justificacion": "Breve explicación de por qué aplican estos valores según la zona..."
    }}
    """
    try:
        response = model.generate_content(prompt)
        import re
        match = re.search(r'\{[\s\S]*\}', response.text)
        if match:
            raw = match.group(0)
            return json.loads(raw)
        else:
            return {"error": "El servidor de IA no devolvió un JSON válido.", "raw_response": response.text}
    except Exception as e:
        return {"error": str(e), "raw_response": response.text if 'response' in locals() else None}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
