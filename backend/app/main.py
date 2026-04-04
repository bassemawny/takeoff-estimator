from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import plans

app = FastAPI(
    title="Takeoff Estimator API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plans.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
