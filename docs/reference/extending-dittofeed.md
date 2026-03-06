# Rozszerzanie Dittofeed — Architektura i Strategie

## Zasada Nadrzędna

Upstream paczki (`api`, `backend-lib`, `dashboard`, `isomorphic-lib`, `lite`, `worker`, `admin-cli`) są **READ-ONLY**. Cała customizacja musi iść przez własne paczki w `packages/`.

---

## Struktura Paczek

| Paczka | Technologia | Rola |
|--------|-------------|------|
| **dashboard** | Next.js 13 + MUI + Zustand | UI — routing plikowy w `src/pages/`, base path `/dashboard` |
| **api** | Fastify 4 + TypeBox | REST API — kontrolery w `src/controllers/`, factory `buildApp()` |
| **lite** | Node.js | All-in-one: łączy API + Dashboard + Worker w jednym procesie |
| **backend-lib** | Drizzle ORM, Temporal | Core logic — DB schema, bootstrap, journeys, segments, messaging |
| **worker** | Temporal.io | Async workflows — journeys, broadcasts, computed properties |
| **isomorphic-lib** | TypeBox | Shared types/utils — używane przez frontend i backend |
| **admin-cli** | Yargs | CLI — migracje, seeding |
| **emailo** | Tiptap | Edytor emaili — komponent library |
| **auth-keycloak** | openid-client, Fastify | **CUSTOM** — Keycloak OIDC auth |

### Przepływ danych

```
User Event → API (/api/public/apps/:writeKey/track)
  → Postgres + Kafka
  → Worker (Temporal workflows): journey progression, segment eval
  → Template rendering (Liquid/MJML)
  → Providers (SendGrid, Twilio, etc.)
  → Status tracking (Clickhouse)
  → Dashboard (analytics/deliveries)
```

---

## Mechanizm Rozszerzania — BuildAppOpts

Kluczowy wzór to **BuildAppOpts** — interfejs pozwalający wstrzyknąć custom logikę do `buildApp()` bez edycji upstream:

```typescript
// Upstream: api/src/buildApp.ts akceptuje opcje:
interface BuildAppOpts {
  extendPlugins?: (fastify) => Promise<void>;          // rejestracja pluginów
  registerAuthentication?: (fastify) => Promise<void>; // custom auth
}

// Custom pakiet tworzy te opcje:
export function createKeycloakBuildAppOpts(): BuildAppOpts {
  return {
    extendPlugins: async (fastify) => {
      await fastify.register(keycloakPlugin);
    },
    registerAuthentication: async (fastify) => {
      await fastify.register(oidcAuth);
    },
  };
}
```

Lite normalnie wywołuje `buildApp()` bez opcji. Custom pakiet (np. `auth-keycloak/scripts/startLite.ts`) wywołuje `buildApp(createCustomBuildAppOpts())`.

---

## Wzór Custom Pakietu (na przykładzie auth-keycloak)

### Struktura plików

```
packages/auth-keycloak/
├── src/
│   ├── buildAppOpts.ts       ← tworzy BuildAppOpts (punkt integracji)
│   ├── config.ts             ← env vars
│   ├── keycloakPlugin.ts     ← Fastify plugin (routes, session, OIDC)
│   ├── oidcAuth.ts           ← preHandler hook (session → request.user)
│   ├── onboarding.ts         ← auto-provisioning workspace per user
│   └── routes/               ← custom endpoints
├── scripts/
│   └── startLite.ts          ← WŁASNY entry point (kopia logiki lite + custom opts)
├── Dockerfile                ← multi-stage build
├── package.json              ← zależy od api, backend-lib, lite, etc. (read-only)
└── tsconfig.json
```

### Docker Compose — override pattern

```bash
# base:     docker-compose.lite.yaml       (upstream, bez zmian)
# override: docker-compose.keycloak.yaml   (zmienia command, dockerfile, env)
docker compose -f docker-compose.lite.yaml -f docker-compose.keycloak.yaml up -d
```

Override zmienia:
- `command:` → `node ./packages/auth-keycloak/dist/scripts/startLite.js`
- `build.dockerfile:` → `packages/auth-keycloak/Dockerfile`
- `environment:` → dodaje custom env vars

### Własny startLite.ts

Custom `startLite.ts` kopiuje logikę z `lite/scripts/startLite.ts` i modyfikuje:
- Przekazuje custom `BuildAppOpts` do `buildApp()`
- Next.js handler bridguje sesję do SSR context
- Może dodawać custom routing przed Next.js catch-all

---

## Strategie Rozszerzania

### A. Nowe API endpoints (backend)

- Stwórz nowy pakiet w `packages/`
- Zarejestruj routes przez `extendPlugins` w BuildAppOpts
- Routes pod `/api/public/my-module/` (publiczne) lub `/api/my-module/` (auth required)

### B. Custom middleware/hooks

- PreHandler hooks (jak `oidcAuth.ts`) — przechwytują każdy request
- Fastify decorators — dodają custom properties do request/reply
- Rejestracja przez `extendPlugins` w BuildAppOpts

### C. Nowe Temporal workflows

- Stwórz własne workflow/activity definitions w custom pakiecie
- Zarejestruj je w custom `startLite.ts` obok upstream workflows
- Używaj `backend-lib` utilities (DB, config, etc.) jako read-only dependencies

### D. Modyfikacja UI (dashboard)

Dashboard to monolityczny Next.js app **bez plugin systemu**. Opcje:

| Strategia | Plusy | Minusy | Kiedy użyć |
|-----------|-------|--------|------------|
| **Proxy/overlay w startLite** | Pełna kontrola, zero zmian w upstream | Trzeba samemu renderować HTML/React | Małe zmiany (logo, custom strony) |
| **Osobna app frontendowa** | Zero konfliktów z upstream | Osobny build, nie dzieli layoutu | Nowe moduły/sekcje |
| **Iframe embedding** | Izolacja, brak konfliktów | Ograniczona integracja UX | Osadzanie zewnętrznych widoków |
| **Fork dashboard** | Pełna kontrola UI | Ciężkie merge'y z upstream | Głębokie modyfikacje (ostateczność) |

**Rekomendacja**: Dla nowych stron/modułów — osobna app frontendowa (np. Vite + React) serwowana przez custom `startLite.ts` pod innym path prefix (np. `/app/*`), komunikująca się z API Dittofeed.

---

## Receptura: Tworzenie Nowego Custom Pakietu

```bash
mkdir -p packages/my-module/src packages/my-module/scripts
```

1. **package.json** — zależności na upstream paczki (read-only)
2. **src/plugin.ts** — Fastify plugin z custom logiką
3. **src/buildAppOpts.ts** — eksportuj `createMyModuleBuildAppOpts()`
4. **scripts/startLite.ts** — własny entry point łączący opcje
5. **Dockerfile** — multi-stage (build upstream first, custom last)
6. **docker-compose.my-module.yaml** — override dla lite service
7. **Aktualizuj `./start`** — dodaj `-f docker-compose.my-module.yaml`

---

## Ograniczenia

- **Dashboard nie ma plugin systemu** — nie można dodawać stron/komponentów bez modyfikacji upstream lub workaround
- **startLite.ts jest kopią** — zmiany w upstream `lite/scripts/startLite.ts` trzeba ręcznie synchronizować
- **BuildAppOpts ma ograniczony interfejs** — tylko `extendPlugins` i `registerAuthentication`
- **Session cookie 4KB limit** — nie można przechowywać dużo danych w sesji
