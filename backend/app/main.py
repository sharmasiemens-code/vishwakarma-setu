from fastapi import FastAPI

app = FastAPI(
    title="Technical Expert Marketplace API",
    description="Backend API for the Technical Expert Marketplace MVP",
    version="0.1.0",
)


@app.get("/")
def root():
    return {
        "message": "Technical Expert Marketplace API is running!",
        "status": "OK",
        "version": "0.1.0",
    }