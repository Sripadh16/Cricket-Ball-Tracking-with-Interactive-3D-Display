# Local SSL certificates

This directory is where `docker-compose.yml` expects `cert.pem` and `key.pem`
for local HTTPS. Those files used to be committed to the repo, private key
included, which is not safe for a public repo, so they were removed and this
directory is now gitignored (see `.gitignore`).

Generate your own self-signed pair before running the stack locally:

```
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
  -keyout key.pem -out cert.pem -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

This creates `key.pem` and `cert.pem` in this folder. Browsers will warn
about a self-signed certificate; that is expected for local development.
Do not commit the generated files.
