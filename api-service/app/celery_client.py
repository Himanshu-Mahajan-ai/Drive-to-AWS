from celery import Celery

from .config import settings


def make_celery() -> Celery:
    broker_url = settings.celery_broker_url or settings.redis_url
    backend_url = settings.celery_backend_url or settings.redis_url
    app = Celery(
        "api-service",
        broker=broker_url,
        backend=backend_url,
        include=[]
    )
    app.conf.task_default_queue = "imports"
    app.conf.task_routes = {
        "tasks.start_import": {"queue": "imports"},
        "tasks.transfer_file": {"queue": "imports"},
    }
    return app


celery_app = make_celery()
