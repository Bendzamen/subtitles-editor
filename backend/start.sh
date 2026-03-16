#!/bin/bash
set -e

python /app/download_models.py

exec uvicorn main:app --host 0.0.0.0 --port 8050
