# Feature: OIDC & identity federation

**ID:** F-38
**Category:** secrets
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

OIDC (OpenID Connect) allows CI jobs to authenticate with cloud providers without long-lived credentials. GitHub requires `permissions.id-token: write` and uses the `ACTIONS_ID_TOKEN_REQUEST_URL` API. GitLab uses `id_tokens` (map of token names with `aud` claim) and `identity` (provider identifier). Sverka needs a portable OIDC token request model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `permissions.id-token: write` | `id_tokens`, `identity` | `identity` on Step |
| Semantics | Request OIDC token via API | Declare ID tokens with audience | Request OIDC token with audience |
| Value type | permission scope | map of token names with `aud` | `{ audience }` |
| Limitations | one token per job | multiple tokens with different audiences | — |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
permissions:
  id-token: write

jobs:
  deploy:
    steps:
      - name: Get OIDC token
        run: |
          TOKEN=$(curl -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com")
          echo $TOKEN
      - run: deploy-to-aws
```

GitHub automatically provides `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` env vars when `id-token: write` is set.

## GitLab CI

```yaml
deploy:
  id_tokens:
    AWS_TOKEN:
      aud: https://sts.amazonaws.com
    VAULT_TOKEN:
      aud: https://vault.example.com
  identity: google_cloud
  script: deploy
```

GitLab generates ID tokens as CI/CD variables. Each token has an `aud` (audience) claim. `identity` specifies the identity federation provider.

## Sverka proposal

### Portable model

```ts
interface IdentitySpec {
  readonly tokens: Record<string, { readonly audience: string }>;
}
```

Step gets optional `identity?: IdentitySpec`.

### Authoring API

```ts
task("deploy", {
  run: ...,
  identity: {
    tokens: {
      AWS_TOKEN: { audience: "https://sts.amazonaws.com" },
    },
  },
}),
```

### Lowering

- **GitHub target:** `identity` → `permissions: id-token: write` at job level. Token request is done via the `ACTIONS_ID_TOKEN_REQUEST_*` env vars at runtime. Multiple tokens with different audiences: GitHub only supports one audience per job — emit warning if multiple audiences are specified.
- **GitLab target:** `identity` → `id_tokens:` map with `aud` for each token.
- **Native engine:** generate a self-signed JWT with the specified audience. Useful for local testing of OIDC-consuming code.

### Capability manifest

```ts
"secrets.oidc": "native",
"secrets.oidc.multiAudience": "native",       // GitLab
"secrets.oidc.multiAudience": "unsupported",  // GitHub
```

### Portability & divergence

Both providers support OIDC but with different APIs. GitHub provides request URL/token env vars and supports one audience per job. GitLab generates tokens as variables with per-token audiences. Sverka normalizes to a token map with audiences. Multiple audiences are GitLab-only.

## Non-goals

- Cloud provider trust configuration (AWS IAM, GCP Workload Identity).
- Token caching and refresh.
- `identity` provider identifier (GitLab-specific).

## Dependencies

- **Depends on:** F-21 (secrets), F-30 (permissions — GitHub needs `id-token: write`).
- **Blocks:** none.

## Open questions

- Should the native engine generate real JWTs or mock tokens?
- Should `identity` (GitLab provider identifier) be in the portable model?
- How to handle GitHub's single-audience limitation?

## References

- GitHub: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#id_tokens
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#identity
- Architecture spec: §25, §32 (deferred)
