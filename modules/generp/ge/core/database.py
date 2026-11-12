"""GenERP database symbols bound to the shared ERP engine."""

from erp_core.database import Base, get_db, get_engine, get_session_factory


class _EngineProxy:
    def __getattr__(self, name: str):
        return getattr(get_engine(), name)


class _FactoryProxy:
    def __call__(self, *args, **kwargs):
        return get_session_factory()(*args, **kwargs)


engine = _EngineProxy()
AsyncSessionLocal = _FactoryProxy()

__all__ = [
    "Base",
    "get_db",
    "engine",
    "AsyncSessionLocal",
    "get_engine",
    "get_session_factory",
]
