import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from routers import admin, dashboard, employees, org
from routers import auth as auth_router

load_dotenv()  # routers import db, which also loads .env; harmless to repeat

IS_PRODUCTION = os.environ.get("ENV") == "production"

app = FastAPI(title="HRMS API")


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    # One error contract for the frontend: {error: string}
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    errors = exc.errors()
    if errors:
        loc = ".".join(str(p) for p in errors[0]["loc"] if p not in ("body", "query"))
        message = f"{loc}: {errors[0]['msg']}" if loc else errors[0]["msg"]
    else:
        message = "Invalid request"
    return JSONResponse(status_code=422, content={"error": message})


# API routers first — they must win over the catch-all static/SPA mount registered below.
app.include_router(auth_router.router, prefix="/api/auth")
app.include_router(dashboard.router, prefix="/api/dashboard")
app.include_router(employees.router, prefix="/api/employees")
app.include_router(org.router, prefix="/api")
app.include_router(admin.router, prefix="/api")

if IS_PRODUCTION:
    dist_dir = Path(__file__).resolve().parent.parent / "client" / "dist" / "client" / "browser"

    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path, scope):
            response = await super().get_response(path, scope)
            if response.status_code == 404:
                response = await super().get_response("index.html", scope)
            return response

    app.mount("/", SPAStaticFiles(directory=dist_dir, html=True), name="static")
