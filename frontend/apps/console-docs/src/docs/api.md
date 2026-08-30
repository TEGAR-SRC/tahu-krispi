# API Reference

This page documents the public API endpoints of the Kilat Cloud platform.

## Authentication

Most endpoints require a bearer token:

```http
Authorization: Bearer <access_token>
```

## Endpoints

### `POST /v1/auth/login`

Authenticates a user with email and password.

```bash
curl -X POST https://api.kilat-cloud.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@kilat-cloud.com", "password": "secret"}'
```

### `GET /v1/landing`

Returns the published landing sections. Public — no auth required.

```javascript
const res = await fetch("https://api.kilat-cloud.com/v1/landing")
const { data } = await res.json()
console.table(data)
```

## Response shape

| Field       | Type   | Description             |
| ----------- | ------ | ----------------------- |
| `data`      | any    | The payload             |
| `request_id`| string | Correlation id          |

## Errors

Errors follow the `{ error: { code, message } }` shape.

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "staff access required"
  }
}
```
