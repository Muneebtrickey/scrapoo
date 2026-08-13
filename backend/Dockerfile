FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt \
    && python -m playwright install --with-deps chromium

COPY . .

RUN useradd --create-home --uid 10001 scrapoo \
    && chown -R scrapoo:scrapoo /app
USER scrapoo

EXPOSE 8000
CMD ["gunicorn", "scrapoo.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "90"]
