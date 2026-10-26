"""Case-insensitive identity keys follow PostgreSQL's lower() indexes.

Keep stored spelling intact. Python lower()/casefold() are not substitutes for
the database's Unicode and collation rules. SQL predicates must likewise apply
lower() to both operands, including bound user input.
"""

from sqlalchemy import Text, column, func, select, values


def cache_database_text_keys(session, texts):
    """Batch normalization without caching mutable database records or lookups."""
    keys = session.info.setdefault("database_text_keys", {})
    missing = list(dict.fromkeys(value for value in texts if value not in keys))
    for offset in range(0, len(missing), 500):
        inputs = values(column("text_value", Text), name="identity_texts").data(
            [(value,) for value in missing[offset : offset + 500]]
        )
        keys.update(
            session.execute(select(inputs.c.text_value, func.lower(inputs.c.text_value))).all()
        )


def database_text_key(session, value: str) -> str:
    """Use the index's normalization for Python maps; cache only immutable text."""
    cache_database_text_keys(session, [value])
    return session.info["database_text_keys"][value]
