import os
import asyncio
import logging
from contextlib import asynccontextmanager


logger = logging.getLogger("tech_expert_marketplace")

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
load_dotenv()

from app.api.matching import router as matching_router
from app.api.services import router as services_router
from app.api.service_requests import router as service_requests_router
from app.api.request_photos import router as request_photos_router
from app.api.jobs import router as jobs_router
from app.api.job_start_pin import router as job_start_pin_router
from app.api.job_price_revisions import router as job_price_revisions_router
from app.api.job_completion import router as job_completion_router
from app.api.job_disputes import router as job_disputes_router
from app.api.dispute_photos import router as dispute_photos_router
from app.api.technicians import router as technicians_router
from app.api.auth import router as auth_router
from app.api.passwords import router as passwords_router
from app.api.ratings import router as ratings_router
from app.api.notifications import router as notifications_router
from app.api.admin import router as admin_router
from app.api.admin_access import router as admin_access_router
from app.api.admin_audit import router as admin_audit_router
from app.api.admin_disputes import router as admin_disputes_router
from app.api.admin_settings import router as admin_settings_router
from app.services.technician_presence import synchronize_technician_presence



async def technician_presence_worker():
    while True:
        try:
            result = await asyncio.to_thread(
                synchronize_technician_presence
            )

            if result["offline_count"] > 0:
                logger.info(
                    "Technician presence synchronization: "
                    "set %s stale technician(s) OFFLINE",
                    result["offline_count"],
                )

        except Exception:
            logger.exception(
                "Technician presence synchronization failed"
            )

        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_task = asyncio.create_task(
        technician_presence_worker()
    )

    try:
        yield
    finally:
        worker_task.cancel()

        try:
            await worker_task
        except asyncio.CancelledError:
            pass

docs_enabled = os.getenv("ENABLE_API_DOCS", "true").lower() == "true"

app = FastAPI(
    lifespan=lifespan,
    title="Technical Expert Marketplace API",    description="Backend API for the Technical Expert Marketplace MVP",
    version="0.1.0",
    docs_url="/docs" if docs_enabled else None,
    redoc_url="/redoc" if docs_enabled else None,
    openapi_url="/openapi.json" if docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
allow_origins=[
    "https://localhost",  # Packaged Capacitor Android app
    "http://localhost",   # Explicit USB debug builds
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(passwords_router)
app.include_router(matching_router)
app.include_router(services_router)
app.include_router(service_requests_router)
app.include_router(request_photos_router)
app.include_router(jobs_router)
app.include_router(job_start_pin_router)
app.include_router(job_price_revisions_router)
app.include_router(job_completion_router)
app.include_router(job_disputes_router)
app.include_router(dispute_photos_router)
app.include_router(technicians_router)
app.include_router(ratings_router)
app.include_router(notifications_router)
app.include_router(admin_router)
app.include_router(admin_access_router)
app.include_router(admin_audit_router)
app.include_router(admin_disputes_router)
app.include_router(admin_settings_router)

@app.get("/")
def root():
    return {
        "message": "Technical Expert Marketplace API is running!",
        "status": "OK",
        "version": "0.1.0",
    }
@app.get("/health")
def health_check():
    return {
        "status": "healthy"
    }