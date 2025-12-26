from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routes import images, imports, credentials

app = FastAPI(title="Drive to AWS Importer", version="0.1.0")

# Allow frontend/browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(imports.router, prefix="/api/v1")
app.include_router(images.router, prefix="/api/v1")
app.include_router(credentials.router, prefix="/api/v1")
