# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY pyproject.toml uv.lock ./

# Install only production dependencies into a virtual env inside /app/.venv
RUN uv sync --frozen --no-dev

# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.12-slim

# Link image to the GitHub repo — GHCR uses this to inherit the repo's visibility.
LABEL org.opencontainers.image.source="https://github.com/sanityseeker/padel-amistoso"
LABEL org.opencontainers.image.description="Padel Tournament Manager"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy virtual env from builder stage
COPY --from=builder /app/.venv /app/.venv

# Copy application source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create the data directory that will be overridden by a volume mount
RUN mkdir -p /app/data

# Ensure the .venv binaries are on PATH
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
