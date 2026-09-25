import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.api.matching import router as matching_router
from app.api.services import router as services_router
from app.api.service_requests import router as service_requests_router
from app.api.jobs import router as jobs_router
from app.api.technicians import router as technicians_router
from app.api.auth import router as auth_router
from app.api.ratings import router as ratings_router
from app.api.notifications import router as notifications_router



docs_enabled = os.getenv("ENABLE_API_DOCS", "true").lower() == "true"

app = FastAPI(
    title="Technical Expert Marketplace API",
    description="Backend API for the Technical Expert Marketplace MVP",
    version="0.1.0",
    docs_url="/docs" if docs_enabled else None,
    redoc_url="/redoc" if docs_enabled else None,
    openapi_url="/openapi.json" if docs_enabled else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(matching_router)
app.include_router(services_router)
app.include_router(service_requests_router)
app.include_router(jobs_router)
app.include_router(technicians_router)
app.include_router(ratings_router)
app.include_router(notifications_router)

@app.get("/")
def root():
    return {
        "message": "Technical Expert Marketplace API is running!",
        "status": "OK",
        "version": "0.1.0",
    }