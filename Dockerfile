FROM python:3.12-slim

WORKDIR /app
COPY . .

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

CMD ["python", "server.py"]
