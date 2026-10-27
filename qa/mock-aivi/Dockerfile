FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=qa/mock-aivi/pyproject.toml,target=qa/mock-aivi/pyproject.toml \
    uv sync --locked --no-dev --package mock-aivi
ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app/qa/mock-aivi
COPY qa/mock-aivi/server.py .
COPY qa/mock-aivi/mock_aivi ./mock_aivi
# The compose file mounts the repo's contract/ (the OpenAPI document) here.
ENV AIVI_CONTRACT_ROOT=/srv
EXPOSE 8080
CMD ["python", "server.py"]
