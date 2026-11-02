from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


from app import config
from app.routes import detective, health, shield
from app.services.meta_client import AIError

app = FastAPI(title="ReConnect AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(detective.router)
app.include_router(shield.router)


@app.exception_handler(AIError)
async def ai_error_handler(_request: Request, exc: AIError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.get("/")
def home():
    return {
        "app": "ReConnect AI",
        "status": "running",
        "message": "Rediscover people. Relive memories.",
    }
