# Crease / Lab container deployment

The root Compose file builds the API and nginx frontend and runs a private PostgreSQL service. The frontend and API share one origin. The default host URL is http://localhost:8080 and the API readiness endpoint is /api/health. Bind public HTTPS at your hosting proxy before accepting footage from users.

Set these values in the repository-root environment or an ignored root .env file.

| Variable | Value |
| --- | --- |
| DRS_DB_PASSWORD | PostgreSQL password. For an existing database volume, use its current password. |
| DRS_JWT_SECRET | A unique random secret of at least 32 characters. Rotating it expires existing sessions and playback tickets. |
| DRS_HTTP_PORT | Optional loopback port. Defaults to 8080. |

```bash
docker compose config --quiet
docker compose up --build --wait
docker compose ps
curl --fail http://localhost:8080/api/health
```

The packaged build accepts clips up to 100 MB. Use a short single-delivery H.264 MP4 or WebM for browser playback. The API checks decodability, resolution and known duration before creating a clip. Workspace size and clip-count limits apply. The API binds only inside the Compose network and the gateway omits query strings from access logs.

## Existing volumes and rollback

Back up PostgreSQL with pg_dump and copy the upload volume before starting the new backend. The application applies versioned schema upgrades on startup. The first version recognizes the old docker/init.sql schema and preserves former review outcomes. It disables the seeded local admin account. Invalid legacy JSON, duplicate trajectory rows or dangling review users cause the transaction to fail and require repairing a backup copy before retrying.

Development containers previously ran as root. If existing upload or log volumes are root-owned, set ownership for the application user before starting:

```bash
docker compose run --rm --no-deps --user root backend chown -R app:app /app/uploads /app/logs
```

If validation fails after a migration, restore the database and upload snapshots together and deploy the previous application revision. Retain the original snapshots until guest creation, upload, playback seek, refresh and delete have been verified. The standalone Dockerfiles in this directory and init.sql document the old setup. The root Compose file is the deployment entry point.
