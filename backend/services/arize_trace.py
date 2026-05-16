import time
from contextlib import contextmanager


@contextmanager
def trace_span(name: str, metadata: dict | None = None):
    start_time = time.time()
    print(f"[TRACE START] {name}")
    print(f"[TRACE METADATA] {metadata or {}}")

    try:
        yield
    finally:
        duration = time.time() - start_time
        print(f"[TRACE END] {name} duration={duration:.2f}s")