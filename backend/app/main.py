from fastapi import FastAPI

from app.api.matching import router as matching_router
from app.api.services import router as services_router
from app.api.service_requests import router as service_requests_router
from app.api.jobs import router as jobs_router
from app.api.technicians import router as technicians_router
from app.api.auth import router as auth_router
from app.api.ratings import router as ratings_router
from app.api.notifications import router as notifications_router



app = FastAPI(
    title="Technical Expert Marketplace API",
    description="Backend API for the Technical Expert Marketplace MVP",
    version="0.1.0",
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