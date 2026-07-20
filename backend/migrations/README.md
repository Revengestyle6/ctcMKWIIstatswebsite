# Database Migrations

Alembic is the only staging and production schema-management path. Run commands
from the repository root:

```bash
alembic upgrade head
alembic current
alembic downgrade -1
```

`DATABASE_URL` selects the target. Never generate a migration against production,
and never run `metadata.create_all()` as a production schema substitute.
