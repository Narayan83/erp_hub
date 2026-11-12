from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

_engine = None
AsyncSessionLocal = None


class Base(DeclarativeBase):
    pass


def init_engine(database_url: str, *, echo: bool = False) -> None:
    global _engine, AsyncSessionLocal
    connect_args: dict = {}
    if "localhost" in database_url or "127.0.0.1" in database_url:
        connect_args["ssl"] = False
    _engine = create_async_engine(
        database_url,
        echo=echo,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        connect_args=connect_args,
    )
    AsyncSessionLocal = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )


def get_engine():
    if _engine is None:
        raise RuntimeError("Database engine not initialized")
    return _engine


def get_session_factory():
    if AsyncSessionLocal is None:
        raise RuntimeError("Database session factory not initialized")
    return AsyncSessionLocal


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
